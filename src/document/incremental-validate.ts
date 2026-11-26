// G-DOC-R stage B: the incremental validator. `DocumentSession.dispatch` runs it on every
// transaction (ValidationMode). The session constructor, and therefore loadContainer, always
// run the full validateState, which stays the oracle this module is tested against
// (incremental-validate.test.ts: seeded differential, >= 10,000 comparisons).
//
// It is fast-accept: it either proves `next` valid and returns exactly the StateDerived that
// validateState would return (chunk entries compared as a set), or returns `undecided` with a
// reason. On `undecided` the caller runs validateState, which accepts or throws the canonical
// error; so rejected transactions report the full pass's first error by construction.
//
// Preconditions: `prev` passed validateState (or this proof) with the same store and limits
// and `prevDerived` is that result; every chunk `prev` references is still live (true inside
// dispatch, where prev stays owned as `document` until publication).
//
// Rule: every rule of invariants.ts is applied here to each changed entry, and every
// cross-entry rule is re-established from the change set. A change to invariants.ts adds the
// rule here and a forgery to testing/incremental-differential.ts in the same change.
//
// Cost: the node change set comes from the transaction's Draft write log when the session has
// a complete one (G-DOC-R stage C), O(written keys); otherwise from an identity diff of the
// node map, O(nodes). The log is a superset of the changed keys; unchanged keys are skipped.

import { parents } from "./commands.ts";
import {
  DEFAULT_DOC_LIMITS,
  DIGEST_RE,
  type DocLimits,
  isU32,
  LONE_SURROGATE,
  MIMES,
  rectProblem,
  type StateDerived,
} from "./invariants.ts";
import type { ChunkLookup } from "./invariants.ts";
import {
  type ChunkId,
  type DocNode,
  type DocState,
  IDENTITY,
  idNumber,
  idPrefix,
  isAxisPreserving,
  isContainer,
  KIND_PREFIX,
  type Matrix,
  multiply,
  NODE_ID_RE,
  type NodeId,
  SCENE_ID_RE,
  transformProblem,
} from "./model.ts";
import { checkSourceProvenance, checkTraceProvenance, DECODE_POLICIES } from "./provenance.ts";

export interface IncrementalTiming {
  /** Identity diff of the node map. */
  diffMs: number;
  /** `parents(prev)` when it was cold (0 when not needed or cached). */
  parentsMs: number;
  /** Everything else: local checks, tree delta, walks, derived data. */
  checksMs: number;
}
export type IncrementalResult =
  | { readonly derived: StateDerived; readonly timing: IncrementalTiming }
  | { readonly derived: null; readonly reason: string; readonly timing: IncrementalTiming };

class Undecided {
  readonly reason: string;
  constructor(reason: string) {
    this.reason = reason;
  }
}
const no = (reason: string): never => {
  throw new Undecided(reason);
};
const ok = (f: () => unknown) => {
  try {
    f();
    return true;
  } catch {
    return false;
  }
};

/** `diff` restricted to `keys`, a superset of the keys whose entries differ. */
function diffKeys<K, V>(a: ReadonlyMap<K, V>, b: ReadonlyMap<K, V>, keys: ReadonlySet<K>) {
  const changed: [K, V, V | undefined][] = [];
  const removed: [K, V][] = [];
  let added = 0;
  for (const k of keys) {
    const old = a.get(k);
    const v = b.get(k);
    if (v === undefined) {
      if (old !== undefined) removed.push([k, old]);
    } else if (old !== v) {
      changed.push([k, v, old]);
      if (old === undefined) added++;
    }
  }
  return { changed, removed, added };
}

/** Added or updated entries of `b` (in `b`'s order), and entries of `a` missing from `b`. */
function diff<K, V>(a: ReadonlyMap<K, V>, b: ReadonlyMap<K, V>) {
  const changed: [K, V, V | undefined][] = [];
  const removed: [K, V][] = [];
  if (a === b) return { changed, removed, added: 0 };
  let added = 0;
  for (const [k, v] of b) {
    const old = a.get(k);
    if (old !== v) {
      changed.push([k, v, old]);
      if (old === undefined) added++;
    }
  }
  if (a.size + added > b.size) for (const [k, v] of a) if (!b.has(k)) removed.push([k, v]);
  return { changed, removed, added };
}

/** `multiply(m1, m2).every(Number.isFinite)` without the allocation (same expressions; the
 *  `+ 0` that normalises −0 in `multiply` cannot change finiteness). */
function finiteProduct(m1: Matrix, m2: Matrix): boolean {
  const a = m1[0],
    b = m1[1],
    c = m1[2],
    d = m1[3],
    e = m1[4],
    f = m1[5];
  const A = m2[0],
    B = m2[1],
    C = m2[2],
    D = m2[3],
    E = m2[4],
    F = m2[5];
  return (
    Number.isFinite(a * A + c * B) &&
    Number.isFinite(b * A + d * B) &&
    Number.isFinite(a * C + c * D) &&
    Number.isFinite(b * C + d * D) &&
    Number.isFinite(a * E + c * F + e) &&
    Number.isFinite(b * E + d * F + f)
  );
}

export function checkIncremental(
  prev: DocState,
  prevDerived: StateDerived,
  next: DocState,
  store: ChunkLookup,
  limits: DocLimits = DEFAULT_DOC_LIMITS,
  /** Node keys that may differ (a superset), from a complete Draft write log; else null. */
  writes: ReadonlySet<NodeId> | null = null,
): IncrementalResult {
  const t0 = performance.now();
  const timing: IncrementalTiming = { diffMs: 0, parentsMs: 0, checksMs: 0 };
  try {
    const derived = run(prev, prevDerived, next, store, limits, timing, writes);
    timing.checksMs = performance.now() - t0 - timing.diffMs - timing.parentsMs;
    return { derived, timing };
  } catch (e) {
    timing.checksMs = performance.now() - t0 - timing.diffMs - timing.parentsMs;
    if (e instanceof Undecided) return { derived: null, reason: e.reason, timing };
    // Any other throw (a provenance checker, a malformed value) is a rejection to leave to
    // the full pass, never an acceptance.
    return { derived: null, reason: "exception", timing };
  }
}

function run(
  prev: DocState,
  prevDerived: StateDerived,
  next: DocState,
  store: ChunkLookup,
  limits: DocLimits,
  timing: IncrementalTiming,
  writes: ReadonlySet<NodeId> | null,
): StateDerived {
  const prevMax = prevDerived.maxIdNumber;
  if (next.documentId !== prev.documentId && !SCENE_ID_RE.test(next.documentId)) no("documentId");
  if (next.artboard !== prev.artboard) {
    const ab = next.artboard;
    for (const v of [ab.width, ab.height])
      if (!(typeof v === "number" && v > 0 && v <= 16_384)) no("artboard");
    if (ab.background !== null && !isU32(ab.background)) no("artboard");
  }

  // --- IDs: updated entries keep their key (and number); new keys must lie above prevMax ---
  const newNumbers = new Set<number>();
  let maxNew = 0;
  let maxRemoved = false;
  const claim = (k: string, id: string, prefix: string, isNew: boolean) => {
    if (k !== id || !NODE_ID_RE.test(id) || idPrefix(id) !== prefix) no("id");
    if (!isNew) return;
    const n = idNumber(id);
    if (n <= prevMax || newNumbers.has(n)) no("new id number not above the previous maximum");
    newNumbers.add(n);
    if (n > maxNew) maxNew = n;
  };
  const noteRemoved = (k: string) => {
    if (idNumber(k) === prevMax) maxRemoved = true;
  };

  const pal = diff(prev.paletteById, next.paletteById);
  if (pal.removed.length) no("palette entry removed");
  for (const [k, e, old] of pal.changed) {
    claim(k, e.id, "pal", old === undefined);
    if (!SCENE_ID_RE.test(e.name) || !isU32(e.color)) no("palette entry");
  }
  const sty = diff(prev.stylesById, next.stylesById);
  if (sty.removed.length) no("style removed");
  for (const [k, st, old] of sty.changed) {
    claim(k, st.id, "sty", old === undefined);
    if (st.fill !== null && !isU32(st.fill)) no("style");
    if (st.paletteRef !== null && !next.paletteById.has(st.paletteRef)) no("style palette ref");
    if (st.fill !== null && st.paletteRef !== null) no("style");
    if (st.fill === null && st.paletteRef === null && st.stroke === null) no("style");
    if (st.stroke !== null) {
      const w = st.stroke.width;
      if (!isU32(st.stroke.color) || !(typeof w === "number" && w > 0 && w <= 1000)) no("style");
    }
  }
  const ast = diff(prev.sourceAssetsById, next.sourceAssetsById);
  for (const [k, a, old] of ast.changed) {
    claim(k, a.id, "ast", old === undefined);
    if (!DIGEST_RE.test(a.digest) || !MIMES.has(a.mime)) no("asset");
    for (const v of [a.width, a.height])
      if (!(Number.isInteger(v) && v >= 1 && v <= 16_384)) no("asset");
    if (typeof a.embedded !== "boolean" || !DECODE_POLICIES.has(a.decodePolicy)) no("asset");
    if (a.provenance !== undefined && !ok(() => checkSourceProvenance(a.provenance, k)))
      no("asset provenance");
  }
  const removedAssets = new Set(ast.removed.map(([k]) => k));
  for (const k of removedAssets) noteRemoved(k);

  if (next.nodesById.size > limits.maxNodes) no("maxNodes");
  const tDiff = performance.now();
  const nodes = writes
    ? diffKeys(prev.nodesById, next.nodesById, writes)
    : diff(prev.nodesById, next.nodesById);
  // Defence in depth: a log that missed an addition or a removal cannot balance the sizes.
  if (writes && prev.nodesById.size + nodes.added - nodes.removed.length !== next.nodesById.size)
    no("write log inconsistent with the map sizes");
  timing.diffMs = performance.now() - tDiff;

  // --- per-node checks, chunk and anchor deltas, child-reference delta ---
  const chunks = new Map(prevDerived.chunks);
  let anchors = prevDerived.anchors;
  const ref = (n: DocNode, sign: 1 | -1) => {
    if (n.kind !== "path") return;
    const { chunkId, pathIndex } = n.geometry;
    const c = (chunks.get(chunkId) ?? 0) + sign;
    if (c === 0) chunks.delete(chunkId);
    else chunks.set(chunkId, c);
    anchors += sign * store.derived(chunkId).pathAnchors(pathIndex);
  };
  /** Net child references per node from changed lists; `newEdges` are (parent, child) pairs
   *  absent before. `null` is the root list. */
  const delta = new Map<NodeId, number>();
  const newEdges: [NodeId | null, NodeId][] = [];
  const patch = new Map<NodeId, NodeId | null>(); // next parent of every child in a changed list
  const lists = (p: NodeId | null, oldList: readonly NodeId[], newList: readonly NodeId[]) => {
    for (const x of oldList) delta.set(x, (delta.get(x) ?? 0) - 1);
    const before = new Set(oldList);
    for (const x of newList) {
      delta.set(x, (delta.get(x) ?? 0) + 1);
      patch.set(x, p);
      if (!before.has(x)) newEdges.push([p, x]);
    }
  };
  const transformed: NodeId[] = []; // existing nodes whose localTransform changed
  const clipped: NodeId[] = []; // existing containers whose clipRef changed

  for (const [k, n, old] of nodes.changed) {
    claim(k, n.id, KIND_PREFIX[n.kind] ?? "???", old === undefined);
    if (
      typeof n.name !== "string" ||
      n.name.length > limits.maxNameLength ||
      LONE_SURROGATE.test(n.name)
    )
      no("name");
    if (typeof n.visible !== "boolean" || typeof n.locked !== "boolean") no("flags");
    if (transformProblem(n.localTransform)) no("transform");
    if (n.clipRef !== undefined) {
      if (n.kind !== "layer" && n.kind !== "group") no("clip on a non-container");
      if (rectProblem(n.clipRef)) no("clip rect");
    }
    if (n.kind === "path") {
      const { chunkId, pathIndex } = n.geometry;
      if (!store.has(chunkId)) no("chunk");
      const d = store.derived(chunkId);
      if (!(Number.isInteger(pathIndex) && pathIndex >= 0 && pathIndex < d.pathCount))
        no("pathIndex");
      if (!next.stylesById.has(n.styleRef)) no("style ref");
      if (n.fillRule !== "nonzero" && n.fillRule !== "evenodd") no("fillRule");
    } else if (n.kind === "source") {
      if (!next.sourceAssetsById.has(n.assetId)) no("asset ref");
      if (transformProblem(n.sourceToDocument)) no("transform");
    } else if (!Array.isArray(n.orderedChildIds)) no("orderedChildIds");
    else if (n.kind === "layer" && n.traceProvenance !== undefined) {
      if (!ok(() => checkTraceProvenance(n.traceProvenance, k))) no("trace provenance");
    } else if (n.kind === "group" && "traceProvenance" in n) no("trace provenance");
    if (old === undefined) {
      delta.set(k, delta.get(k) ?? 0); // must end up referenced exactly once
      if (isContainer(n)) lists(k, [], n.orderedChildIds);
    } else {
      ref(old, -1);
      if (isContainer(n) && isContainer(old) && old.orderedChildIds !== n.orderedChildIds)
        lists(k, old.orderedChildIds, n.orderedChildIds);
      if (old.localTransform !== n.localTransform) transformed.push(k);
      else if (old.clipRef !== n.clipRef) clipped.push(k);
    }
    ref(n, 1);
  }
  for (const [k, old] of nodes.removed) {
    noteRemoved(k);
    delta.set(k, delta.get(k) ?? 0);
    ref(old, -1);
    if (isContainer(old)) lists(k, old.orderedChildIds, []);
  }
  const pr = prev.orderedRootIds;
  const nr = next.orderedRootIds;
  if (pr !== nr && (pr.length !== nr.length || pr.some((id, i) => nr[i] !== id)))
    lists(null, pr, nr);

  // A removed asset must have no referrer. Source nodes can only be roots in a valid tree; an
  // unchanged source node off the root list is an orphan, which the reference delta rejects.
  if (removedAssets.size)
    for (const id of nr) {
      const n = next.nodesById.get(id);
      if (n?.kind === "source" && removedAssets.has(n.assetId))
        no("removed asset still referenced");
    }

  // --- tree: one parent per node, then cycles, depth, composed transforms, clip rule ---
  // prev is a valid tree: every prev node has exactly one reference. Unchanged lists keep theirs.
  for (const [x, d] of delta)
    if ((prev.nodesById.has(x) ? 1 : 0) + d !== (next.nodesById.has(x) ? 1 : 0))
      no("child references (dangling, orphan or second parent)");
  for (const [p, x] of newEdges) {
    const kind = next.nodesById.get(x)!.kind;
    const pk = p === null ? "root" : next.nodesById.get(p)!.kind;
    const allowed =
      pk === "root" ? kind === "layer" || kind === "source" : kind === "group" || kind === "path";
    if (!allowed) no("parent kind");
  }
  // After the delta check a next root has exactly one reference: the root list. Checking it
  // first spares the O(nodes) parent map when a chain ends at an unchanged root (a layer).
  const rootSet = new Set(nr);
  let prevParents: ReadonlyMap<NodeId, NodeId | null> | null = null;
  const parentOf = (id: NodeId): NodeId | null => {
    const p = patch.get(id);
    if (p !== undefined) return p;
    if (rootSet.has(id)) return null;
    let pp = prevParents;
    if (!pp) {
      const t = performance.now();
      pp = prevParents = parents(prev);
      timing.parentsMs = performance.now() - t;
    }
    const q = pp.get(id); // null for a root
    return q === undefined ? no("no parent") : q;
  };
  /** Composed transform and depth of a container from its ancestor chain (top-down products,
   *  bit-identical to the full pass). A chain longer than maxDepth is a cycle or too deep. */
  const placed = new Map<NodeId, { m: Matrix; depth: number }>();
  const place = (id: NodeId): { m: Matrix; depth: number } => {
    const hit = placed.get(id);
    if (hit) return hit;
    const chain: NodeId[] = [];
    for (let y: NodeId | null = id; y !== null; y = parentOf(y)) {
      chain.push(y);
      if (chain.length > limits.maxDepth) no("depth or cycle");
    }
    let m: Matrix = IDENTITY;
    for (let i = chain.length - 1; i >= 0; i--)
      m = multiply(m, next.nodesById.get(chain[i]!)!.localTransform);
    const out = { m, depth: chain.length };
    placed.set(id, out);
    return out;
  };
  // Containers already walked (walk roots may overlap). Leaves are checked without allocating
  // their composed matrix: `finiteProduct` evaluates exactly `multiply`'s expressions.
  const walked = new Set<NodeId>();
  const walk = (id: NodeId, m: Matrix, depth: number): void => {
    if (depth > limits.maxDepth) no("depth");
    const n = next.nodesById.get(id)!;
    if (!isContainer(n)) {
      if (!finiteProduct(m, n.localTransform)) no("composed transform");
      return;
    }
    if (walked.has(id)) return;
    walked.add(id);
    const composed = multiply(m, n.localTransform);
    if (!composed.every(Number.isFinite)) no("composed transform");
    if (n.clipRef !== undefined && !isAxisPreserving(composed)) no("clip transform");
    for (const c of n.orderedChildIds) walk(c, composed, depth + 1);
  };
  const walkFrom = (id: NodeId) => {
    const p = parentOf(id);
    const at = p === null ? { m: IDENTITY, depth: 0 } : place(p);
    walk(id, at.m, at.depth + 1);
  };
  for (const [p] of newEdges) if (p !== null) place(p); // cycle check through every new edge
  for (const [, x] of newEdges) walkFrom(x);
  for (const id of transformed) walkFrom(id);
  for (const id of clipped) {
    const n = next.nodesById.get(id)!;
    if (n.clipRef !== undefined && !isAxisPreserving(place(id).m)) no("clip transform");
  }

  if (anchors > limits.maxAnchors) no("budget");
  let maxIdNumber = Math.max(prevMax, maxNew);
  if (maxRemoved) {
    maxIdNumber = maxNew;
    for (const m of [next.paletteById, next.stylesById, next.sourceAssetsById, next.nodesById])
      for (const k of m.keys()) maxIdNumber = Math.max(maxIdNumber, idNumber(k as string));
  }
  return { chunks: chunks as ReadonlyMap<ChunkId, number>, anchors, maxIdNumber };
}
