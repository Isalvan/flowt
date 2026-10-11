/**
 * Validates tool arguments against the JSON Schemas published in tools/list.
 * Covers exactly the keywords those schemas use; an unknown keyword is a bug in a schema.
 */
import { stableJson } from './util.js';

const KEYWORDS = new Set(['type', 'enum', 'properties', 'required', 'additionalProperties', 'minProperties', 'items', 'minItems', 'maxItems',
  'uniqueItems', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'exclusiveMinimum', 'description']);

const TYPES = {
  object: (value) => value !== null && typeof value === 'object' && !Array.isArray(value),
  array: Array.isArray,
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number' && Number.isFinite(value),
  integer: (value) => Number.isInteger(value),
  boolean: (value) => typeof value === 'boolean',
  null: (value) => value === null,
};

export function valid(schema, value) {
  for (const keyword of Object.keys(schema)) {
    if (!KEYWORDS.has(keyword)) throw new Error(`Unsupported schema keyword: ${keyword}`);
  }
  if (schema.type !== undefined && ![schema.type].flat().some((type) => TYPES[type](value))) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (typeof value === 'string') {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) return false;
    if (schema.maxLength !== undefined && length > schema.maxLength) return false;
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) return false;
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return false;
    if (schema.maximum !== undefined && value > schema.maximum) return false;
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) return false;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return false;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    if (schema.uniqueItems && new Set(value.map(stableJson)).size !== value.length) return false;
    if (schema.items && !value.every((item) => valid(schema.items, item))) return false;
  }
  if (TYPES.object(value)) {
    const keys = Object.keys(value);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) return false;
    if (schema.required && !schema.required.every((key) => Object.hasOwn(value, key))) return false;
    const properties = schema.properties || {};
    for (const key of keys) {
      if (Object.hasOwn(properties, key)) {
        if (!valid(properties[key], value[key])) return false;
      } else if (schema.additionalProperties === false) return false;
    }
  }
  return true;
}
