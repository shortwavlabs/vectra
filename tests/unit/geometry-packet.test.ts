import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import {
  blockLayout,
  canonicalJson,
  decodeBlock,
  decodeRecord,
  encodeBlock,
  encodeRecord,
} from "../../src/geometry/packet/codec.ts";
import {
  type GeometryPacket,
  type Limits,
  PacketError,
  PRODUCT_LIMITS,
} from "../../src/geometry/packet/types.ts";
import { packetSizes, validatePacket } from "../../src/geometry/packet/validate.ts";

interface Case {
  id: string;
  kind: "arrays" | "bytes" | "manifest";
  expect: string;
  tsOnly?: boolean;
  manifest: Record<string, unknown>;
  arrays?: Record<string, (number | string)[]>;
  arrayTypes?: Record<string, string>;
  detach?: string[];
  blockHex?: string;
  limits?: Limits;
  derived?: { anchors: number; pathAnchors: number[]; subpathStart: number[]; bounds: number[] };
}

const suite = JSON.parse(
  readFileSync(new URL("../fixtures/packet-conformance/cases.json", import.meta.url), "utf8"),
) as { cases: Case[] };

const TYPES: Record<string, new (v: number[]) => ArrayLike<number>> = {
  verbs: Uint8Array,
  coords: Float64Array,
  verbOffsets: Uint32Array,
  coordOffsets: Uint32Array,
  styleIndex: Uint32Array,
  groupIndex: Uint32Array,
};
const ALT_TYPES: Record<string, new (v: number[]) => unknown> = {
  Float32Array,
  Array: Array as unknown as new (v: number[]) => unknown,
};
const num = (v: number | string) =>
  v === "NaN" ? NaN : v === "Infinity" ? Infinity : v === "-Infinity" ? -Infinity : (v as number);
const hexBytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));

function packetOf(c: Case): Record<string, unknown> & { manifest: unknown } {
  const p: Record<string, unknown> & { manifest: unknown } = {
    manifest: structuredClone(c.manifest),
  };
  for (const [k, T] of Object.entries(TYPES)) {
    const values = (c.arrays?.[k] ?? []).map(num);
    const alt = c.arrayTypes?.[k];
    p[k] = alt === "Array" ? Array.from(values) : alt ? new ALT_TYPES[alt]!(values) : new T(values);
  }
  for (const k of c.detach ?? []) {
    const buf = (p[k] as Float64Array).buffer;
    structuredClone(buf, { transfer: [buf] });
  }
  return p;
}

function run(c: Case): { code: string; derived?: ReturnType<typeof validatePacket> } {
  const limits = c.limits ?? PRODUCT_LIMITS;
  try {
    if (c.kind === "manifest") {
      // Steps 1–2 only: the manifest is checked before any block is read or allocated.
      decodeBlock(c.manifest, new Uint8Array(0), limits);
      return { code: "ok" };
    }
    const p =
      c.kind === "bytes" ? decodeBlock(c.manifest, hexBytes(c.blockHex!), limits) : packetOf(c);
    return {
      code: "ok",
      derived: validatePacket(p as GeometryPacket & Record<string, unknown>, limits),
    };
  } catch (e) {
    if (!(e instanceof PacketError)) throw e;
    return { code: e.code };
  }
}

describe("shared conformance fixtures (C3)", () => {
  test("the suite covers the review's cases plus G-ENG additions", () => {
    expect(suite.cases.length).toBeGreaterThanOrEqual(45);
  });
  for (const c of suite.cases) {
    test(`${c.id} → ${c.expect}`, () => {
      const got = run(c);
      expect(got.code).toBe(c.expect);
      if (c.expect === "ok" && c.derived) {
        const d = got.derived!;
        expect(d.anchors).toBe(c.derived.anchors);
        expect(Array.from(d.pathAnchors)).toEqual(c.derived.pathAnchors);
        expect(Array.from(d.subpathStart)).toEqual(c.derived.subpathStart);
        expect(Array.from(d.bounds)).toEqual(c.derived.bounds);
      }
    });
  }
});

const base = () => {
  const c = suite.cases.find((x) => x.id === "valid")!;
  return packetOf(c) as unknown as GeometryPacket;
};

describe("C3.0 codec", () => {
  test("block length, padding and accounting follow the contract formulas", () => {
    for (const [p, v, c] of [
      [0, 0, 0],
      [1, 1, 2],
      [4, 17, 32],
      [1_000_000, 2_000_000, 6_000_000],
    ] as const) {
      const { inMemory, derivedMax } = packetSizes(p, v, c);
      expect(inMemory).toBe(v + 8 * c + 16 * p + 8);
      expect(derivedMax).toBe(36 * p + 4 * v);
      expect(blockLayout(p, v, c).block - inMemory).toBe(8 + ((8 - (v % 8)) % 8));
    }
  });

  test("the TS block equals the shared fixture bytes (same bytes as the Rust encoder)", () => {
    const bytes = suite.cases.find((x) => x.id === "block-valid")!.blockHex!;
    expect(Buffer.from(encodeBlock(base())).toString("hex")).toBe(bytes);
  });

  test("decodeBlock returns fresh whole-buffer arrays that round-trip", () => {
    const p = base();
    const back = decodeBlock(p.manifest, encodeBlock(p));
    const buffers = new Set<ArrayBufferLike>();
    for (const k of [
      "verbs",
      "coords",
      "verbOffsets",
      "coordOffsets",
      "styleIndex",
      "groupIndex",
    ] as const) {
      expect(Array.from(back[k])).toEqual(Array.from(p[k]));
      expect(back[k].byteOffset).toBe(0);
      expect(back[k].byteLength).toBe(back[k].buffer.byteLength);
      buffers.add(back[k].buffer);
    }
    expect(buffers.size).toBe(6);
    expect(validatePacket(back as GeometryPacket & Record<string, unknown>).anchors).toBe(14);
  });

  test("records round-trip and are deterministic", () => {
    const p = base();
    const rec = encodeRecord(p);
    expect(encodeRecord(decodeRecord(rec))).toEqual(rec);
    const lm = new DataView(rec.buffer).getUint32(0, true);
    expect(new TextDecoder().decode(rec.subarray(4, 4 + lm))).toBe(canonicalJson(p.manifest));
    expect((4 + lm + ((8 - ((4 + lm) % 8)) % 8)) % 8).toBe(0);
  });

  test("record errors are typed", () => {
    const rec = encodeRecord(base());
    const code = (b: Uint8Array) => {
      try {
        decodeRecord(b);
        return "ok";
      } catch (e) {
        return (e as PacketError).code;
      }
    };
    expect(code(rec.subarray(0, 3))).toBe("length");
    const huge = rec.slice();
    new DataView(huge.buffer).setUint32(0, 2 ** 30, true);
    expect(code(huge)).toBe("budget");
    const lm = new DataView(rec.buffer).getUint32(0, true);
    if ((4 + lm) % 8 !== 0) {
      const pad = rec.slice();
      pad[4 + lm] = 1;
      expect(code(pad)).toBe("padding");
    }
    const notJson = rec.slice();
    notJson[4] = 0x7b + 1;
    expect(code(notJson)).toBe("manifest");
    expect(code(rec.subarray(0, rec.length - 8))).toBe("length");
  });

  test("canonical JSON sorts keys by UTF-16 code units and writes -0 as 0", () => {
    expect(canonicalJson({ b: 1, a: [-0, 1.5, "x"], lay_10: null, lay_9: true })).toBe(
      '{"a":[0,1.5,"x"],"b":1,"lay_10":null,"lay_9":true}',
    );
    expect(() => canonicalJson({ x: NaN })).toThrow(PacketError);
  });
});
