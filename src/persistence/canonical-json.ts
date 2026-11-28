// RFC 8785 (JCS) canonical JSON, the only JSON form Vectra writes into containers (C7).
// - members sorted by UTF-16 code units (the default JS string order);
// - numbers in ECMAScript Number::toString form (JSON.stringify), so -0 is written as 0;
// - strings escaped as JSON.stringify does, which matches JCS once lone surrogates are refused;
// - no insignificant whitespace; absent (undefined) members are omitted.
// Non-finite numbers, lone surrogates and non-JSON values are rejected at the boundary.

export class CanonicalJsonError extends Error {
  override name = "CanonicalJsonError";
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const PLAIN_ASCII = /^[\x20\x21\x23-\x5b\x5d-\x7e]*$/; // needs no escaping, has no surrogates

function str(s: string): string {
  if (PLAIN_ASCII.test(s)) return `"${s}"`;
  if (LONE_SURROGATE.test(s)) throw new CanonicalJsonError("lone surrogate in string");
  return JSON.stringify(s);
}

function write(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new CanonicalJsonError(`non-finite number ${v}`);
    return String(v); // Number::toString, as JSON.stringify; -0 → "0"
  }
  if (typeof v === "string") return str(v);
  if (Array.isArray(v)) {
    let out = "[";
    for (let i = 0; i < v.length; i++) {
      const item: unknown = v[i];
      if (item === undefined) throw new CanonicalJsonError("undefined array element");
      out += (i ? "," : "") + write(item);
    }
    return out + "]";
  }
  if (typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    let out = "{";
    let first = true;
    for (const k of keys) {
      if (obj[k] === undefined) continue;
      out += (first ? "" : ",") + str(k) + ":" + write(obj[k]);
      first = false;
    }
    return out + "}";
  }
  throw new CanonicalJsonError(`not a JSON value: ${typeof v}`);
}

export function canonicalJson(value: unknown): string {
  return write(value);
}

/** UTF-8 bytes of a JS string with no lone surrogates: 1, 2 or 3 bytes per code unit, and 4 per
 *  surrogate pair (two code units). */
function utf8Length(s: string): number {
  let n = s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) continue;
    if (c < 0x800) n += 1;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 2;
      i++; // the low surrogate is already counted once in s.length
    } else n += 2;
  }
  return n;
}
/** UTF-8 length of `str(s)`: plain ASCII is the string plus its quotes. */
export function canonicalStringLength(s: string): number {
  if (PLAIN_ASCII.test(s)) return s.length + 2;
  if (LONE_SURROGATE.test(s)) throw new CanonicalJsonError("lone surrogate in string");
  return utf8Length(JSON.stringify(s));
}

/**
 * The exact length of `canonicalJsonBytes(value)`, without building the text (G-PRJ-0
 * persistability accounting). Member order does not change a length, so keys are not sorted.
 * Rejects exactly what canonicalJson rejects.
 */
export function canonicalLength(v: unknown): number {
  if (v === null) return 4;
  if (typeof v === "boolean") return v ? 4 : 5;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new CanonicalJsonError(`non-finite number ${v}`);
    return String(v).length;
  }
  if (typeof v === "string") return canonicalStringLength(v);
  if (Array.isArray(v)) {
    let n = v.length > 1 ? v.length + 1 : 2; // brackets and commas
    for (let i = 0; i < v.length; i++) {
      const item: unknown = v[i];
      if (item === undefined) throw new CanonicalJsonError("undefined array element");
      n += canonicalLength(item);
    }
    return n;
  }
  if (typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    const obj = v as Record<string, unknown>;
    let n = 2;
    let members = 0;
    for (const k of Object.keys(obj)) {
      if (obj[k] === undefined) continue;
      n += canonicalStringLength(k) + 1 + canonicalLength(obj[k]);
      members++;
    }
    return members > 1 ? n + members - 1 : n;
  }
  throw new CanonicalJsonError(`not a JSON value: ${typeof v}`);
}

const encoder = new TextEncoder();
export const canonicalJsonBytes = (value: unknown): Uint8Array =>
  encoder.encode(canonicalJson(value));

/** Every object's member names are in strictly ascending UTF-16 order (no duplicates). */
function keysSorted(v: unknown): boolean {
  if (Array.isArray(v)) return v.every(keysSorted);
  if (typeof v !== "object" || v === null) return true;
  let prev: string | null = null;
  for (const k in v) {
    if (prev !== null && !(prev < k)) return false;
    prev = k;
    if (!keysSorted((v as Record<string, unknown>)[k])) return false;
  }
  return true;
}
// A \uD800–\uDFFF escape (an unescaped backslash before it). Canonical text writes valid pairs
// literally, and JSON.stringify escapes only lone surrogates, so any such escape is refused.
const SURROGATE_ESCAPE = /(?<!\\)(?:\\\\)*\\u[dD][89a-fA-F]/;

/**
 * Strict read: UTF-8 (fatal, no BOM), JSON.parse, and the bytes must be the canonical form.
 * Equivalent to `canonicalJson(parse(text)) === text`, in linear time: JSON.stringify keeps
 * member order and uses the JCS number and string forms, so the text is canonical exactly when
 * it equals JSON.stringify of its value, every object's members are sorted, and it has no
 * surrogate escapes. Duplicate member names (collapsed by JSON.parse) fail the equality.
 * Array-index member names ("0", "17") are refused because JSON.parse reorders them; no
 * Vectra schema uses them.
 * Returns null on any failure; callers map that to their own typed error.
 */
export function parseCanonicalJson(bytes: Uint8Array): { value: unknown } | null {
  let value: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    value = JSON.parse(text);
    if (JSON.stringify(value) !== text || SURROGATE_ESCAPE.test(text) || !keysSorted(value))
      return null;
  } catch {
    return null;
  }
  return { value };
}
