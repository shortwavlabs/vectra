// The production GeometryPacket v1 validator (G-0 contract C3). Same step order, sub-order and
// error codes as the Rust validator (crates/vector-engine/src/packet.rs); both run
// tests/fixtures/packet-conformance/cases.json. Steps 5–12 run per path, in path order.
import {
  type Derived,
  type GroupEntry,
  type Limits,
  type Manifest,
  MAX_ARTBOARD,
  MAX_COORD,
  MAX_TABLE_ENTRIES,
  MAX_U32,
  PacketError,
  PRODUCT_LIMITS,
  type Style,
  VERB_M,
  VERB_Z,
} from "./types.ts";

const ARITY = [2, 2, 6, 0] as const;
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

const fail = (code: PacketError["code"], message: string): never => {
  throw new PacketError(code, message);
};

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const exactKeys = (o: Obj, keys: readonly string[]) =>
  Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
const isUint = (v: unknown, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const validDimension = (v: unknown): v is number => isFiniteNumber(v) && v > 0 && v <= MAX_ARTBOARD;

/** The scene-v1 id rule: 1–64 bytes of ASCII [A-Za-z0-9_-]. */
export const validId = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);

function validClip(v: unknown): boolean {
  if (v === null) return true;
  if (!isObject(v) || !exactKeys(v, ["x", "y", "width", "height"])) return false;
  const vals = [v.x, v.y, v.width, v.height];
  if (!vals.every((n) => isFiniteNumber(n) && Math.abs(n) <= MAX_COORD)) return false;
  return (v.width as number) > 0 && (v.height as number) > 0;
}

function validStyle(v: unknown): v is Style {
  if (!isObject(v) || !exactKeys(v, ["fill", "paletteId", "stroke", "evenOdd"])) return false;
  if (v.fill !== null && !isUint(v.fill, MAX_U32)) return false;
  if (v.paletteId !== null && !validId(v.paletteId)) return false;
  if (v.stroke !== null) {
    const s = v.stroke;
    if (!isObject(s) || !exactKeys(s, ["color", "width"])) return false;
    if (!(isFiniteNumber(s.width) && s.width > 0 && s.width <= 1000)) return false;
    if (!isUint(s.color, MAX_U32)) return false;
  }
  return typeof v.evenOdd === "boolean";
}

function validGroup(v: unknown): v is GroupEntry {
  return isObject(v) && exactKeys(v, ["id", "clip"]) && validId(v.id) && validClip(v.clip);
}

/** Exact sizes (C3.2). Counts must already be integers in [0, 2^32-1]. */
export function packetSizes(pathCount: number, verbCount: number, coordCount: number) {
  const inMemory = verbCount + 8 * coordCount + 16 * pathCount + 8;
  const derivedMax = 36 * pathCount + 4 * verbCount;
  if (!Number.isSafeInteger(inMemory + derivedMax)) fail("budget", "size arithmetic overflow");
  return { inMemory, derivedMax };
}

/** Steps 1–2 on a manifest object (from structured clone or JSON.parse). Sub-order within
 *  step 2: key set, artboard, counts, styles (table cap, entries), groups (table cap, entries),
 *  then caps P, V, C and M_mem + D_max. */
export function parseManifest(m: unknown, limits: Limits = PRODUCT_LIMITS): Manifest {
  if (!isObject(m) || m.packetVersion !== 1)
    fail("version", "unsupported or missing packetVersion");
  const o = m as Obj;
  if (!exactKeys(o, MANIFEST_KEYS)) fail("manifest", "manifest keys do not match C3");
  if (!validDimension(o.width) || !validDimension(o.height))
    fail("manifest", "artboard size out of range");
  for (const k of ["pathCount", "verbCount", "coordCount"])
    if (!isUint(o[k], MAX_U32)) fail("manifest", "counts must be integers in [0, 2^32-1]");
  if (!Array.isArray(o.styles)) fail("manifest", "styles is not an array");
  const styles = o.styles as unknown[];
  if (styles.length > MAX_TABLE_ENTRIES) fail("budget", "too many styles");
  // Index loops, not forEach: holes in a sparse array (they survive structured clone) must be
  // checked as undefined, as Rust does.
  for (let i = 0; i < styles.length; i++)
    if (!validStyle(styles[i])) fail("manifest", `style ${i} is invalid`);
  if (!Array.isArray(o.groups)) fail("manifest", "groups is not an array");
  const groups = o.groups as unknown[];
  if (groups.length > MAX_TABLE_ENTRIES) fail("budget", "too many groups");
  for (let i = 0; i < groups.length; i++)
    if (!validGroup(groups[i])) fail("manifest", `group ${i} is invalid`);
  const manifest = o as unknown as Manifest;
  checkCaps(manifest, limits);
  return manifest;
}

function checkCaps(m: Manifest, limits: Limits) {
  const { pathCount: p, verbCount: v, coordCount: c } = m;
  if (p > limits.maxPaths || p > limits.maxAnchors)
    fail("budget", `pathCount ${p} exceeds the path or anchor cap`);
  if (v > 2 * limits.maxAnchors) fail("budget", `verbCount ${v} exceeds 2 × the anchor cap`);
  if (c > 6 * limits.maxAnchors) fail("budget", `coordCount ${c} exceeds 6 × the anchor cap`);
  const { inMemory, derivedMax } = packetSizes(p, v, c);
  if (inMemory + derivedMax > limits.maxBytes)
    fail("budget", `declared ${inMemory + derivedMax} bytes exceed ${limits.maxBytes}`);
}

const ARRAY_TYPES = [
  ["verbs", Uint8Array],
  ["coords", Float64Array],
  ["verbOffsets", Uint32Array],
  ["coordOffsets", Uint32Array],
  ["styleIndex", Uint32Array],
  ["groupIndex", Uint32Array],
] as const;

/** The single validation pass (steps 1–12). Returns the derived metadata. */
export function validatePacket(
  p: { manifest: unknown } & Record<string, unknown>,
  limits: Limits = PRODUCT_LIMITS,
): Derived {
  const m = parseManifest(p.manifest, limits);
  for (const [k, T] of ARRAY_TYPES)
    if (!(p[k] instanceof T)) fail("type", `${k} is not a ${T.name}`);
  const verbs = p.verbs as Uint8Array;
  const coords = p.coords as Float64Array;
  const vo = p.verbOffsets as Uint32Array;
  const co = p.coordOffsets as Uint32Array;
  const styleIndex = p.styleIndex as Uint32Array;
  const groupIndex = p.groupIndex as Uint32Array;
  const n = m.pathCount;
  if (verbs.length !== m.verbCount || coords.length !== m.coordCount)
    fail("length", "array length differs from the manifest");
  if (vo.length !== n + 1 || co.length !== n + 1)
    fail("length", "offset array length differs from pathCount + 1");
  if (styleIndex.length !== n || groupIndex.length !== n)
    fail("length", "per-path array length differs from pathCount");
  if (vo[0] !== 0 || co[0] !== 0 || vo[n] !== m.verbCount || co[n] !== m.coordCount)
    fail("offsets", "bad sentinel");
  const bounds = new Float64Array(4 * n);
  const pathAnchors = new Uint32Array(n);
  const nStyles = m.styles.length;
  const nGroups = m.groups.length;
  let subpaths = 0;
  let anchors = 0;
  for (let i = 0; i < n; i++) {
    const v0 = vo[i]!;
    const v1 = vo[i + 1]!;
    let c = co[i]!;
    const c1 = co[i + 1]!;
    if (v1 <= v0 || c1 < c) fail("offsets", `path ${i}: offsets not increasing`);
    if (v1 > verbs.length || c1 > coords.length) fail("offsets", `path ${i}: offset beyond array`);
    if (styleIndex[i]! >= nStyles || groupIndex[i]! >= nGroups)
      fail("ref", `path ${i}: style or group reference out of range`);
    if (i > 0 && groupIndex[i]! < groupIndex[i - 1]!)
      fail("ref", `path ${i}: group order not contiguous`);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let open = false;
    let here = 0;
    for (let k = v0; k < v1; k++) {
      const op = verbs[k]!;
      if (op > VERB_Z) fail("opcode", `path ${i}: opcode ${op}`);
      if (op === VERB_M) {
        open = true;
        subpaths++;
      } else if (!open) fail("grammar", `path ${i}: segment without an open subpath`);
      if (op === VERB_Z) {
        open = false;
        continue;
      }
      const end = c + ARITY[op as 0 | 1 | 2];
      if (end > c1) fail("arity", `path ${i}: too few coordinates`);
      here++;
      for (; c < end; c += 2) {
        const x = coords[c]!;
        const y = coords[c + 1]!;
        // False for NaN, so this rejects NaN, ±Infinity and |v| > MAX_COORD.
        if (!(x >= -MAX_COORD && x <= MAX_COORD && y >= -MAX_COORD && y <= MAX_COORD))
          fail("coord", `path ${i}: non-finite or out-of-range coordinate`);
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (c !== c1) fail("arity", `path ${i}: ${c1 - c} surplus coordinates`);
    anchors += here;
    if (anchors > limits.maxAnchors) fail("budget", `anchors exceed ${limits.maxAnchors}`);
    bounds[4 * i] = x0;
    bounds[4 * i + 1] = y0;
    bounds[4 * i + 2] = x1;
    bounds[4 * i + 3] = y1;
    pathAnchors[i] = here;
  }
  // Exact size once S is known (C3.2).
  const subpathStart = new Uint32Array(subpaths);
  for (let k = 0, s = 0; k < verbs.length; k++) if (verbs[k] === VERB_M) subpathStart[s++] = k;
  return { bounds, pathAnchors, subpathStart, anchors };
}
