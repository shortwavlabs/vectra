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

function str(s: string): string {
  if (LONE_SURROGATE.test(s)) throw new CanonicalJsonError("lone surrogate in string");
  return JSON.stringify(s);
}

function write(v: unknown, out: string[]): void {
  if (v === null) out.push("null");
  else if (typeof v === "boolean") out.push(v ? "true" : "false");
  else if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new CanonicalJsonError(`non-finite number ${v}`);
    out.push(JSON.stringify(v));
  } else if (typeof v === "string") out.push(str(v));
  else if (Array.isArray(v)) {
    out.push("[");
    v.forEach((item, i) => {
      if (i) out.push(",");
      if (item === undefined) throw new CanonicalJsonError("undefined array element");
      write(item, out);
    });
    out.push("]");
  } else if (typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    out.push("{");
    keys.forEach((k, i) => {
      if (i) out.push(",");
      out.push(str(k), ":");
      write(obj[k], out);
    });
    out.push("}");
  } else throw new CanonicalJsonError(`not a JSON value: ${typeof v}`);
}

export function canonicalJson(value: unknown): string {
  const out: string[] = [];
  write(value, out);
  return out.join("");
}

const encoder = new TextEncoder();
export const canonicalJsonBytes = (value: unknown): Uint8Array =>
  encoder.encode(canonicalJson(value));

/**
 * Strict read: UTF-8 (fatal), JSON.parse, and the bytes must equal their canonical form.
 * The canonical check also rejects duplicate member names, which JSON.parse would silently
 * collapse. Returns null on any failure; callers map that to their own typed error.
 */
export function parseCanonicalJson(bytes: Uint8Array): { value: unknown } | null {
  let text: string;
  let value: unknown;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    value = JSON.parse(text);
    if (canonicalJson(value) !== text) return null;
  } catch {
    return null;
  }
  return { value };
}
