import { describe, expect, test } from "vite-plus/test";
import { CanonicalJsonError, canonicalJson, parseCanonicalJson } from "./canonical-json.ts";

const enc = (s: string) => new TextEncoder().encode(s);

describe("RFC 8785 canonical JSON", () => {
  test("ECMAScript number serialisation (RFC 8785 §3.2.2.3 examples)", () => {
    const cases: [number, string][] = [
      [0, "0"],
      [-0, "0"],
      [1280, "1280"],
      [1e21, "1e+21"],
      [1e-7, "1e-7"],
      [333333333.3333333, "333333333.3333333"],
      [5e-324, "5e-324"],
      [1.7976931348623157e308, "1.7976931348623157e+308"],
      [-1.5, "-1.5"],
      [0.000001, "0.000001"],
    ];
    for (const [v, s] of cases) expect(canonicalJson(v)).toBe(s);
  });

  test("members sorted by UTF-16 code units; nested; no whitespace; undefined omitted", () => {
    // U+1F600 (surrogates D83D DE00) sorts before U+FB01 in UTF-16 order, after it in code points.
    const v = { ﬁ: 1, "\u{1F600}": 2, b: [true, null, { z: 1, a: "x" }], a: undefined, A: 0 };
    expect(canonicalJson(v)).toBe('{"A":0,"b":[true,null,{"a":"x","z":1}],"\u{1F600}":2,"ﬁ":1}');
    expect(canonicalJson({ lay_9: 1, lay_10: 2 })).toBe('{"lay_10":2,"lay_9":1}');
  });

  test("string escaping matches JCS", () => {
    expect(canonicalJson('\u0000\u001f\b\f\n\r\t"\\/\u007f é')).toBe(
      '"\\u0000\\u001f\\b\\f\\n\\r\\t\\"\\\\/\u007f é"',
    );
  });

  test("non-finite numbers, lone surrogates and non-JSON values are rejected", () => {
    for (const bad of [
      NaN,
      Infinity,
      "\uD800",
      { "\uDC00": 1 },
      [undefined],
      new Map(),
      () => 1,
      1n,
    ])
      expect(() => canonicalJson(bad)).toThrow(CanonicalJsonError);
  });

  test("strict reader: canonical bytes only (whitespace, order, duplicates, BOM, bad UTF-8)", () => {
    expect(parseCanonicalJson(enc('{"a":1,"b":[2]}'))).toEqual({ value: { a: 1, b: [2] } });
    for (const bad of [
      '{"b":1,"a":2}',
      '{"a": 1}',
      '{"a":1,"a":1}',
      "﻿{}",
      '{"a":1.0}',
      '{"a":1e999}',
    ])
      expect(parseCanonicalJson(enc(bad)), bad).toBeNull();
    expect(parseCanonicalJson(Uint8Array.of(0x22, 0xff, 0x22))).toBeNull();
  });
});
