import { describe, expect, test } from "vite-plus/test";
import {
  DEFAULT_PACKET_LIMITS,
  type IncomingPacket,
  type PacketManifest,
  SECTION_KEYS,
} from "../packet-port.ts";
import { FIXTURE_SCENES, fixturePacket } from "./fixtures.ts";
import { align8, blockLayout, testPacketPort as port } from "./packet-adapter.ts";
import { syntheticPacket } from "./synthetic.ts";

const L = DEFAULT_PACKET_LIMITS;
const clone = (p: IncomingPacket): IncomingPacket => ({
  manifest: structuredClone(p.manifest),
  verbs: p.verbs.slice(),
  coords: p.coords.slice(),
  verbOffsets: p.verbOffsets.slice(),
  coordOffsets: p.coordOffsets.slice(),
  styleIndex: p.styleIndex.slice(),
  groupIndex: p.groupIndex.slice(),
});
const code = (p: IncomingPacket, limits = L) => {
  const r = port.validate(p.manifest, p, limits);
  return r.ok ? "accept" : r.code;
};
const good = syntheticPacket({ paths: 6, anchorsPerPath: 4, groups: 2, styles: 2, seed: 7 });
type Mut = (p: IncomingPacket & Record<string, unknown>) => void;
const m = (p: IncomingPacket) => p.manifest as unknown as Record<string, unknown>;

describe("test-only adapter: C3 validation codes", () => {
  // The review's adversarial cases (experiments/rfc-002-review/bench/adversarial.mjs), on C3 names.
  const cases: [string, string, Mut][] = [
    ["valid packet", "accept", () => {}],
    ["verb offsets decreasing", "offsets", (p) => (p.verbOffsets[3] = p.verbOffsets[1]!)],
    ["verb offset beyond array", "offsets", (p) => (p.verbOffsets[2] = 1e9)],
    ["bad sentinel", "offsets", (p) => (p.verbOffsets[p.verbOffsets.length - 1]! -= 1)],
    ["surplus coordinates", "arity", (p) => (p.coordOffsets[1]! += 2)],
    ["too few coordinates", "arity", (p) => (p.coordOffsets[1]! -= 2)],
    ["coords shorter than manifest", "length", (p) => (p.coords = p.coords.subarray(0, -2))],
    ["NaN coordinate", "coord", (p) => (p.coords[5] = NaN)],
    ["+Infinity coordinate", "coord", (p) => (p.coords[7] = Infinity)],
    ["coordinate beyond 1e6", "coord", (p) => (p.coords[9] = 1.5e6)],
    ["unknown opcode", "opcode", (p) => (p.verbs[1] = 7)],
    ["segment before moveTo", "grammar", (p) => (p.verbs[0] = 1)],
    ["segment after close", "grammar", (p) => (p.verbs[p.verbOffsets[1]!] = 1)],
    ["style index out of range", "ref", (p) => (p.styleIndex[0] = 999)],
    ["group index out of range", "ref", (p) => (p.groupIndex[0] = 999)],
    ["groups decreasing", "ref", (p) => (p.groupIndex[p.groupIndex.length - 1] = 0)],
    ["Float32 coords", "type", (p) => (p.coords = Float32Array.from(p.coords) as never)],
    ["plain array offsets", "type", (p) => (p.verbOffsets = Array.from(p.verbOffsets) as never)],
    [
      "detached buffer",
      "length",
      (p) => void structuredClone(p.coords.buffer, { transfer: [p.coords.buffer] }),
    ],
    ["unsupported version", "version", (p) => (m(p).packetVersion = 2)],
    ["legacy version key", "version", (p) => (delete m(p).packetVersion, (m(p).version = 1))],
    ["negative count", "manifest", (p) => (m(p).pathCount = -1)],
    ["non-integer count", "manifest", (p) => (m(p).verbCount = 1.5)],
    ["count above 2^32-1", "manifest", (p) => (m(p).coordCount = 2 ** 32)],
    ["artboard out of range", "manifest", (p) => (m(p).width = 1e9)],
    ["unknown manifest field", "manifest", (p) => (m(p).extra = 1)],
    ["bad palette id", "manifest", (p) => (p.manifest.styles[0]!.paletteId = "no spaces")],
    [
      "zero-area clip",
      "manifest",
      (p) => (p.manifest.groups[0]!.clip = { x: 0, y: 0, width: 0, height: 1 }),
    ],
    ["stroke width 0", "manifest", (p) => (p.manifest.styles[0]!.stroke = { color: 1, width: 0 })],
  ];
  for (const [name, want, mutate] of cases)
    test(name, () => {
      const p = clone(good);
      mutate(p as IncomingPacket & Record<string, unknown>);
      expect(code(p)).toBe(want);
    });

  test("running anchor budget", () => {
    expect(code(clone(good), { ...L, maxAnchors: 20 })).toBe("budget");
  });

  test("pre-allocation caps return budget for declarations near 2^32-1", () => {
    const base = good.manifest;
    for (const over of [
      { pathCount: 2 ** 32 - 1 },
      { verbCount: 2 ** 32 - 1 },
      { coordCount: 2 ** 32 - 1 },
      { pathCount: 1_000_001 },
      { verbCount: 2_000_001 },
      { coordCount: 6_000_001 },
    ]) {
      const r = port.validate({ ...base, ...over } as PacketManifest, good, L);
      expect(r.ok ? "accept" : r.code).toBe("budget");
    }
    // M_mem + D_max just above the byte cap, every count within its own cap.
    const r = port.validate(base, good, { ...L, maxBytes: 100 });
    expect(r.ok ? "accept" : r.code).toBe("budget");
  });

  test("derived metadata: bounds, pathAnchors, exact-size subpathStart", () => {
    const r = port.validate(good.manifest, good, L);
    if (!r.ok) throw new Error(r.message);
    const { pathAnchors, subpathStart, bounds, anchors } = r.derived;
    expect(anchors).toBe(24);
    expect([...pathAnchors]).toEqual([4, 4, 4, 4, 4, 4]);
    expect(subpathStart.length).toBe(6);
    expect([...subpathStart]).toEqual([0, 5, 10, 15, 20, 25]);
    expect(bounds.length).toBe(24);
    expect(bounds.every(Number.isFinite)).toBe(true);
  });

  test("every regression fixture validates; anchors match Scene::validate counting", () => {
    for (const [name, { scene }] of FIXTURE_SCENES) {
      const p = fixturePacket(name);
      const r = port.validate(p.manifest, p, L);
      expect(r.ok, name).toBe(true);
      let anchors = 0;
      for (const g of scene.groups)
        for (const path of g.paths) anchors += path.verbs.replaceAll("Z", "").length;
      if (r.ok) expect(r.derived.anchors).toBe(anchors);
    }
  });
});

describe("test-only adapter: C3.0 geometry record", () => {
  test("round trip: fresh whole-buffer arrays, B − M_mem in [8, 15], G = align8(4+Lm) + B", () => {
    for (const name of FIXTURE_SCENES.keys()) {
      const p = fixturePacket(name);
      const rec = port.encodeRecord(p.manifest, p);
      const Lm = new DataView(rec.buffer).getUint32(0, true);
      const { B } = blockLayout(p.manifest);
      const mem = SECTION_KEYS.reduce((s, k) => s + p[k].byteLength, 0);
      expect(B - mem).toBeGreaterThanOrEqual(8);
      expect(B - mem).toBeLessThanOrEqual(15);
      expect(rec.length).toBe(align8(4 + Lm) + B);
      const d = port.decodeRecord(rec, L);
      if (!d.ok) throw new Error(d.message);
      const buffers = new Set<ArrayBufferLike>();
      for (const k of SECTION_KEYS) {
        const a = d.packet[k];
        expect(a.byteOffset).toBe(0);
        expect(a.byteLength).toBe(a.buffer.byteLength);
        expect(a.buffer).not.toBe(rec.buffer);
        buffers.add(a.buffer);
        expect([...a]).toEqual([...p[k]]);
      }
      expect(buffers.size).toBe(6);
      expect(d.packet.manifest).toEqual(p.manifest);
      expect(port.encodeRecord(d.packet.manifest, d.packet)).toEqual(rec);
    }
  });

  const rec = () => {
    const p = fixturePacket("circle-bw");
    return { p, r: port.encodeRecord(p.manifest, p) };
  };
  const dcode = (b: Uint8Array) => {
    const d = port.decodeRecord(b, L);
    return d.ok ? "accept" : d.code;
  };

  test("truncated and extended records → length", () => {
    const { r } = rec();
    expect(dcode(r.subarray(0, 3))).toBe("length");
    expect(dcode(r.subarray(0, r.length - 8))).toBe("length");
    const longer = new Uint8Array(r.length + 8);
    longer.set(r);
    expect(dcode(longer)).toBe("length");
  });

  test("manifest length beyond record → length; above 16 MiB → budget before reading", () => {
    const { r } = rec();
    const b = r.slice();
    new DataView(b.buffer).setUint32(0, b.length, true);
    expect(dcode(b)).toBe("length");
    new DataView(b.buffer).setUint32(0, 16 * 2 ** 20 + 1, true);
    expect(dcode(b)).toBe("budget");
  });

  test("non-zero padding after the manifest and between sections → padding", () => {
    const { p, r } = rec();
    const Lm = new DataView(r.buffer).getUint32(0, true);
    const head = align8(4 + Lm);
    if (head > 4 + Lm) {
      const b = r.slice();
      b[4 + Lm] = 1;
      expect(dcode(b)).toBe("padding");
    }
    const { off, len } = blockLayout(p.manifest);
    for (let k = 0; k < 6; k++) {
      const gapStart = head + off[k]! + len[k]!;
      const gapEnd = head + (k < 5 ? off[k + 1]! : r.length - head);
      if (gapEnd > gapStart) {
        const b = r.slice();
        b[gapEnd - 1] = 0xff;
        expect(dcode(b), `section ${k}`).toBe("padding");
      }
    }
  });

  test("declared huge counts → budget, decided before any section allocation", () => {
    const { p } = rec();
    const huge = { ...p.manifest, coordCount: 2 ** 32 - 1 };
    const mBytes = new TextEncoder().encode(JSON.stringify(huge));
    const b = new Uint8Array(align8(4 + mBytes.length));
    new DataView(b.buffer).setUint32(0, mBytes.length, true);
    b.set(mBytes, 4);
    expect(dcode(b)).toBe("budget");
  });

  test("manifest that is not JSON → manifest", () => {
    const b = new Uint8Array(16);
    new DataView(b.buffer).setUint32(0, 4, true);
    b.set([0x7b, 0x7b, 0x7b, 0x7b], 4);
    expect(dcode(b)).toBe("manifest");
  });
});
