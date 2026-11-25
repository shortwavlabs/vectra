// Generates cases.json: the shared GeometryPacket v1 conformance suite (G-0 contract C3).
// Seeded from the independent review's 27 adversarial cases (R01, bench/adversarial.mjs),
// adapted to the C3 manifest (`packetVersion`, integer count rules), plus byte-serialisation
// (C3.0) and manifest cases. Both validators run every case and must return the same code.
// Usage: node tests/fixtures/packet-conformance/generate.mjs && pnpm exec vp fmt <dir>/cases.json
import { writeFileSync } from "node:fs";

const BASE_MANIFEST = {
  packetVersion: 1,
  width: 64,
  height: 48,
  pathCount: 4,
  verbCount: 17,
  coordCount: 32,
  styles: [
    { fill: 0xff0000ff, paletteId: "red", stroke: null, evenOdd: true },
    { fill: null, paletteId: null, stroke: { color: 0x000000ff, width: 2 }, evenOdd: false },
    { fill: 0x00ff00ff, paletteId: null, stroke: null, evenOdd: false },
  ],
  groups: [
    { id: "g0", clip: null },
    { id: "g1", clip: { x: 0, y: 0, width: 50, height: 50 } },
  ],
};
// p0 M L L L Z (closed square) · p1 M C · p2 two closed triangles · p3 M L
const BASE_ARRAYS = {
  verbs: [0, 1, 1, 1, 3, 0, 2, 0, 1, 1, 3, 0, 1, 1, 3, 0, 1],
  coords: [
    0, 0, 10, 0, 10, 10, 0, 10, 20, 20, 25, 20, 30, 25, 30, 30, 1, 1, 5, 1, 5, 5, 2, 2, 3, 2, 3, 3,
    40, 40, 45, 45,
  ],
  verbOffsets: [0, 5, 7, 15, 17],
  coordOffsets: [0, 8, 16, 28, 32],
  styleIndex: [0, 1, 2, 0],
  groupIndex: [0, 0, 1, 1],
};
const BASE_DERIVED = {
  anchors: 14,
  pathAnchors: [4, 2, 6, 2],
  subpathStart: [0, 5, 7, 11, 15],
  bounds: [0, 0, 10, 10, 20, 20, 30, 30, 1, 1, 5, 5, 40, 40, 45, 45],
};

const clone = (v) => structuredClone(v);
const cases = [];
const arrays = (id, source, expect, mutate = () => {}, extra = {}) => {
  const c = {
    id,
    source,
    kind: "arrays",
    expect,
    manifest: clone(BASE_MANIFEST),
    arrays: clone(BASE_ARRAYS),
    ...extra,
  };
  mutate(c);
  cases.push(c);
};
const manifestOnly = (id, source, expect, patch) =>
  cases.push({
    id,
    source,
    kind: "manifest",
    expect,
    manifest: { ...clone(BASE_MANIFEST), ...patch },
  });

const R = "review R01 adversarial";
arrays("valid", `${R}: valid packet`, "ok", () => {}, { derived: BASE_DERIVED });
arrays(
  "verb-offsets-decreasing",
  `${R}: verb offsets decreasing`,
  "offsets",
  (c) => (c.arrays.verbOffsets[3] = c.arrays.verbOffsets[1]),
);
arrays(
  "verb-offset-beyond-array",
  `${R}: verb offset beyond array`,
  "offsets",
  (c) => (c.arrays.verbOffsets[2] = 1e9),
);
arrays("bad-sentinel", `${R}: bad sentinel`, "offsets", (c) => (c.arrays.verbOffsets[4] -= 1));
arrays(
  "surplus-coordinates",
  `${R}: coordinate offsets inconsistent (surplus)`,
  "arity",
  (c) => (c.arrays.coordOffsets[1] += 2),
);
arrays(
  "too-few-coordinates",
  `${R}: too few coordinates for verbs`,
  "arity",
  (c) => (c.arrays.coordOffsets[1] -= 2),
);
arrays("coords-shorter-than-manifest", `${R}: coord array shorter than manifest`, "length", (c) =>
  c.arrays.coords.splice(-2),
);
arrays("nan-coordinate", `${R}: NaN coordinate`, "coord", (c) => (c.arrays.coords[5] = "NaN"));
arrays(
  "infinite-coordinate",
  `${R}: +Infinity coordinate`,
  "coord",
  (c) => (c.arrays.coords[7] = "Infinity"),
);
arrays(
  "coordinate-beyond-1e6",
  `${R}: coordinate beyond ±1e6`,
  "coord",
  (c) => (c.arrays.coords[9] = 1.5e6),
);
arrays("unknown-opcode", `${R}: unknown opcode`, "opcode", (c) => (c.arrays.verbs[1] = 7));
arrays(
  "segment-before-moveto",
  `${R}: segment before moveTo`,
  "grammar",
  (c) => (c.arrays.verbs[0] = 1),
);
arrays(
  "segment-after-close-without-moveto",
  `${R}: segment after close without moveTo`,
  "grammar",
  (c) => (c.arrays.verbs[5] = 1),
);
arrays(
  "style-index-out-of-range",
  `${R}: style index out of range`,
  "ref",
  (c) => (c.arrays.styleIndex[0] = 999),
);
arrays(
  "group-index-out-of-range",
  `${R}: group index out of range`,
  "ref",
  (c) => (c.arrays.groupIndex[0] = 999),
);
arrays(
  "groups-not-contiguous",
  `${R}: groups not contiguous in paint order`,
  "ref",
  (c) => (c.arrays.groupIndex[3] = 0),
);
arrays("wrong-type-float32-coords", `${R}: wrong array type (Float32 coords)`, "type", () => {}, {
  tsOnly: true,
  arrayTypes: { coords: "Float32Array" },
});
arrays(
  "wrong-type-plain-array-offsets",
  `${R}: wrong array type (plain array offsets)`,
  "type",
  () => {},
  { tsOnly: true, arrayTypes: { verbOffsets: "Array" } },
);
arrays("detached-coords", `${R}: detached buffer (transferred away)`, "length", () => {}, {
  tsOnly: true,
  detach: ["coords"],
});
arrays(
  "unsupported-version",
  `${R}: unsupported version`,
  "version",
  (c) => (c.manifest.packetVersion = 2),
);
arrays("negative-count", `${R}: negative count`, "manifest", (c) => (c.manifest.pathCount = -1));
arrays(
  "non-integer-count",
  `${R}: non-integer count`,
  "manifest",
  (c) => (c.manifest.verbCount = 1.5),
);
arrays(
  "artboard-out-of-range",
  `${R}: artboard out of range`,
  "manifest",
  (c) => (c.manifest.width = 1e9),
);
arrays(
  "anchor-budget-exceeded",
  `${R}: anchor budget exceeded (limit lowered to 13; the base has 14)`,
  "budget",
  () => {},
  {
    limits: { maxPaths: 1_000_000, maxAnchors: 13, maxBytes: 512 * 2 ** 20 },
  },
);
// The review expected `budget` for a declared 2^32 coordinates; C3 makes counts integers in
// [0, 2^32-1], so 2^32 is a `manifest` error and 2^32-1 exercises the coordinate cap.
manifestOnly(
  "declared-max-u32-coords",
  `${R}: declared 2^32 coords (adapted to 2^32-1)`,
  "budget",
  { coordCount: 2 ** 32 - 1 },
);
manifestOnly("declared-2pow32-coords", "C3 integer range: 2^32 is out of range", "manifest", {
  coordCount: 2 ** 32,
});
manifestOnly("declared-10m-paths", `${R}: declared 10M paths`, "budget", { pathCount: 10_000_000 });
manifestOnly("declared-1gib-verbs", `${R}: declared 1 GiB total (verbCount 2^30)`, "budget", {
  verbCount: 2 ** 30,
});

// ---- G-ENG additions: manifest rules (C3 step 2) ----
const G = "G-ENG";
arrays(
  "empty-packet",
  `${G}: pathCount 0 is valid`,
  "ok",
  (c) => {
    Object.assign(c.manifest, {
      pathCount: 0,
      verbCount: 0,
      coordCount: 0,
      styles: [],
      groups: [],
    });
    c.arrays = {
      verbs: [],
      coords: [],
      verbOffsets: [0],
      coordOffsets: [0],
      styleIndex: [],
      groupIndex: [],
    };
  },
  { derived: { anchors: 0, pathAnchors: [], subpathStart: [], bounds: [] } },
);
arrays(
  "missing-packet-version",
  `${G}: missing packetVersion`,
  "version",
  (c) => delete c.manifest.packetVersion,
);
arrays(
  "unknown-manifest-key",
  `${G}: unknown manifest key`,
  "manifest",
  (c) => (c.manifest.extra = 1),
);
arrays(
  "missing-manifest-key",
  `${G}: missing manifest key`,
  "manifest",
  (c) => delete c.manifest.groups,
);
arrays(
  "invalid-palette-id",
  `${G}: paletteId violates the scene-v1 id rule`,
  "manifest",
  (c) => (c.manifest.styles[0].paletteId = "red ink"),
);
arrays(
  "invalid-group-id",
  `${G}: group id longer than 64 bytes`,
  "manifest",
  (c) => (c.manifest.groups[0].id = "g".repeat(65)),
);
arrays(
  "zero-width-clip",
  `${G}: clip with zero width`,
  "manifest",
  (c) => (c.manifest.groups[1].clip.width = 0),
);
arrays(
  "zero-stroke-width",
  `${G}: stroke width 0`,
  "manifest",
  (c) => (c.manifest.styles[1].stroke.width = 0),
);
arrays(
  "fill-not-u32",
  `${G}: fill colour above 2^32-1`,
  "manifest",
  (c) => (c.manifest.styles[0].fill = 2 ** 32),
);
arrays(
  "unknown-style-key",
  `${G}: unknown style key`,
  "manifest",
  (c) => (c.manifest.styles[2].blend = "multiply"),
);
arrays(
  "verb-count-over-cap",
  `${G}: verbCount above 2 x anchor cap (lowered limits)`,
  "budget",
  () => {},
  {
    limits: { maxPaths: 1_000_000, maxAnchors: 8, maxBytes: 512 * 2 ** 20 },
  },
);
arrays(
  "byte-cap",
  `${G}: M_mem + D_max above maxBytes (limit 556; the base needs 345 + 212 = 557)`,
  "budget",
  () => {},
  {
    limits: { maxPaths: 1_000_000, maxAnchors: 1_000_000, maxBytes: 556 },
  },
);
arrays(
  "integer-written-as-float",
  `${G}: a count written as 4.0 is the integer 4 (as in JavaScript)`,
  "ok",
  () => {},
  {
    derived: BASE_DERIVED,
    rawCountAsFloat: true,
  },
);

// ---- C3.0 byte serialisation ----
const align8 = (x) => x + ((8 - (x % 8)) % 8);
function encodeBlock(m, a) {
  const lens = [
    m.verbCount,
    8 * m.coordCount,
    4 * (m.pathCount + 1),
    4 * (m.pathCount + 1),
    4 * m.pathCount,
    4 * m.pathCount,
  ];
  const offs = [];
  let at = 0;
  lens.forEach((l, k) => {
    offs.push(at);
    at += l;
    if (k < 5) at = align8(at);
  });
  const bytes = new Uint8Array(align8(at));
  const dv = new DataView(bytes.buffer);
  a.verbs.forEach((v, i) => (bytes[offs[0] + i] = v));
  a.coords.forEach((v, i) => dv.setFloat64(offs[1] + 8 * i, v, true));
  [a.verbOffsets, a.coordOffsets, a.styleIndex, a.groupIndex].forEach((arr, k) =>
    arr.forEach((v, i) => dv.setUint32(offs[k + 2] + 4 * i, v, true)),
  );
  return { bytes, offs, lens };
}
const hex = (b) => Buffer.from(b).toString("hex");
const block = encodeBlock(BASE_MANIFEST, BASE_ARRAYS);
const bytesCase = (id, source, expect, bytes, extra = {}) =>
  cases.push({
    id,
    source,
    kind: "bytes",
    expect,
    manifest: clone(BASE_MANIFEST),
    blockHex: hex(bytes),
    ...extra,
  });
bytesCase(
  "block-valid",
  `${G}: C3.0 block of the base packet (B = 360, M_mem = 345)`,
  "ok",
  block.bytes,
  { derived: BASE_DERIVED },
);
bytesCase("block-truncated", `${G}: block 8 bytes short`, "length", block.bytes.slice(0, -8));
bytesCase(
  "block-oversized",
  `${G}: block 8 bytes long`,
  "length",
  Uint8Array.from([...block.bytes, 0, 0, 0, 0, 0, 0, 0, 0]),
);
{
  const b = block.bytes.slice();
  b[17] = 1; // first padding byte after the 17 verb bytes
  bytesCase(
    "block-nonzero-padding-after-verbs",
    `${G}: non-zero padding after verbs`,
    "padding",
    b,
  );
}
{
  const b = block.bytes.slice();
  b[block.offs[2] + block.lens[2]] = 0xff; // padding between verbOffsets (20 bytes) and coordOffsets
  bytesCase(
    "block-nonzero-padding-between-offsets",
    `${G}: non-zero padding between u32 sections`,
    "padding",
    b,
  );
}
{
  const b = block.bytes.slice();
  new DataView(b.buffer).setFloat64(block.offs[1] + 8 * 3, NaN, true);
  bytesCase(
    "block-nan-coordinate",
    `${G}: block decodes, then validation rejects a NaN`,
    "coord",
    b,
  );
}

let text = JSON.stringify(
  {
    schema: "vectra-packet-conformance/1",
    contract: "G-0 C3 (GeometryPacket v1)",
    generator: "tests/fixtures/packet-conformance/generate.mjs",
    cases,
  },
  null,
  2,
);
// Write one count as 4.0 for the float-integer case (JSON.stringify would print 4).
text = text.replace(/("id": "integer-written-as-float"[\s\S]*?"pathCount": )4,/, "$14.0,");
writeFileSync(new URL("./cases.json", import.meta.url), text + "\n");
console.log(`${cases.length} cases written`);
