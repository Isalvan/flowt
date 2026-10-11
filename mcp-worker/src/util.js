/** Small helpers shared by the services: ids, hashing and result shaping. */
import { fail } from './errors.js';
import { SERVER_TIMESTAMP } from './firestore.js';

const hex = (buffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(text) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

export async function sha256Base64Url(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** URL-safe random secret with `bytes` bytes of entropy. */
export function randomToken(bytes = 32) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Constant-time comparison of two strings. */
export function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

/** Document id that scopes a caller-chosen key to its owner. */
export const documentId = (owner, key) => sha256Hex(`${owner}:${key}`);

export function checkedId(value) {
  if (typeof value !== 'string' || !value || value.length > 200 || value.includes('/')) fail('invalid_id', 'Identificador no válido');
  return value;
}

/** A stored document as shown to the client: no owner, no pending server timestamps. */
export function visible(id, data) {
  return { id, ...Object.fromEntries(Object.entries(data).filter(([key, value]) => key !== 'id_propietario' && value !== SERVER_TIMESTAMP)) };
}

/** JSON with object keys sorted, so equal requests hash equally whatever their key order. */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** JSON-safe copy: dates become ISO strings, exactly as the client will receive them. */
export const plain = (value) => JSON.parse(JSON.stringify(value));
