// TEST-ONLY C3 adapter implementing the packet port (validator + C3.0 record codec).
// Derived from the review's experiments/rfc-002-review/bench/packet.mjs and corrected to the
// frozen C3/C3.0/C3.2 text (packetVersion key, u32 count ranges, exact M_mem + D_max cap,
// anchor-cap-derived P/V/C caps, style/group checks, pathAnchors, exact-size subpathStart,
// computed offsets, zero padding). Production code must never import this file (enforced by
// architecture.test.ts); the P1-A integration step replaces it with src/geometry/packet.

import { canonicalJsonBytes } from "../../persistence/canonical-json.ts";
import {
  type DerivedMetadata,
  type IncomingPacket,
  type PacketArrays,
  type PacketErrorCode,
  type PacketFailure,
  type PacketLimits,
  type PacketManifest,
  type PacketPort,
  SECTION_KEYS,
} from "../packet-port.ts";

const M = 0;
const Z = 3;
const ARITY = [2, 2, 6, 0] as const;
const MAX_COORD = 1e6;
const MAX_DIM = 16_384;
const U32_MAX = 2 ** 32 - 1;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MANIFEST_KEYS = [
  "packetVersion",
  "width",
  "height",
  "pathCount",
  "verbCount",
  "coordCount",
  "styles",
  "groups",
];

const fail = (code: PacketErrorCode, message: string): PacketFailure => ({
  ok: false,
  code,
  message,
});
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const exactKeys = (o: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
const isU32 = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= U32_MAX;
const isCoord = (v: unknown): v is number =>
  typeof v === "number" && v >= -MAX_COORD && v <= MAX_COORD;
export const align8 = (x: number) => x + ((8 - (x % 8)) % 8);

function checkStyle(s: unknown): boolean {
  if (!isObj(s) || !exactKeys(s, ["fill", "paletteId", "stroke", "evenOdd"])) return false;
  if (s.fill !== null && !isU32(s.fill)) return false;
  if (s.paletteId !== null && !(typeof s.paletteId === "string" && ID_RE.test(s.paletteId)))
    return false;
  if (s.stroke !== null) {
    const k = s.stroke;
    if (!isObj(k) || !exactKeys(k, ["color", "width"]) || !isU32(k.color)) return false;
    if (!(typeof k.width === "number" && k.width > 0 && k.width <= 1000)) return false;
  }
  return typeof s.evenOdd === "boolean";
}

function checkGroup(g: unknown): boolean {
  if (!isObj(g) || !exactKeys(g, ["id", "clip"])) return false;
  if (!(typeof g.id === "string" && ID_RE.test(g.id))) return false;
  if (g.clip === null) return true;
  const c = g.clip;
  if (!isObj(c) || !exactKeys(c, ["x", "y", "width", "height"])) return false;
  return (
    isCoord(c.x) &&
    isCoord(c.y) &&
    isCoord(c.width) &&
    isCoord(c.height) &&
    c.width > 0 &&
    c.height > 0
  );
}

/** Validation steps 1–2 (version, manifest fields, pre-allocation caps). */
function checkManifest(m: unknown, limits: PacketLimits): PacketFailure | null {
  if (!isObj(m) || m.packetVersion !== 1)
    return fail("version", `unsupported packetVersion ${String(isObj(m) ? m.packetVersion : m)}`);
  if (!exactKeys(m, MANIFEST_KEYS)) return fail("manifest", "unknown or missing manifest field");
  for (const k of ["width", "height"] as const) {
    const v = m[k];
    if (!(typeof v === "number" && v > 0 && v <= MAX_DIM))
      return fail("manifest", `${k} out of range`);
  }
  for (const k of ["pathCount", "verbCount", "coordCount"] as const)
    if (!isU32(m[k])) return fail("manifest", `${k} is not an integer in [0, 2^32-1]`);
  if (!Array.isArray(m.styles) || !Array.isArray(m.groups))
    return fail("manifest", "styles and groups must be arrays");
  const P = m.pathCount as number;
  const V = m.verbCount as number;
  const C = m.coordCount as number;
  const cap = limits.maxAnchors;
  if (P > limits.maxPaths || P > cap) return fail("budget", `pathCount ${P} exceeds the cap`);
  if (V > 2 * cap) return fail("budget", `verbCount ${V} exceeds 2 x anchor cap`);
  if (C > 6 * cap) return fail("budget", `coordCount ${C} exceeds 6 x anchor cap`);
  if (m.styles.length > limits.maxStyles) return fail("budget", "too many styles");
  if (m.groups.length > limits.maxGroups) return fail("budget", "too many groups");
  const memPlusDerivedMax = V + 8 * C + 16 * P + 8 + (36 * P + 4 * V);
  if (!Number.isSafeInteger(memPlusDerivedMax)) return fail("budget", "size arithmetic overflow");
  if (memPlusDerivedMax > limits.maxBytes)
    return fail("budget", `M_mem + D_max = ${memPlusDerivedMax} exceeds ${limits.maxBytes}`);
  for (const s of m.styles) if (!checkStyle(s)) return fail("manifest", "invalid style entry");
  for (const g of m.groups) if (!checkGroup(g)) return fail("manifest", "invalid group entry");
  return null;
}

const TYPES = [Uint8Array, Float64Array, Uint32Array, Uint32Array, Uint32Array, Uint32Array];

function validate(
  manifest: PacketManifest,
  arrays: PacketArrays,
  limits: PacketLimits,
): { ok: true; derived: DerivedMetadata } | PacketFailure {
  const mf = checkManifest(manifest, limits);
  if (mf) return mf;
  // Step 3: types, then lengths.
  const a = arrays as unknown as Record<string, unknown>;
  for (let k = 0; k < 6; k++) {
    const key = SECTION_KEYS[k]!;
    if (!(a[key] instanceof TYPES[k]!)) return fail("type", `${key} is not ${TYPES[k]!.name}`);
  }
  const { verbs, coords, verbOffsets: vo, coordOffsets: co, styleIndex, groupIndex } = arrays;
  const P = manifest.pathCount;
  if (verbs.length !== manifest.verbCount) return fail("length", "verbs length != verbCount");
  if (coords.length !== manifest.coordCount) return fail("length", "coords length != coordCount");
  if (vo.length !== P + 1 || co.length !== P + 1) return fail("length", "offsets length != P+1");
  if (styleIndex.length !== P || groupIndex.length !== P)
    return fail("length", "per-path length != P");
  // Step 4: sentinels.
  if (vo[0] !== 0 || co[0] !== 0 || vo[P] !== verbs.length || co[P] !== coords.length)
    return fail("offsets", "sentinel");
  const bounds = new Float64Array(4 * P);
  const pathAnchors = new Uint32Array(P);
  const nStyles = manifest.styles.length;
  const nGroups = manifest.groups.length;
  let anchors = 0;
  let subpaths = 0;
  // Steps 5–12, interleaved per path and per verb as in the review prototype.
  for (let i = 0; i < P; i++) {
    const v0 = vo[i]!;
    const v1 = vo[i + 1]!;
    let c = co[i]!;
    const c1 = co[i + 1]!;
    if (v1 <= v0 || c1 < c) return fail("offsets", `path ${i}: offsets not increasing`);
    if (v1 > verbs.length || c1 > coords.length)
      return fail("offsets", `path ${i}: offset beyond array`);
    if (styleIndex[i]! >= nStyles || groupIndex[i]! >= nGroups)
      return fail("ref", `path ${i}: style/group reference out of range`);
    if (i > 0 && groupIndex[i]! < groupIndex[i - 1]!)
      return fail("ref", `path ${i}: group order decreasing`);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let open = false;
    let pathA = 0;
    for (let k = v0; k < v1; k++) {
      const op = verbs[k]!;
      if (op > Z) return fail("opcode", `path ${i}: opcode ${op}`);
      if (op === M) {
        open = true;
        subpaths++;
      } else if (!open) return fail("grammar", `path ${i}: segment without open subpath`);
      if (op === Z) {
        open = false;
        continue;
      }
      const end = c + ARITY[op]!;
      if (end > c1) return fail("arity", `path ${i}: too few coordinates`);
      pathA++;
      for (; c < end; c += 2) {
        const x = coords[c]!;
        const y = coords[c + 1]!;
        // False for NaN, so this rejects NaN, ±Infinity and |v| > 1e6.
        if (!(x >= -MAX_COORD && x <= MAX_COORD && y >= -MAX_COORD && y <= MAX_COORD))
          return fail("coord", `path ${i}: non-finite or out-of-range coordinate`);
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (c !== c1) return fail("arity", `path ${i}: ${c1 - c} surplus coordinates`);
    anchors += pathA;
    if (anchors > limits.maxAnchors) return fail("budget", `anchors exceed ${limits.maxAnchors}`);
    pathAnchors[i] = pathA;
    bounds[4 * i] = x0;
    bounds[4 * i + 1] = y0;
    bounds[4 * i + 2] = x1;
    bounds[4 * i + 3] = y1;
  }
  // subpathStart at exact size once S is known (C3.2), filled by a rescan of the verbs.
  const subpathStart = new Uint32Array(subpaths);
  for (let k = 0, s = 0; s < subpaths; k++) if (verbs[k] === M) subpathStart[s++] = k;
  return { ok: true, derived: { bounds, pathAnchors, subpathStart, anchors } };
}

/** C3.0 section offsets and block length from the manifest counts. */
export function blockLayout(m: Pick<PacketManifest, "pathCount" | "verbCount" | "coordCount">) {
  const P = m.pathCount;
  const len = [m.verbCount, 8 * m.coordCount, 4 * (P + 1), 4 * (P + 1), 4 * P, 4 * P];
  const off = [0];
  for (let k = 1; k < 6; k++) off.push(align8(off[k - 1]! + len[k - 1]!));
  return { off, len, B: align8(off[5]! + len[5]!) };
}

function encodeRecord(manifest: PacketManifest, arrays: PacketArrays): Uint8Array {
  const mBytes = canonicalJsonBytes(manifest);
  const head = align8(4 + mBytes.length);
  const { off, len, B } = blockLayout(manifest);
  const out = new Uint8Array(head + B);
  new DataView(out.buffer).setUint32(0, mBytes.length, true);
  out.set(mBytes, 4);
  SECTION_KEYS.forEach((key, k) => {
    const a = arrays[key];
    if (a.byteLength !== len[k]) throw new Error(`encodeRecord: ${key} length != manifest`);
    out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), head + off[k]!);
  });
  return out;
}

const zeros = (b: Uint8Array, from: number, to: number) => {
  for (let i = from; i < to; i++) if (b[i] !== 0) return false;
  return true;
};

function decodeRecord(
  bytes: Uint8Array,
  limits: PacketLimits,
): { ok: true; packet: IncomingPacket } | PacketFailure {
  if (bytes.length < 4) return fail("length", "record shorter than its length field");
  const Lm = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (Lm > limits.maxManifestBytes) return fail("budget", `manifest length ${Lm} exceeds cap`);
  if (4 + Lm > bytes.length) return fail("length", "manifest extends past the record");
  let manifest: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(4, 4 + Lm));
    manifest = JSON.parse(text);
  } catch {
    return fail("manifest", "manifest is not UTF-8 JSON");
  }
  // Counts are needed to compute the layout, so steps 1–2 run before the length check.
  const mf = checkManifest(manifest, limits);
  if (mf) return mf;
  const m = manifest as PacketManifest;
  const head = align8(4 + Lm);
  const { off, len, B } = blockLayout(m);
  if (bytes.length !== head + B)
    return fail("length", `record length ${bytes.length} != ${head + B}`);
  if (!zeros(bytes, 4 + Lm, head)) return fail("padding", "non-zero manifest padding");
  for (let k = 0; k < 6; k++) {
    const end = k < 5 ? off[k + 1]! : B;
    if (!zeros(bytes, head + off[k]! + len[k]!, head + end))
      return fail("padding", `non-zero padding after ${SECTION_KEYS[k]}`);
  }
  // Fresh, whole-buffer arrays (one slice per section), little-endian host (C2 startup check).
  const sec = (k: number) => bytes.slice(head + off[k]!, head + off[k]! + len[k]!).buffer;
  return {
    ok: true,
    packet: {
      manifest: m,
      verbs: new Uint8Array(sec(0)),
      coords: new Float64Array(sec(1)),
      verbOffsets: new Uint32Array(sec(2)),
      coordOffsets: new Uint32Array(sec(3)),
      styleIndex: new Uint32Array(sec(4)),
      groupIndex: new Uint32Array(sec(5)),
    },
  };
}

export const testPacketPort: PacketPort = Object.freeze({ validate, encodeRecord, decodeRecord });
