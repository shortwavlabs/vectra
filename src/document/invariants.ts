// Document v1 invariants (RFC-002 §5.1), run on every committed transaction and on load.
// One whole-state pass: IDs, references, numbers, transforms, tree shape, clip rules (C8) and
// the per-reference anchor cap (C3.2). Returns the derived per-state data the session caches.

import {
  type ChunkId,
  type ContainerNode,
  type DocState,
  DocumentError,
  IDENTITY,
  idNumber,
  idPrefix,
  isAxisPreserving,
  KIND_PREFIX,
  type Matrix,
  multiply,
  NODE_ID_RE,
  type Rect,
  SCENE_ID_RE,
  transformProblem,
} from "./model.ts";

export interface DocLimits {
  /** Product anchor cap, counted per PathObject reference (RFC §8.8). */
  maxAnchors: number;
  maxNodes: number;
  maxDepth: number;
  maxNameLength: number;
}
export const DEFAULT_DOC_LIMITS: Readonly<DocLimits> = Object.freeze({
  maxAnchors: 1_000_000,
  maxNodes: 2_000_000,
  maxDepth: 64,
  maxNameLength: 256,
});

/** What the invariant pass needs from the GeometryStore. */
export interface ChunkLookup {
  has(id: ChunkId): boolean;
  derived(id: ChunkId): { readonly pathCount: number; pathAnchors(i: number): number };
}

export interface StateDerived {
  /** PathObject references per chunk (the chunks this state owns). */
  readonly chunks: ReadonlyMap<ChunkId, number>;
  /** Document anchors, counted per reference. */
  readonly anchors: number;
  /** Highest node-ID number in use (nextId must exceed it). */
  readonly maxIdNumber: number;
}

const U32_MAX = 2 ** 32 - 1;
const isU32 = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= U32_MAX;
const DIGEST_RE = /^[0-9a-f]{64}$/;
const MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_RECT = 1e9;
/** Names must be well-formed Unicode, or canonical JSON (C7) could not save them. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const bad = (message: string): never => {
  throw new DocumentError("invariant", message);
};
export function rectProblem(r: Rect): string | null {
  const v = [r.x, r.y, r.width, r.height];
  if (!v.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= MAX_RECT))
    return "clip rect must be finite and bounded";
  return r.width > 0 && r.height > 0 ? null : "clip rect width and height must be > 0";
}

export function validateState(
  s: DocState,
  store: ChunkLookup,
  limits: DocLimits = DEFAULT_DOC_LIMITS,
): StateDerived {
  if (!SCENE_ID_RE.test(s.documentId)) bad("documentId must follow the scene-v1 id rule");
  const ab = s.artboard;
  for (const v of [ab.width, ab.height])
    if (!(typeof v === "number" && v > 0 && v <= 16_384)) bad("artboard size out of range");
  if (ab.background !== null && !isU32(ab.background)) bad("artboard background must be RGBA8888");

  const numbers = new Set<number>();
  let maxIdNumber = 0;
  const claimId = (key: string, id: string, prefix: string) => {
    if (key !== id) bad(`map key ${key} does not match id ${id}`);
    if (!NODE_ID_RE.test(id) || idPrefix(id) !== prefix) bad(`invalid ${prefix} id ${id}`);
    const n = idNumber(id);
    if (numbers.has(n)) bad(`duplicate id number ${n} (${id})`);
    numbers.add(n);
    if (n > maxIdNumber) maxIdNumber = n;
  };

  for (const [k, e] of s.paletteById) {
    claimId(k, e.id, "pal");
    if (!SCENE_ID_RE.test(e.name)) bad(`palette ${k}: name must follow the scene-v1 id rule`);
    if (!isU32(e.color)) bad(`palette ${k}: colour must be RGBA8888`);
  }
  for (const [k, st] of s.stylesById) {
    claimId(k, st.id, "sty");
    if (st.fill !== null && !isU32(st.fill)) bad(`style ${k}: fill must be RGBA8888`);
    if (st.paletteRef !== null && !s.paletteById.has(st.paletteRef))
      bad(`style ${k}: dangling palette reference ${st.paletteRef}`);
    if (st.fill !== null && st.paletteRef !== null)
      bad(`style ${k}: fill and paletteRef are exclusive`);
    if (st.fill === null && st.paletteRef === null && st.stroke === null)
      bad(`style ${k}: neither fill nor stroke (scene v1 could not export it)`);
    if (st.stroke !== null) {
      const w = st.stroke.width;
      if (!isU32(st.stroke.color) || !(typeof w === "number" && w > 0 && w <= 1000))
        bad(`style ${k}: invalid stroke`);
    }
  }
  for (const [k, a] of s.sourceAssetsById) {
    claimId(k, a.id, "ast");
    if (!DIGEST_RE.test(a.digest)) bad(`asset ${k}: digest must be lowercase SHA-256 hex`);
    if (!MIMES.has(a.mime)) bad(`asset ${k}: unsupported mime ${a.mime}`);
    for (const v of [a.width, a.height])
      if (!(Number.isInteger(v) && v >= 1 && v <= 16_384))
        bad(`asset ${k}: dimensions out of range`);
    if (typeof a.embedded !== "boolean") bad(`asset ${k}: embedded must be boolean`);
  }

  if (s.nodesById.size > limits.maxNodes) bad(`more than ${limits.maxNodes} nodes`);
  const chunks = new Map<ChunkId, number>();
  let anchors = 0;
  for (const [k, n] of s.nodesById) {
    claimId(k, n.id, KIND_PREFIX[n.kind] ?? "???");
    if (
      typeof n.name !== "string" ||
      n.name.length > limits.maxNameLength ||
      LONE_SURROGATE.test(n.name)
    )
      bad(`${k}: invalid name (too long or not well-formed Unicode)`);
    if (typeof n.visible !== "boolean" || typeof n.locked !== "boolean") bad(`${k}: invalid flags`);
    const tp = transformProblem(n.localTransform);
    if (tp) throw new DocumentError("invalid_transform", `${k}: ${tp}`);
    if (n.clipRef !== undefined) {
      if (n.kind !== "layer" && n.kind !== "group")
        throw new DocumentError(
          "clip_unsupported",
          `${k}: clips are supported on Layers and Groups only`,
        );
      const rp = rectProblem(n.clipRef);
      if (rp) bad(`${k}: ${rp}`);
    }
    if (n.kind === "path") {
      const { chunkId, pathIndex } = n.geometry;
      if (!store.has(chunkId)) bad(`${k}: dangling chunk ${chunkId}`);
      const d = store.derived(chunkId);
      if (!(Number.isInteger(pathIndex) && pathIndex >= 0 && pathIndex < d.pathCount))
        bad(`${k}: pathIndex ${pathIndex} out of range`);
      if (!s.stylesById.has(n.styleRef)) bad(`${k}: dangling style ${n.styleRef}`);
      if (n.fillRule !== "nonzero" && n.fillRule !== "evenodd") bad(`${k}: invalid fillRule`);
      chunks.set(chunkId, (chunks.get(chunkId) ?? 0) + 1);
      anchors += d.pathAnchors(pathIndex);
    } else if (n.kind === "source") {
      if (!s.sourceAssetsById.has(n.assetId)) bad(`${k}: dangling asset ${n.assetId}`);
      const sp = transformProblem(n.sourceToDocument);
      if (sp) throw new DocumentError("invalid_transform", `${k}: ${sp}`);
    } else if (!Array.isArray(n.orderedChildIds)) bad(`${k}: orderedChildIds must be an array`);
  }

  // Tree: ordered, acyclic, one parent per non-root, every node reachable; clip rule 3.
  const visited = new Set<string>();
  const visit = (id: string, parentKind: "root" | "layer" | "group", m: Matrix, depth: number) => {
    if (depth > limits.maxDepth) bad(`tree deeper than ${limits.maxDepth}`);
    const n = s.nodesById.get(id);
    if (!n) return bad(`dangling child reference ${id}`);
    if (visited.has(id)) bad(`${id} appears twice in the tree (cycle or second parent)`);
    visited.add(id);
    const allowed =
      parentKind === "root"
        ? n.kind === "layer" || n.kind === "source"
        : n.kind === "group" || n.kind === "path";
    if (!allowed) bad(`${n.kind} ${id} cannot be a child of ${parentKind}`);
    if (n.kind !== "layer" && n.kind !== "group") return;
    const composed = multiply(m, n.localTransform);
    if (n.clipRef !== undefined && !isAxisPreserving(composed))
      throw new DocumentError(
        "clip_transform_unsupported",
        `${id}: clipped node under a non-axis-preserving composed transform`,
      );
    for (const c of (n as ContainerNode).orderedChildIds) visit(c, n.kind, composed, depth + 1);
  };
  for (const id of s.orderedRootIds) visit(id, "root", IDENTITY, 1);
  if (visited.size !== s.nodesById.size) bad("unreachable nodes (orphans or a detached cycle)");

  if (anchors > limits.maxAnchors)
    throw new DocumentError(
      "budget",
      `document would hold ${anchors} anchors (counted per reference); the cap is ${limits.maxAnchors}`,
    );
  return { chunks, anchors, maxIdNumber };
}
