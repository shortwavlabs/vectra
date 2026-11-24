// GeometryPacket v1 prototype (RFC-002 §6 / D03). Review experiment only, not production code.
// Layout: verbs Uint8 (M=0 L=1 C=2 Z=3), coords Float64, per-path Uint32 verb/coord offsets with
// sentinel, per-path Uint32 style index into a small JSON style table. Bounds and subpath
// starts are NOT transported: the receiver derives them in its single validation pass.
export const M = 0, L = 1, C = 2, Z = 3;
const ARITY = [2, 2, 6, 0];
export const MAX_COORD = 1e6;
export const LIMITS = { maxAnchors: 5_000_000, maxPaths: 1_000_000, maxStyles: 65_536, maxBytes: 512 * 2 ** 20 };

export class PacketError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const fail = (code, msg) => {
  throw new PacketError(code, msg);
};

const parseColor = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return hex.length === 9 ? n >>> 0 : ((n << 8) | 0xff) >>> 0; // RGBA8888
};

/** Encode a parsed scene v1 object (JS-side encode: NOT the production path, which would build
 *  the typed arrays in Rust while constructing the scene). */
export function encodeScene(scene) {
  let verbCount = 0, coordCount = 0, pathCount = 0;
  for (const g of scene.groups) for (const p of g.paths) {
    pathCount++;
    verbCount += p.verbs.length;
    coordCount += p.coords.length;
  }
  const verbs = new Uint8Array(verbCount);
  const coords = new Float64Array(coordCount);
  const verbOffsets = new Uint32Array(pathCount + 1);
  const coordOffsets = new Uint32Array(pathCount + 1);
  const styleIndex = new Uint32Array(pathCount);
  const groupIndex = new Uint32Array(pathCount);
  const styles = [], styleKey = new Map();
  let vi = 0, ci = 0, pi = 0;
  scene.groups.forEach((g, gi) => {
    for (const p of g.paths) {
      const key = `${p.fill?.color ?? ""}|${p.fill?.paletteId ?? ""}|${p.stroke ? p.stroke.color + "/" + p.stroke.width : ""}|${p.fillRule}`;
      let s = styleKey.get(key);
      if (s === undefined) {
        s = styles.length;
        styleKey.set(key, s);
        styles.push({
          fill: p.fill ? parseColor(p.fill.color) : null,
          paletteId: p.fill?.paletteId ?? null,
          stroke: p.stroke ? { color: parseColor(p.stroke.color), width: p.stroke.width } : null,
          evenOdd: p.fillRule === "evenodd",
        });
      }
      styleIndex[pi] = s;
      groupIndex[pi] = gi;
      const v = p.verbs;
      for (let k = 0; k < v.length; k++) {
        const ch = v.charCodeAt(k);
        verbs[vi++] = ch === 77 ? M : ch === 76 ? L : ch === 67 ? C : ch === 90 ? Z : 255;
      }
      coords.set(p.coords, ci);
      ci += p.coords.length;
      pi++;
      verbOffsets[pi] = vi;
      coordOffsets[pi] = ci;
    }
  });
  return {
    manifest: {
      version: 1,
      width: scene.width,
      height: scene.height,
      pathCount, verbCount, coordCount,
      styles,
      groups: scene.groups.map((g) => ({ id: g.id, clip: g.clip })),
    },
    verbs, coords, verbOffsets, coordOffsets, styleIndex, groupIndex,
  };
}

export const transferList = (p) =>
  [p.verbs, p.coords, p.verbOffsets, p.coordOffsets, p.styleIndex, p.groupIndex].map((a) => a.buffer);

export const packetBytes = (p) =>
  p.verbs.byteLength + p.coords.byteLength + p.verbOffsets.byteLength + p.coordOffsets.byteLength +
  p.styleIndex.byteLength + p.groupIndex.byteLength;

/** Deep copy for a job (committed buffers are never transferred). */
export const clonePacket = (p) => ({
  manifest: p.manifest,
  verbs: p.verbs.slice(), coords: p.coords.slice(), verbOffsets: p.verbOffsets.slice(),
  coordOffsets: p.coordOffsets.slice(), styleIndex: p.styleIndex.slice(), groupIndex: p.groupIndex.slice(),
});

/** Checks a manifest's declared sizes BEFORE any allocation (file/project loading path). */
export function checkManifest(m, limits = LIMITS) {
  if (!m || m.version !== 1) fail("version", `unsupported packet version ${m?.version}`);
  for (const k of ["pathCount", "verbCount", "coordCount"])
    if (!Number.isSafeInteger(m[k]) || m[k] < 0) fail("manifest", `${k} invalid`);
  if (!(m.width > 0 && m.width <= 16384 && m.height > 0 && m.height <= 16384)) fail("manifest", "artboard size");
  if (m.pathCount > limits.maxPaths) fail("budget", `pathCount ${m.pathCount} > ${limits.maxPaths}`);
  if (!Array.isArray(m.styles) || m.styles.length > limits.maxStyles) fail("manifest", "styles");
  const bytes = m.verbCount + 8 * m.coordCount + 16 * (m.pathCount + 1);
  if (bytes > limits.maxBytes) fail("budget", `declared ${bytes} bytes > ${limits.maxBytes}`);
}

/** Single validation pass. Returns derived per-path bounds, subpath starts and stats.
 *  Rejects: wrong types/lengths, non-monotonic or out-of-range offsets, bad sentinel, unknown
 *  opcodes, grammar (segment without open subpath), arity, non-finite / out-of-range coords,
 *  style/group refs, anchor budget. */
export function validatePacket(p, limits = LIMITS) {
  const m = p.manifest;
  checkManifest(m, limits);
  const types = [["verbs", Uint8Array], ["coords", Float64Array], ["verbOffsets", Uint32Array],
    ["coordOffsets", Uint32Array], ["styleIndex", Uint32Array], ["groupIndex", Uint32Array]];
  for (const [k, T] of types) if (!(p[k] instanceof T)) fail("type", `${k} is not ${T.name}`);
  const n = m.pathCount;
  if (p.verbs.length !== m.verbCount || p.coords.length !== m.coordCount) fail("length", "array length != manifest");
  if (p.verbOffsets.length !== n + 1 || p.coordOffsets.length !== n + 1) fail("length", "offset length");
  if (p.styleIndex.length !== n || p.groupIndex.length !== n) fail("length", "per-path length");
  const { verbs, coords, verbOffsets: vo, coordOffsets: co, styleIndex, groupIndex } = p;
  if (vo[0] !== 0 || co[0] !== 0 || vo[n] !== verbs.length || co[n] !== coords.length) fail("offsets", "sentinel");
  const bounds = new Float64Array(4 * n);
  const subStart = []; // verb index of every M (subpath index for large compound paths)
  let anchors = 0;
  const nStyles = m.styles.length, nGroups = m.groups.length;
  for (let i = 0; i < n; i++) {
    const v0 = vo[i], v1 = vo[i + 1];
    let c = co[i];
    const c1 = co[i + 1];
    if (v1 <= v0 || c1 < c) fail("offsets", `path ${i}: offsets not increasing`);
    // Bounds before iteration (found by the adversarial suite: an out-of-range offset was
    // otherwise rejected only indirectly, after reading past the array).
    if (v1 > verbs.length || c1 > coords.length) fail("offsets", `path ${i}: offset beyond array`);
    if (styleIndex[i] >= nStyles || groupIndex[i] >= nGroups) fail("ref", `path ${i}: style/group ref`);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    let open = false;
    for (let k = v0; k < v1; k++) {
      const op = verbs[k];
      if (op > 3) fail("opcode", `path ${i}: opcode ${op}`);
      if (op === M) {
        open = true;
        subStart.push(k);
      } else if (!open) fail("grammar", `path ${i}: segment without open subpath`);
      if (op === Z) {
        open = false;
        continue;
      }
      const end = c + ARITY[op];
      if (end > c1) fail("arity", `path ${i}: too few coordinates`);
      anchors++;
      for (; c < end; c += 2) {
        const x = coords[c], y = coords[c + 1];
        // Comparison is false for NaN, so this rejects NaN, ±Infinity and |v| > MAX_COORD.
        if (!(x >= -MAX_COORD && x <= MAX_COORD && y >= -MAX_COORD && y <= MAX_COORD)) fail("coord", `path ${i}: non-finite or out-of-range`);
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (c !== c1) fail("arity", `path ${i}: ${c1 - c} surplus coordinates`);
    if (anchors > limits.maxAnchors) fail("budget", `anchors > ${limits.maxAnchors}`);
    bounds[4 * i] = x0; bounds[4 * i + 1] = y0; bounds[4 * i + 2] = x1; bounds[4 * i + 3] = y1;
  }
  return { bounds, subStart: Uint32Array.from(subStart), anchors };
}
