// RFC-002 §7 commands as pure functions: (state, command, context) → new immutable state.
// They throw a typed DocumentError on bad input; the session then discards the draft, so the
// document is unchanged. Structural commands never touch geometry (C2 rule 9): only
// commitTrace and bake call ctx.commit, which is the store's C2 commit.

import type { GeometryStore } from "./geometry-store.ts";
import {
  type AssetId,
  type ChunkId,
  type ContainerNode,
  type DocNode,
  type DocState,
  DocumentError,
  IDENTITY,
  type IdAllocator,
  isContainer,
  KIND_PREFIX,
  type Matrix,
  multiply,
  type NodeId,
  type PaletteEntry,
  type PaletteId,
  type PathNode,
  type Rect,
  rotate90Matrix,
  isSealedMap,
  SealedMap,
  sealMap,
  freezeEntry,
  type SourceAsset,
  type Style,
  type StyleId,
} from "./model.ts";
import type { IncomingPacket } from "./packet-port.ts";
import {
  checkTraceProvenance,
  type TraceProvenance,
  type TraceProvenanceInput,
} from "./provenance.ts";

const deepFreeze = <T>(v: T): T => {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
};

export type FillSpec = { color: number } | { paletteRef: PaletteId } | null;

export type Command =
  | { type: "attachSource"; asset: Omit<SourceAsset, "id">; name?: string }
  | {
      type: "commitTrace";
      packet: IncomingPacket;
      /** Required (C10): the trace's historical record; `chunkId` is assigned by the store. */
      provenance: TraceProvenanceInput;
      replaceLayerId?: NodeId;
      name?: string;
    }
  | { type: "delete"; ids: readonly NodeId[] }
  | { type: "duplicate"; ids: readonly NodeId[] }
  | { type: "reorder"; id: NodeId; index: number }
  | { type: "reparent"; ids: readonly NodeId[]; parentId: NodeId | null; index: number }
  | { type: "setVisible"; ids: readonly NodeId[]; visible: boolean }
  | { type: "setLocked"; ids: readonly NodeId[]; locked: boolean }
  | { type: "rename"; id: NodeId; name: string }
  | { type: "setTransform"; id: NodeId; matrix: Matrix }
  | { type: "applyTransform"; ids: readonly NodeId[]; matrix: Matrix }
  | { type: "rotate90"; ids: readonly NodeId[]; turns: 1 | 2 | 3; pivot?: { x: number; y: number } }
  | { type: "setFill"; ids: readonly NodeId[]; fill: FillSpec }
  | { type: "setPaletteColor"; paletteRef: PaletteId; color: number }
  | { type: "group"; ids: readonly NodeId[]; name?: string }
  | { type: "ungroup"; id: NodeId }
  | { type: "setClip"; id: NodeId; rect: Rect }
  | { type: "releaseClip"; id: NodeId }
  | { type: "setArtboard"; width: number; height: number; background?: number | null }
  | { type: "bake"; packet: IncomingPacket; targetIds: readonly NodeId[] };

/** Commands that may call ctx.commit (everything else is structural, C2 rule 9). */
export const GEOMETRY_COMMANDS: ReadonlySet<Command["type"]> = new Set(["commitTrace", "bake"]);

export interface CommandContext {
  readonly store: GeometryStore;
  readonly ids: IdAllocator;
  /** GeometryStore.commit, tracked by the session for end-of-transaction freeing. */
  commit(packet: IncomingPacket): ChunkId;
  /** Records the node keys this transaction's Drafts write (G-DOC-R stage C). */
  readonly log?: DraftLog;
}

/**
 * The node keys written by one transaction's Drafts: a superset of the keys whose entries
 * differ between the transaction's input and its result, so the incremental validator can
 * skip the whole-map identity diff. Transaction-local: nothing is retained with a state.
 * `step` checks, after each command, that its result is its input or the last Draft result
 * built on that input; otherwise the log is marked incomplete and must not be used.
 */
export class DraftLog {
  readonly keys = new Set<NodeId>();
  #complete = true;
  #last: DocState | null = null;
  #lastBase: DocState | null = null;
  /** Draft.finish: `out` was built on `base` with these node writes. */
  record(base: DocState, out: DocState, written: Iterable<NodeId>): void {
    for (const k of written) this.keys.add(k);
    this.#last = out;
    this.#lastBase = base;
  }
  /** After each command of the transaction: `input` → `output`. */
  step(input: DocState, output: DocState): void {
    if (output !== input && !(output === this.#last && this.#lastBase === input))
      this.#complete = false;
  }
  get complete(): boolean {
    return this.#complete;
  }
}

const invalid = (message: string): never => {
  throw new DocumentError("invalid_argument", message);
};
const U32_MAX = 2 ** 32 - 1;
const isU32 = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= U32_MAX;

// --- tree helpers -------------------------------------------------------------------------------
const parentCache = new WeakMap<DocState, ReadonlyMap<NodeId, NodeId | null>>();
/** Parent of every node (null = root), cached per immutable state. */
export function parents(s: DocState): ReadonlyMap<NodeId, NodeId | null> {
  let p = parentCache.get(s);
  if (!p) parentCache.set(s, (p = parentMap(s)));
  return p;
}
function parentMap(s: DocState): Map<NodeId, NodeId | null> {
  const m = new Map<NodeId, NodeId | null>();
  for (const id of s.orderedRootIds) m.set(id, null);
  for (const n of s.nodesById.values())
    if (isContainer(n)) for (const c of n.orderedChildIds) m.set(c, n.id);
  return m;
}
const getNode = (s: DocState, id: NodeId): DocNode =>
  s.nodesById.get(id) ?? invalid(`no node ${String(id)}`);

/**
 * Distinct existing nodes sorted in document pre-order (deterministic processing order), by
 * comparing their root-to-node child-index chains, built from the child lists of the targets'
 * ancestors (G-DOC-R stage C; formerly a whole-tree walk). The parent map is the state's
 * cached one when it exists; otherwise one is built for this call and not cached, so it is not
 * retained with a history state. Requires a valid tree (inputs are validated states).
 * Exported for tests.
 */
export function inDocumentOrder(s: DocState, ids: readonly NodeId[]): NodeId[] {
  if (ids.length < 2) return [...ids];
  const par = parentCache.get(s) ?? parentMap(s);
  const positions = new Map<NodeId | null, Map<NodeId, number>>();
  const position = (parent: NodeId | null, id: NodeId): number => {
    let m = positions.get(parent);
    if (!m) {
      m = new Map();
      const list =
        parent === null
          ? s.orderedRootIds
          : (s.nodesById.get(parent) as ContainerNode).orderedChildIds;
      list.forEach((c, i) => m!.set(c, i));
      positions.set(parent, m);
    }
    return m.get(id)!;
  };
  const chain = (id: NodeId): number[] => {
    const out: number[] = [];
    for (let x: NodeId | null = id; x !== null; x = par.get(x) ?? null)
      out.push(position(par.get(x) ?? null, x));
    return out.reverse();
  };
  const key = new Map(ids.map((id) => [id, chain(id)]));
  return [...ids].sort((a, b) => {
    const A = key.get(a)!;
    const B = key.get(b)!;
    for (let i = 0; i < A.length && i < B.length; i++) if (A[i] !== B[i]) return A[i]! - B[i]!;
    return A.length - B.length; // an ancestor precedes its descendants
  });
}

/** Distinct targets without a selected ancestor, in document order. */
function topLevel(s: DocState, ids: readonly NodeId[]): NodeId[] {
  const set = new Set(ids);
  for (const id of set) getNode(s, id);
  if (set.size === 1) return [...set];
  const par = parents(s);
  return inDocumentOrder(
    s,
    [...set].filter((id) => {
      for (let p = par.get(id) ?? null; p !== null; p = par.get(p) ?? null)
        if (set.has(p)) return false;
      return true;
    }),
  );
}

/** The Draft's node map: records every key it writes (SealedMap is the only write path). */
class DraftNodes extends SealedMap<NodeId, DocNode> {
  // Assigned after super(): the copy made by the Map constructor is not a write. Draft.finish
  // takes the set and turns this object into a plain SealedMap (see `publish`), so a published
  // map retains nothing of the Draft and has the same shape as a loaded state's map.
  written?: Set<NodeId> = new Set<NodeId>();
  /** Returns the written keys and becomes a plain, unsealed SealedMap (sealed by the caller). */
  publish(): Set<NodeId> {
    const written = this.written!;
    delete this.written;
    Object.setPrototypeOf(this, SealedMap.prototype);
    return written;
  }
  override set(k: NodeId, v: DocNode): this {
    super.set(k, v);
    this.written?.add(k);
    return this;
  }
  override delete(k: NodeId): boolean {
    const had = super.delete(k);
    this.written?.add(k);
    return had;
  }
  override clear(): void {
    throw new TypeError("a Draft's node map is never cleared");
  }
}

/** Copy-on-write draft of the node map and root list. */
class Draft {
  readonly base: DocState;
  readonly nodes: DraftNodes;
  readonly #log: DraftLog | undefined;
  roots: NodeId[];
  constructor(base: DocState, ctx: Pick<CommandContext, "log">) {
    this.base = base;
    this.nodes = new DraftNodes(base.nodesById);
    this.roots = [...base.orderedRootIds];
    this.#log = ctx.log;
  }
  get(id: NodeId): DocNode {
    return this.nodes.get(id) ?? invalid(`no node ${id}`);
  }
  update<T extends DocNode>(id: NodeId, patch: Partial<T>): void {
    this.nodes.set(id, { ...this.get(id), ...patch } as DocNode);
  }
  children(parent: NodeId | null): NodeId[] {
    return parent === null ? this.roots : [...(this.get(parent) as ContainerNode).orderedChildIds];
  }
  setChildren(parent: NodeId | null, ids: NodeId[]): void {
    if (parent === null) this.roots = ids;
    else this.update<ContainerNode>(parent, { orderedChildIds: ids });
  }
  /** Detaches nodes from their parents' child lists: one filter per parent, O(n). */
  detach(ids: readonly NodeId[], par: ReadonlyMap<NodeId, NodeId | null>): void {
    const byParent = new Map<NodeId | null, Set<NodeId>>();
    for (const id of ids) {
      const parent = par.get(id) ?? null;
      byParent.set(parent, (byParent.get(parent) ?? new Set()).add(id));
    }
    for (const [parent, set] of byParent)
      this.setChildren(
        parent,
        this.children(parent).filter((x) => !set.has(x)),
      );
  }
  removeSubtree(id: NodeId): void {
    const n = this.nodes.get(id);
    if (isContainer(n)) for (const c of n.orderedChildIds) this.removeSubtree(c);
    this.nodes.delete(id);
  }
  /** Freezes new or changed entries (not the whole state) and seals the maps (G-DOC review 3).
   *  Node entries: only the written keys can differ from the base. An unchanged sealed map is
   *  shared with the base. The written keys go to the transaction's log. */
  finish(extra: Partial<DocState> = {}): DocState {
    const base = this.base;
    const written = this.nodes.publish(); // sealed below: no further writes
    for (const k of written) {
      const v = this.nodes.get(k);
      if (v !== undefined && base.nodesById.get(k) !== v) freezeEntry(v);
    }
    const freezeChanged = <K, V extends object>(m: ReadonlyMap<K, V>, b: ReadonlyMap<K, V>) => {
      if (m === b && isSealedMap(m)) return m;
      for (const [k, v] of m) if (b.get(k) !== v) freezeEntry(v);
      return sealMap(m);
    };
    const out: DocState = {
      ...base,
      ...extra,
      orderedRootIds: Object.freeze([...this.roots]),
      nodesById: sealMap(this.nodes),
    };
    const state: DocState = Object.freeze({
      ...out,
      artboard: freezeEntry({ ...out.artboard }),
      stylesById: freezeChanged(out.stylesById, base.stylesById),
      paletteById: freezeChanged(out.paletteById, base.paletteById),
      sourceAssetsById: freezeChanged(out.sourceAssetsById, base.sourceAssetsById),
    });
    this.#log?.record(base, state, written);
    return state;
  }
}

const pathTargets = (s: DocState, ids: readonly NodeId[]): PathNode[] =>
  [...new Set(ids)].map((id) => {
    const n = getNode(s, id);
    return n.kind === "path" ? n : invalid(`${id} is not a PathObject`);
  });

// --- commands -----------------------------------------------------------------------------------
function commitTrace(
  s: DocState,
  c: Extract<Command, { type: "commitTrace" }>,
  ctx: CommandContext,
): DocState {
  const replaced = c.replaceLayerId === undefined ? null : getNode(s, c.replaceLayerId);
  if (replaced && replaced.kind !== "layer") invalid(`${c.replaceLayerId} is not a Layer`);
  if (c.name !== undefined && typeof c.name !== "string") invalid("name must be a string");
  // Checked before the packet is consumed; a private, frozen copy is stored (C10).
  const record = structuredClone(checkTraceProvenance(c.provenance, "provenance", false));
  const chunkId = ctx.commit(c.packet); // C2: consumes the packet; validates the owned bytes
  const traceProvenance = deepFreeze({ ...record, chunkId }) as TraceProvenance;
  const view = ctx.store.view(chunkId);
  const m = view.manifest;
  const d = new Draft(s, ctx);
  const ids = ctx.ids;
  // C3.1 mapping, IDs allocated deterministically: layer, palette entries, styles, then each
  // group followed by its paths in paint order.
  const layerId = replaced ? replaced.id : ids.alloc(KIND_PREFIX.layer);
  const usedStyles = new Set<number>();
  for (let i = 0; i < m.pathCount; i++) usedStyles.add(view.styleIndex(i));
  const palette = new Map(s.paletteById);
  const paletteByName = new Map<string, PaletteEntry>();
  const styles = new Map(s.stylesById);
  const styleIds: StyleId[] = [];
  m.styles.forEach((st, k) => {
    if (!usedStyles.has(k) || st.paletteId === null) return;
    const prev = paletteByName.get(st.paletteId);
    if (st.fill === null || (prev && prev.color !== st.fill))
      throw new DocumentError(
        "palette_conflict",
        `palette id ${st.paletteId} has no single colour`,
      );
    if (!prev) {
      const e: PaletteEntry = { id: ids.alloc("pal"), name: st.paletteId, color: st.fill };
      paletteByName.set(st.paletteId, e);
      palette.set(e.id, e);
    }
  });
  m.styles.forEach((st, k) => {
    if (!usedStyles.has(k)) return;
    const style: Style = {
      id: ids.alloc("sty"),
      fill: st.paletteId === null ? st.fill : null,
      paletteRef: st.paletteId === null ? null : paletteByName.get(st.paletteId)!.id,
      stroke: st.stroke ? { color: st.stroke.color, width: st.stroke.width } : null,
    };
    styles.set(style.id, style);
    styleIds[k] = style.id;
  });
  const groupIds: NodeId[] = [];
  let p = 0;
  m.groups.forEach((g, gi) => {
    const groupId = ids.alloc(KIND_PREFIX.group);
    groupIds.push(groupId);
    const children: NodeId[] = [];
    for (; p < m.pathCount && view.groupIndex(p) === gi; p++) {
      const st = m.styles[view.styleIndex(p)]!;
      const path: PathNode = {
        kind: "path",
        id: ids.alloc(KIND_PREFIX.path),
        name: "",
        visible: true,
        locked: false,
        localTransform: IDENTITY,
        geometry: { chunkId, pathIndex: p },
        styleRef: styleIds[view.styleIndex(p)]!,
        fillRule: st.evenOdd ? "evenodd" : "nonzero",
      };
      d.nodes.set(path.id, path);
      children.push(path.id);
    }
    d.nodes.set(groupId, {
      kind: "group",
      id: groupId,
      name: g.id,
      visible: true,
      locked: false,
      localTransform: IDENTITY,
      orderedChildIds: children,
      ...(g.clip ? { clipRef: { ...g.clip } } : {}),
    });
  });
  if (replaced) {
    for (const child of (replaced as ContainerNode).orderedChildIds) d.removeSubtree(child);
    d.update(layerId, { localTransform: IDENTITY, orderedChildIds: groupIds, traceProvenance });
  } else {
    d.nodes.set(layerId, {
      kind: "layer",
      id: layerId,
      name: c.name ?? "Trace",
      visible: true,
      locked: false,
      localTransform: IDENTITY,
      orderedChildIds: groupIds,
      traceProvenance,
    });
    d.roots.push(layerId);
  }
  return d.finish({ stylesById: styles, paletteById: palette });
}

function attachSource(
  s: DocState,
  c: Extract<Command, { type: "attachSource" }>,
  ctx: CommandContext,
): DocState {
  const assetId: AssetId = ctx.ids.alloc("ast");
  const nodeId = ctx.ids.alloc(KIND_PREFIX.source);
  const a = c.asset;
  const asset: SourceAsset = {
    id: assetId,
    digest: a.digest,
    mime: a.mime,
    width: a.width,
    height: a.height,
    embedded: a.embedded,
    decodePolicy: a.decodePolicy,
    ...(a.provenance === undefined ? {} : { provenance: { kind: a.provenance.kind } }),
  };
  const d = new Draft(s, ctx);
  d.nodes.set(nodeId, {
    kind: "source",
    id: nodeId,
    name: c.name ?? "Source",
    visible: true,
    locked: true, // RFC §5.1: locked by default
    localTransform: IDENTITY,
    assetId,
    sourceToDocument: IDENTITY,
  });
  d.roots.unshift(nodeId); // bottom of the paint order
  return d.finish({ sourceAssetsById: new Map(s.sourceAssetsById).set(assetId, asset) });
}

function remove(s: DocState, ids: readonly NodeId[], ctx: CommandContext): DocState {
  const d = new Draft(s, ctx);
  const par = parents(s);
  const removedAssets = new Set<AssetId>();
  const targets = topLevel(s, ids);
  d.detach(targets, par);
  for (const id of targets) {
    const n = s.nodesById.get(id)!;
    if (n.kind === "source") removedAssets.add(n.assetId);
    d.removeSubtree(id);
  }
  if (!removedAssets.size) return d.finish();
  // A source asset goes with its last reference; history keeps its bytes for undo (RFC §7).
  for (const n of d.nodes.values()) if (n.kind === "source") removedAssets.delete(n.assetId);
  const assets = new Map(s.sourceAssetsById);
  for (const a of removedAssets) assets.delete(a);
  return d.finish({ sourceAssetsById: assets });
}

function duplicate(s: DocState, ids: readonly NodeId[], ctx: CommandContext): DocState {
  const d = new Draft(s, ctx);
  const par = parents(s);
  const clone = (id: NodeId): NodeId => {
    const n = s.nodesById.get(id)!;
    const copyId = ctx.ids.alloc(KIND_PREFIX[n.kind]);
    // Pre-order allocation: the node first, then its children.
    const copy = { ...n, id: copyId } as DocNode;
    d.nodes.set(copyId, copy);
    if (isContainer(n))
      d.nodes.set(copyId, { ...copy, orderedChildIds: n.orderedChildIds.map(clone) } as DocNode);
    return copyId; // PathObjects keep the same { chunkId, pathIndex } and styleRef (C2 rule 9)
  };
  const copies = new Map<NodeId | null, Map<NodeId, NodeId>>();
  for (const id of topLevel(s, ids)) {
    const parent = par.get(id) ?? null;
    copies.set(parent, (copies.get(parent) ?? new Map()).set(id, clone(id)));
  }
  for (const [parent, map] of copies)
    d.setChildren(
      parent,
      d.children(parent).flatMap((x) => (map.has(x) ? [x, map.get(x)!] : [x])),
    );
  return d.finish();
}

function reorder(s: DocState, id: NodeId, index: number, ctx: CommandContext): DocState {
  getNode(s, id);
  const parent = parents(s).get(id) ?? null;
  const d = new Draft(s, ctx);
  const siblings = d.children(parent).filter((x) => x !== id);
  if (!(Number.isInteger(index) && index >= 0 && index <= siblings.length))
    invalid(`index ${index} out of range`);
  siblings.splice(index, 0, id);
  d.setChildren(parent, siblings);
  return d.finish();
}

function reparent(
  s: DocState,
  ids: readonly NodeId[],
  parentId: NodeId | null,
  index: number,
  ctx: CommandContext,
): DocState {
  const targets = topLevel(s, ids);
  const par = parents(s);
  if (parentId !== null) {
    const p = getNode(s, parentId);
    if (!isContainer(p)) invalid(`${parentId} is not a Layer or Group`);
    for (let a: NodeId | null = parentId; a !== null; a = par.get(a) ?? null)
      if (targets.includes(a)) invalid("cannot move a node into its own subtree");
  }
  for (const id of targets) {
    const k = s.nodesById.get(id)!.kind;
    const ok = parentId === null ? k === "layer" || k === "source" : k === "group" || k === "path";
    if (!ok) invalid(`${k} ${id} cannot move to ${parentId ?? "the root"}`);
  }
  const d = new Draft(s, ctx);
  d.detach(targets, par);
  const dest = d.children(parentId);
  if (!(Number.isInteger(index) && index >= 0 && index <= dest.length))
    invalid(`index ${index} out of range`);
  dest.splice(index, 0, ...targets);
  d.setChildren(parentId, dest);
  return d.finish(); // local transforms are kept; clip rule 3 is re-checked by the invariants
}

function patchAll(
  s: DocState,
  ids: readonly NodeId[],
  patch: (n: DocNode) => Partial<DocNode>,
  ctx: CommandContext,
): DocState {
  const d = new Draft(s, ctx);
  for (const id of new Set(ids)) d.update(id, patch(getNode(s, id)));
  return d.finish();
}

function setFill(
  s: DocState,
  c: Extract<Command, { type: "setFill" }>,
  ctx: CommandContext,
): DocState {
  const f = c.fill;
  if (f !== null && "color" in f && !isU32(f.color)) invalid("fill colour must be RGBA8888");
  if (f !== null && "paletteRef" in f && !s.paletteById.has(f.paletteRef))
    invalid(`no palette entry ${f.paletteRef}`);
  const targets = inDocumentOrder(
    s,
    pathTargets(s, c.ids).map((p) => p.id),
  ).map((id) => s.nodesById.get(id) as PathNode);
  // One new style per distinct original style, so recolouring never affects other objects.
  const styles = new Map(s.stylesById);
  const replacement = new Map<StyleId, StyleId>();
  const d = new Draft(s, ctx);
  for (const p of targets) {
    let id = replacement.get(p.styleRef);
    if (!id) {
      const old = s.stylesById.get(p.styleRef)!;
      id = ctx.ids.alloc("sty");
      styles.set(id, {
        id,
        fill: f !== null && "color" in f ? f.color : null,
        paletteRef: f !== null && "paletteRef" in f ? f.paletteRef : null,
        stroke: old.stroke,
      });
      replacement.set(p.styleRef, id);
    }
    d.update<PathNode>(p.id, { styleRef: id });
  }
  return d.finish({ stylesById: styles });
}

function group(
  s: DocState,
  ids: readonly NodeId[],
  name: string | undefined,
  ctx: CommandContext,
): DocState {
  const targets = topLevel(s, ids);
  if (!targets.length) invalid("nothing to group");
  const par = parents(s);
  const parent = par.get(targets[0]!) ?? null;
  if (parent === null || targets.some((id) => (par.get(id) ?? null) !== parent))
    invalid("grouped nodes must share one Layer or Group parent");
  const d = new Draft(s, ctx);
  const siblings = d.children(parent);
  const selected = new Set(targets);
  let last = -1;
  siblings.forEach((id, i) => {
    if (selected.has(id)) last = i;
  });
  const insertAt = last - targets.length + 1;
  const rest = siblings.filter((id) => !selected.has(id));
  const groupId = ctx.ids.alloc(KIND_PREFIX.group);
  d.nodes.set(groupId, {
    kind: "group",
    id: groupId,
    name: name ?? "Group",
    visible: true,
    locked: false,
    localTransform: IDENTITY,
    orderedChildIds: siblings.filter((id) => selected.has(id)),
  });
  rest.splice(insertAt, 0, groupId);
  d.setChildren(parent, rest);
  return d.finish();
}

function ungroup(s: DocState, id: NodeId, ctx: CommandContext): DocState {
  const g = getNode(s, id);
  if (g.kind !== "group") invalid(`${id} is not a Group`);
  if (g.clipRef) invalid(`${id} has a clip; release it before ungrouping`);
  const parent = parents(s).get(id) ?? null;
  const d = new Draft(s, ctx);
  const kids = (g as ContainerNode).orderedChildIds;
  // Children keep their appearance: composed transform and effective visibility/lock unchanged.
  for (const c of kids) {
    const n = d.get(c);
    d.update(c, {
      localTransform: multiply(g.localTransform, n.localTransform),
      visible: g.visible && n.visible,
      locked: g.locked || n.locked,
    });
  }
  const siblings = d.children(parent);
  siblings.splice(siblings.indexOf(id), 1, ...kids);
  d.setChildren(parent, siblings);
  d.nodes.delete(id);
  return d.finish();
}

function bake(s: DocState, c: Extract<Command, { type: "bake" }>, ctx: CommandContext): DocState {
  const targets = c.targetIds.map((id) => {
    const n = getNode(s, id);
    return n.kind === "path" ? n : invalid(`${id} is not a PathObject`);
  });
  if (new Set(c.targetIds).size !== targets.length) invalid("bake targets must be distinct");
  const chunkId = ctx.commit(c.packet); // one new chunk with only the affected paths (C2 rule 10)
  if (ctx.store.view(chunkId).pathCount !== targets.length)
    invalid("bake result must contain exactly one path per target");
  const d = new Draft(s, ctx);
  targets.forEach((p, i) =>
    d.update<PathNode>(p.id, { geometry: { chunkId, pathIndex: i }, localTransform: IDENTITY }),
  );
  return d.finish();
}

export function applyCommand(s: DocState, c: Command, ctx: CommandContext): DocState {
  switch (c.type) {
    case "attachSource":
      return attachSource(s, c, ctx);
    case "commitTrace":
      return commitTrace(s, c, ctx);
    case "delete":
      return remove(s, c.ids, ctx);
    case "duplicate":
      return duplicate(s, c.ids, ctx);
    case "reorder":
      return reorder(s, c.id, c.index, ctx);
    case "reparent":
      return reparent(s, c.ids, c.parentId, c.index, ctx);
    case "setVisible":
      return patchAll(s, c.ids, () => ({ visible: c.visible === true }), ctx);
    case "setLocked":
      return patchAll(s, c.ids, () => ({ locked: c.locked === true }), ctx);
    case "rename":
      return patchAll(s, [c.id], () => ({ name: String(c.name) }), ctx);
    case "setTransform":
      return patchAll(
        s,
        [c.id],
        () => ({ localTransform: [...c.matrix] as unknown as Matrix }),
        ctx,
      );
    case "applyTransform":
      return patchAll(
        s,
        c.ids,
        (n) => ({ localTransform: multiply(c.matrix, n.localTransform) }),
        ctx,
      );
    case "rotate90": {
      const r = rotate90Matrix(c.turns, c.pivot?.x ?? 0, c.pivot?.y ?? 0);
      return patchAll(s, c.ids, (n) => ({ localTransform: multiply(r, n.localTransform) }), ctx);
    }
    case "setFill":
      return setFill(s, c, ctx);
    case "setPaletteColor": {
      const e = s.paletteById.get(c.paletteRef) ?? invalid(`no palette entry ${c.paletteRef}`);
      if (!isU32(c.color)) invalid("colour must be RGBA8888");
      return new Draft(s, ctx).finish({
        paletteById: new Map(s.paletteById).set(e.id, { ...e, color: c.color }),
      });
    }
    case "group":
      return group(s, c.ids, c.name, ctx);
    case "ungroup":
      return ungroup(s, c.id, ctx);
    case "setClip": {
      const n = getNode(s, c.id);
      if (!isContainer(n))
        throw new DocumentError("clip_unsupported", `${c.id}: clips are Layer/Group only`);
      return patchAll(
        s,
        [c.id],
        () => ({
          clipRef: { x: c.rect.x, y: c.rect.y, width: c.rect.width, height: c.rect.height },
        }),
        ctx,
      );
    }
    case "releaseClip": {
      const n = getNode(s, c.id);
      if (!n.clipRef) return s;
      const d = new Draft(s, ctx);
      const { clipRef: _released, ...rest } = n;
      d.nodes.set(c.id, rest as DocNode);
      return d.finish();
    }
    case "setArtboard":
      return new Draft(s, ctx).finish({
        artboard: {
          width: c.width,
          height: c.height,
          background: c.background === undefined ? s.artboard.background : c.background,
        },
      });
    case "bake":
      return bake(s, c, ctx);
    default:
      return invalid(`unknown command ${(c as { type: unknown }).type as string}`);
  }
}
