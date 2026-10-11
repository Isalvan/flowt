/**
 * Firestore over its REST API, for Cloudflare Workers (no Admin SDK there).
 *
 * Money operations touch several documents at once, so writes go through real
 * Firestore transactions: reads carry the transaction id and one commit applies
 * every write or none. A transaction that loses a race is retried from scratch.
 */

export const SERVER_TIMESTAMP = Symbol('serverTimestamp');
export const DELETE_FIELD = Symbol('deleteField');

const OPERATORS = { '==': 'EQUAL', '>=': 'GREATER_THAN_OR_EQUAL', '<': 'LESS_THAN', in: 'IN' };
const MAX_ATTEMPTS = 5;

export class FirestoreError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'FirestoreError';
    this.status = status;
    this.code = code;
  }
}

/** JS value to Firestore's typed JSON. Dates are timestamps; strings always stay strings. */
export function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === 'object') return { mapValue: { fields: encodeFields(value) } };
  throw new TypeError(`Unsupported Firestore value: ${String(value)}`);
}

export function encodeFields(data) {
  const fields = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== SERVER_TIMESTAMP && value !== DELETE_FIELD) fields[key] = encodeValue(value);
  }
  return fields;
}

export function decodeValue(value) {
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return new Date(value.timestampValue);
  if ('referenceValue' in value) return value.referenceValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields);
  return null;
}

export function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}

const fieldPath = (name) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `\`${name.replace(/[`\\]/g, '\\$&')}\``);

function randomId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

/** Buffers writes; shared by transactions and plain atomic batches. */
class Writer {
  constructor(db, transactionId = null) {
    this.db = db;
    this.transactionId = transactionId;
    this.writes = [];
  }

  /** Replace the document, or merge into it with `{ merge: true }` (creating it if missing). */
  set(ref, data, { merge = false } = {}) {
    this.writes.push(this.db._write(ref, data, merge ? { mask: true } : {}));
  }

  /** Change the given fields of an existing document. */
  update(ref, data) {
    this.writes.push(this.db._write(ref, data, { mask: true, exists: true }));
  }

  /** Write a document that must not exist yet. */
  create(ref, data) {
    this.writes.push(this.db._write(ref, data, { exists: false }));
  }

  delete(ref) {
    this.writes.push({ delete: this.db._name(ref.path) });
  }
}

export class Firestore {
  /**
   * @param {{ projectId: string, getAccessToken: () => Promise<string>, fetchFn?: typeof fetch, baseUrl?: string }} options
   */
  constructor({ projectId, getAccessToken, fetchFn = (...args) => fetch(...args), baseUrl = 'https://firestore.googleapis.com/v1' }) {
    this.getAccessToken = getAccessToken;
    this.fetch = fetchFn;
    this.database = `projects/${projectId}/databases/(default)`;
    this.root = `${baseUrl}/${this.database}/documents`;
  }

  doc(collection, id) {
    return { collection, id, path: `${collection}/${id}` };
  }

  newId() {
    return randomId();
  }

  _name(path) {
    return `${this.database}/documents/${path}`;
  }

  async _call(path, body) {
    const response = await this.fetch(`${this.root}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.getAccessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      let code = 'UNKNOWN';
      try {
        const payload = await response.json();
        code = (Array.isArray(payload) ? payload[0] : payload)?.error?.status || code;
      } catch { /* not JSON */ }
      throw new FirestoreError(`Firestore ${path} failed (${response.status} ${code})`, response.status, code);
    }
    return response.json();
  }

  _snapshot(path, document) {
    const id = path.slice(path.lastIndexOf('/') + 1);
    const ref = { collection: path.slice(0, path.lastIndexOf('/')), id, path };
    return document
      ? { ref, id, exists: true, data: decodeFields(document.fields), updateTime: document.updateTime, raw: document }
      : { ref, id, exists: false, data: null, updateTime: null, raw: null };
  }

  _path(name) {
    return name.slice(name.indexOf('/documents/') + '/documents/'.length);
  }

  async get(ref, tx = null) {
    return (await this.getAll([ref], tx))[0];
  }

  /** Several documents in one round trip, in the order asked. */
  async getAll(refs, tx = null) {
    if (!refs.length) return [];
    if (tx?.writes.length) throw new Error('Firestore transactions require all reads before any write');
    const names = [...new Set(refs.map((ref) => this._name(ref.path)))];
    const rows = await this._call(':batchGet', { documents: names, ...(tx ? { transaction: tx.transactionId } : {}) });
    const found = new Map();
    for (const row of rows) {
      if (row.found) found.set(row.found.name, row.found);
    }
    return refs.map((ref) => this._snapshot(ref.path, found.get(this._name(ref.path)) || null));
  }

  /**
   * @param {{ collection: string, parent?: string, where?: Array<[string, string, unknown]>,
   *           orderBy?: Array<[string, 'asc' | 'desc']>, limit?: number, startAfter?: object }} spec
   *   `parent` is the document path that owns a subcollection.
   */
  async query(spec, tx = null) {
    if (tx?.writes.length) throw new Error('Firestore transactions require all reads before any write');
    const { collection, parent = '', where = [], orderBy = [], limit = null, startAfter = null } = spec;
    const structuredQuery = { from: [{ collectionId: collection }] };
    const filters = where.map(([field, op, value]) => ({
      fieldFilter: { field: { fieldPath: fieldPath(field) }, op: OPERATORS[op], value: encodeValue(value) },
    }));
    if (filters.length === 1) structuredQuery.where = filters[0];
    if (filters.length > 1) structuredQuery.where = { compositeFilter: { op: 'AND', filters } };
    // The document name breaks ties so a cursor resumes exactly where the last page ended.
    const direction = orderBy.length && orderBy[orderBy.length - 1][1] === 'desc' ? 'DESCENDING' : 'ASCENDING';
    const order = orderBy.map(([field, dir]) => ({ field: { fieldPath: fieldPath(field) }, direction: dir === 'desc' ? 'DESCENDING' : 'ASCENDING' }));
    if (orderBy.length || startAfter) {
      structuredQuery.orderBy = [...order, { field: { fieldPath: '__name__' }, direction }];
    }
    if (startAfter) {
      structuredQuery.startAt = {
        before: false,
        values: [...orderBy.map(([field]) => startAfter.raw.fields[field]), { referenceValue: startAfter.raw.name }],
      };
    }
    if (limit != null) structuredQuery.limit = limit;
    const rows = await this._call(`${parent ? `/${parent}` : ''}:runQuery`, {
      structuredQuery, ...(tx ? { transaction: tx.transactionId } : {}),
    });
    return rows.filter((row) => row.document).map((row) => this._snapshot(this._path(row.document.name), row.document));
  }

  _write(ref, data, { mask = false, exists = undefined } = {}) {
    const write = { update: { name: this._name(ref.path), fields: encodeFields(data) } };
    if (mask) {
      // Deleted fields are named in the mask and absent from the data; server timestamps are transforms.
      write.updateMask = { fieldPaths: Object.keys(data).filter((key) => data[key] !== SERVER_TIMESTAMP && data[key] !== undefined).map(fieldPath) };
    }
    const stamps = Object.keys(data).filter((key) => data[key] === SERVER_TIMESTAMP);
    if (stamps.length) write.updateTransforms = stamps.map((key) => ({ fieldPath: fieldPath(key), setToServerValue: 'REQUEST_TIME' }));
    if (exists !== undefined) write.currentDocument = { exists };
    return write;
  }

  /** Apply the writes buffered by `body` together, without reading first. */
  async batch(body) {
    const writer = new Writer(this);
    const result = await body(writer);
    if (writer.writes.length) await this._call(':commit', { writes: writer.writes });
    return result;
  }

  /**
   * Run `body(tx)`: read with `get/getAll/query(…, tx)`, then buffer writes on `tx`.
   * Nothing is written unless the commit succeeds; a lost race reruns `body`.
   */
  async runTransaction(body) {
    for (let attempt = 1; ; attempt += 1) {
      const { transaction } = await this._call(':beginTransaction', { options: { readWrite: {} } });
      const tx = new Writer(this, transaction);
      try {
        const result = await body(tx);
        await this._call(':commit', { writes: tx.writes, transaction });
        return result;
      } catch (error) {
        const contended = error instanceof FirestoreError && error.code === 'ABORTED';
        if (!contended) {
          // Release the locks right away; the commit never happened.
          if (!(error instanceof FirestoreError)) await this._call(':rollback', { transaction }).catch(() => {});
          throw error;
        }
        if (attempt === MAX_ATTEMPTS) throw error;
      }
    }
  }
}
