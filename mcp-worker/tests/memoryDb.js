/**
 * In-memory stand-in for src/firestore.js with the same interface.
 *
 * Transactions buffer their writes, apply them together and refuse any read made
 * after a write, as Firestore does, so a service that orders its reads wrongly
 * fails here instead of in production. A body that throws writes nothing.
 */
import { DELETE_FIELD, SERVER_TIMESTAMP } from '../src/firestore.js';

const compare = {
  '==': (value, wanted) => equal(value, wanted),
  '>=': (value, wanted) => value != null && value >= wanted,
  '<': (value, wanted) => value != null && value < wanted,
  in: (value, wanted) => wanted.some((option) => equal(value, option)),
};
const equal = (a, b) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);
const clone = (value) => structuredClone(value);

function merged(current, values, timestamp) {
  const result = clone(current);
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (value === DELETE_FIELD) delete result[key];
    else result[key] = value === SERVER_TIMESTAMP ? timestamp : clone(value);
  }
  return result;
}

class Writer {
  constructor(db, transactional) {
    this.db = db;
    this.transactionId = transactional ? 'memory' : null;
    this.writes = [];
  }

  set(ref, data, { merge = false } = {}) {
    this.writes.push({ op: merge ? 'merge' : 'set', ref, data });
  }

  update(ref, data) {
    if (!this.db.data.has(ref.path)) throw new Error(`update of a missing document ${ref.path}`);
    this.writes.push({ op: 'merge', ref, data });
  }

  create(ref, data) {
    if (this.db.data.has(ref.path)) throw new Error(`create of an existing document ${ref.path}`);
    this.writes.push({ op: 'set', ref, data });
  }

  delete(ref) {
    this.writes.push({ op: 'delete', ref });
  }
}

export class MemoryDb {
  constructor() {
    this.data = new Map();
    this.versions = new Map();
    this.sequence = 0;
    this.ids = 0;
    this.committedWrites = 0;
  }

  tick() {
    this.sequence += 1;
    return new Date(Date.UTC(2026, 9, 10) + this.sequence);
  }

  doc(collection, id) {
    return { collection, id, path: `${collection}/${id}` };
  }

  newId() {
    this.ids += 1;
    return `auto-${String(this.ids).padStart(4, '0')}`;
  }

  /** Test helpers: seed and inspect documents directly. */
  put(collection, id, data) {
    this._store(`${collection}/${id}`, data, false, this.tick());
  }

  /** Change stored fields in place without touching the version, like an edit the service never saw coming. */
  patch(collection, id, changes) {
    Object.assign(this.data.get(`${collection}/${id}`), changes);
  }

  read(collection, id) {
    const data = this.data.get(`${collection}/${id}`);
    return data === undefined ? null : clone(data);
  }

  all(collection) {
    const rows = {};
    for (const [path, data] of this.data) {
      if (path.slice(0, path.lastIndexOf('/')) === collection) rows[path.slice(path.lastIndexOf('/') + 1)] = clone(data);
    }
    return rows;
  }

  snapshotAll() {
    return clone(Object.fromEntries(this.data));
  }

  _store(path, values, merge, timestamp) {
    this.data.set(path, merged(merge ? this.data.get(path) ?? {} : {}, values, timestamp));
    this.versions.set(path, timestamp.toISOString());
  }

  _snapshot(path) {
    const id = path.slice(path.lastIndexOf('/') + 1);
    const ref = { collection: path.slice(0, path.lastIndexOf('/')), id, path };
    const exists = this.data.has(path);
    const data = exists ? clone(this.data.get(path)) : null;
    return { ref, id, exists, data, updateTime: exists ? this.versions.get(path) : null, raw: exists ? { name: path, fields: data } : null };
  }

  _guard(tx) {
    if (tx?.writes.length) throw new Error('Firestore transactions require all reads before any write');
  }

  async get(ref, tx = null) {
    this._guard(tx);
    return this._snapshot(ref.path);
  }

  async getAll(refs, tx = null) {
    this._guard(tx);
    return refs.map((ref) => this._snapshot(ref.path));
  }

  async query({ collection, parent = '', where = [], orderBy = [], limit = null, startAfter = null }, tx = null) {
    this._guard(tx);
    const prefix = `${parent ? `${parent}/` : ''}${collection}/`;
    let rows = [...this.data.keys()]
      .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .sort()
      .map((path) => this._snapshot(path))
      .filter((snapshot) => where.every(([field, op, value]) => compare[op](snapshot.data[field], value)));
    if (orderBy.length) {
      rows = rows.filter((snapshot) => orderBy.every(([field]) => snapshot.data[field] != null));
      const descending = orderBy[orderBy.length - 1][1] === 'desc';
      rows.sort((a, b) => {
        for (const [field, direction] of orderBy) {
          const [x, y] = [a.data[field], b.data[field]];
          if (x < y || x > y) return (x < y ? -1 : 1) * (direction === 'desc' ? -1 : 1);
        }
        return (a.ref.path < b.ref.path ? -1 : 1) * (descending ? -1 : 1);
      });
    }
    if (startAfter) {
      const index = rows.findIndex((snapshot) => snapshot.ref.path === startAfter.ref.path);
      if (index >= 0) rows = rows.slice(index + 1);
    }
    return limit == null ? rows : rows.slice(0, limit);
  }

  _commit(writes) {
    // One commit, one timestamp: every server timestamp it sets is the same instant.
    const timestamp = writes.length ? this.tick() : null;
    for (const { op, ref, data } of writes) {
      if (op === 'delete') {
        this.data.delete(ref.path);
        this.versions.delete(ref.path);
      } else this._store(ref.path, data, op === 'merge', timestamp);
    }
    this.committedWrites += writes.length;
  }

  async batch(body) {
    const writer = new Writer(this, false);
    const result = await body(writer);
    this._commit(writer.writes);
    return result;
  }

  async runTransaction(body) {
    const tx = new Writer(this, true);
    const result = await body(tx);
    this._commit(tx.writes);
    return result;
  }
}
