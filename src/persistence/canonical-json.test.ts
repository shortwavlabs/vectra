import { describe, expect, test } from "vite-plus/test";
import {
  CanonicalJsonError,
  canonicalJson,
  canonicalJsonBytes,
  canonicalLength,
  parseCanonicalJson,
} from "./canonical-json.ts";

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

  test("strict reader: surrogate escapes refused, escaped backslashes and literal pairs accepted", () => {
    expect(parseCanonicalJson(enc('"\\ud800"'))).toBeNull(); // a lone surrogate escape
    expect(parseCanonicalJson(enc('"\\ud83d\\ude00"'))).toBeNull(); // canonical form is literal
    expect(parseCanonicalJson(enc('"\\\\ud800"'))).toEqual({ value: "\\ud800" }); // backslash + text
    expect(parseCanonicalJson(enc('"\u{1F600}"'))).toEqual({ value: "\u{1F600}" });
  });

  test("strict reader agrees with canonicalJson on random values", () => {
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    const strings = ["", "a", "é", "\u{1F600}", '"q"', "\\", "\n", "lay_10", "lay_9", "\u2028"];
    const gen = (d: number): unknown => {
      const k = rnd(d > 3 ? 4 : 7);
      if (k === 0) return null;
      if (k === 1) return rnd(2) === 0;
      if (k === 2) return (rnd(2000) - 1000) / [1, 3, 7, 1e9][rnd(4)]!;
      if (k === 3) return strings[rnd(strings.length)];
      if (k === 4) return Array.from({ length: rnd(4) }, () => gen(d + 1));
      const o: Record<string, unknown> = {};
      for (let i = rnd(5); i > 0; i--) o[`k${strings[rnd(strings.length)]!}${rnd(3)}`] = gen(d + 1); // no array-index names
      return o;
    };
    for (let i = 0; i < 500; i++) {
      const v = gen(0);
      const text = canonicalJson(v);
      expect(parseCanonicalJson(enc(text))?.value).toEqual(JSON.parse(text));
      const loose = JSON.stringify(v, null, rnd(2) ? 0 : 1);
      expect(parseCanonicalJson(enc(loose)) !== null).toBe(loose === text);
    }
  });
});

describe("canonicalLength (G-PRJ-0): exact UTF-8 length without building the text", () => {
  const exact = (v: unknown) => expect(canonicalLength(v)).toBe(canonicalJsonBytes(v).length);

  test("scalars, escapes, multi-byte characters and surrogate pairs", () => {
    for (const v of [
      null,
      true,
      false,
      0,
      -0,
      1280,
      -1.5,
      1e21,
      1e-7,
      5e-324,
      2 ** 32 - 1,
      Number.MAX_SAFE_INTEGER,
      "",
      "plain ascii",
      '\u0000\u001f\b\f\n\r\t"\\/\u007f é',
      "ünïcode ✓ – ﬁ",
      "\u{1F600}\u{10FFFF}",
      "ࠀ߿\u0080\u007f",
    ])
      exact(v);
  });

  test("arrays and objects: punctuation, sorting irrelevance, undefined members omitted", () => {
    exact([]);
    exact({});
    exact([1, "a", null, [true, {}]]);
    exact({ b: 1, a: undefined, "\u{1F600}": [1, 2], é: { z: null } });
    exact({ only: undefined });
  });

  test("rejects exactly what canonicalJson rejects", () => {
    for (const bad of [NaN, Infinity, "\uD800", ["\uDC00"], { a: () => 1 }, [undefined]])
      expect(() => canonicalLength(bad)).toThrow(CanonicalJsonError);
  });

  test("randomised agreement with the encoder (2,000 values)", () => {
    let seed = 99;
    const rnd = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) >>> 0;
      return seed % n;
    };
    const strings = ["", "a", "é", "\u{1F600}", "\n", "\u0000", "✓ﬁ", "pth_12", '"\\'];
    const gen = (d: number): unknown => {
      const k = rnd(d > 3 ? 4 : 7);
      if (k === 0) return null;
      if (k === 1) return rnd(2) === 0;
      if (k === 2) return (rnd(4000) - 2000) / [1, 3, 7, 1e9, 1e-9][rnd(5)]!;
      if (k === 3) return strings[rnd(strings.length)]!.repeat(rnd(4));
      if (k === 4) return Array.from({ length: rnd(5) }, () => gen(d + 1));
      const o: Record<string, unknown> = {};
      for (let i = rnd(6); i > 0; i--) o[`k${strings[rnd(strings.length)]!}${rnd(3)}`] = gen(d + 1);
      return o;
    };
    for (let i = 0; i < 2000; i++) exact(gen(0));
  });
});
