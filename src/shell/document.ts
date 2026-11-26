// Read-only document queries and command builders for the workspace shell (G-UI). The shell
// never mutates the document directly: every edit is a RFC-002 §7 command dispatched through
// DocumentSession, so undo/redo, coalescing and validation stay in the document layer.
import type { Command } from "../document/commands.ts";
import { parents } from "../document/commands.ts";
import type { GeometryStore } from "../document/geometry-store.ts";
import {
  type DocNode,
  type DocState,
  IDENTITY,
  isContainer,
  type Matrix,
  multiply,
  type NodeId,
  type PaletteId,
  rotate90Matrix,
} from "../document/model.ts";

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Composed (document-space) matrix of a node's parent; identity for roots. */
export function parentMatrix(s: DocState, id: NodeId): Matrix {
  const par = parents(s);
  let m: Matrix = IDENTITY;
  for (let p = par.get(id) ?? null; p !== null; p = par.get(p) ?? null)
    m = multiply(s.nodesById.get(p)!.localTransform, m);
  return m;
}

export const worldMatrix = (s: DocState, id: NodeId): Matrix =>
  multiply(parentMatrix(s, id), s.nodesById.get(id)!.localTransform);

export function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** A node is effectively locked when it or any ancestor is locked (commands do not enforce
 *  locks, so the shell does). */
export function isLocked(s: DocState, id: NodeId): boolean {
  const par = parents(s);
  for (let n: NodeId | null = id; n !== null; n = par.get(n) ?? null)
    if (s.nodesById.get(n)?.locked) return true;
  return false;
}

/** Whether a node's subtree (itself or any descendant) is locked. */
export function containsLocked(s: DocState, id: NodeId): boolean {
  const n = s.nodesById.get(id);
  if (!n) return false;
  if (n.locked) return true;
  return isContainer(n) && n.orderedChildIds.some((c) => containsLocked(s, c));
}

/** Whether the selection may be moved or scaled: no locked node above, at or below it. */
export function transformable(s: DocState, ids: readonly NodeId[]): boolean {
  const top = topLevel(s, ids);
  return top.length > 0 && top.every((id) => !isLocked(s, id) && !containsLocked(s, id));
}

/** Locked nodes in a subtree (each node whose own lock is set). */
function lockedIn(s: DocState, id: NodeId): number {
  const n = s.nodesById.get(id);
  if (!n) return 0;
  const own = n.locked ? 1 : 0;
  return isContainer(n) ? own + n.orderedChildIds.reduce((k, c) => k + lockedIn(s, c), 0) : own;
}

/** The shell's deletion policy (maintainer review, G-R1). A lock protects an object from deletion
 *  as it does from transforms: deleting a container that holds locked descendants would delete
 *  them with it, so the whole deletion is refused with an explanation until they are unlocked.
 *  Directly locked items in the selection are kept (not deleted) and reported. Commands do not
 *  enforce locks; every delete entry point in the shell goes through this. */
export function planDeletion(
  s: DocState,
  ids: readonly NodeId[],
): { refused: string } | { ids: NodeId[]; kept: number } {
  const top = topLevel(s, ids);
  const rest = top.filter((id) => !isLocked(s, id));
  const blocking = rest.filter((id) => containsLocked(s, id));
  if (blocking.length) {
    const n = blocking.reduce((k, id) => k + lockedIn(s, id), 0);
    const holder =
      blocking.length === 1
        ? `"${displayName(s.nodesById.get(blocking[0]!)!, s)}" contains`
        : `${blocking.length} selected items contain`;
    const objects = n === 1 ? "1 locked object" : `${n} locked objects`;
    return {
      refused: `Not deleted: ${holder} ${objects}. Unlock ${n === 1 ? "it" : "them"} to delete.`,
    };
  }
  return { ids: rest, kept: top.length - rest.length };
}

export function isVisible(s: DocState, id: NodeId): boolean {
  const par = parents(s);
  for (let n: NodeId | null = id; n !== null; n = par.get(n) ?? null)
    if (s.nodesById.get(n)?.visible === false) return false;
  return true;
}

/** Selected IDs without a selected ancestor (a transform applies once per subtree). */
export function topLevel(s: DocState, ids: readonly NodeId[]): NodeId[] {
  const set = new Set(ids.filter((id) => s.nodesById.has(id)));
  const par = parents(s);
  return [...set].filter((id) => {
    for (let p = par.get(id) ?? null; p !== null; p = par.get(p) ?? null)
      if (set.has(p)) return false;
    return true;
  });
}

function mapBox(m: Matrix, x0: number, y0: number, x1: number, y1: number): Box {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ] as const) {
    xs.push(m[0] * x + m[2] * y + m[4]);
    ys.push(m[1] * x + m[3] * y + m[5]);
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function union(a: Box | null, b: Box | null): Box | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

const boundsCache = new WeakMap<DocState, Map<NodeId, Box | null>>();
/** Document-space box of a node's path control points (C3 derived bounds), or null if empty.
 *  Hidden descendants are included; clips are not applied. Cached per immutable state. */
export function worldBounds(s: DocState, store: GeometryStore, id: NodeId): Box | null {
  let cache = boundsCache.get(s);
  if (!cache) boundsCache.set(s, (cache = new Map()));
  if (cache.has(id)) return cache.get(id)!;
  const walk = (n: DocNode, m: Matrix): Box | null => {
    const mm = multiply(m, n.localTransform);
    if (n.kind === "path") {
      const [x0, y0, x1, y1] = store.derived(n.geometry.chunkId).bounds(n.geometry.pathIndex);
      return mapBox(mm, x0, y0, x1, y1);
    }
    if (!isContainer(n)) return null;
    let b: Box | null = null;
    for (const c of n.orderedChildIds) b = union(b, walk(s.nodesById.get(c)!, mm));
    return b;
  };
  const node = s.nodesById.get(id);
  const b = node ? walk(node, parentMatrix(s, id)) : null;
  cache.set(id, b);
  return b;
}

export function selectionBounds(s: DocState, store: GeometryStore, ids: readonly NodeId[]) {
  let b: Box | null = null;
  for (const id of ids) b = union(b, worldBounds(s, store, id));
  return b;
}

/** Commands that apply a document-space affine `w` to each top-level target (one transaction):
 *  local' = P⁻¹ · w · P · local, so the node's world matrix becomes w · world. */
export function worldTransformCommands(s: DocState, ids: readonly NodeId[], w: Matrix): Command[] {
  return topLevel(s, ids).map((id) => {
    const p = parentMatrix(s, id);
    return { type: "applyTransform", ids: [id], matrix: multiply(invert(p), multiply(w, p)) };
  });
}

export const translation = (dx: number, dy: number): Matrix => [1, 0, 0, 1, dx, dy];

/** Uniform scale by `f` about (cx, cy). */
export const scalingAbout = (f: number, cx: number, cy: number): Matrix => [
  f,
  0,
  0,
  f,
  cx - f * cx,
  cy - f * cy,
];

export const quarterTurnAbout = (turns: 1 | 3, cx: number, cy: number) =>
  rotate90Matrix(turns, cx, cy);

/** Uniform scale factor of a matrix (√|det|): 1 for an untransformed trace. */
export const uniformScale = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

// --- Layers panel ------------------------------------------------------------------------------

/** Panels list the top-most item first; the model paints `orderedChildIds` first to last. */
export const modelIndex = (count: number, displayIndex: number) => count - 1 - displayIndex;

export function siblingsOf(s: DocState, id: NodeId): readonly NodeId[] {
  const p = parents(s).get(id) ?? null;
  if (p === null) return s.orderedRootIds;
  const parent = s.nodesById.get(p);
  return isContainer(parent) ? parent.orderedChildIds : [];
}

/** Move one step towards the top (+1) or bottom (−1) of the stack, or null at an end. */
export function stepCommand(s: DocState, id: NodeId, step: 1 | -1): Command | null {
  const sib = siblingsOf(s, id);
  const i = sib.indexOf(id);
  const j = i + step;
  if (i < 0 || j < 0 || j >= sib.length) return null;
  return { type: "reorder", id, index: j };
}

/** A drag/keyboard move within one sibling list, both indices in display (top-first) order. */
export function moveCommand(
  s: DocState,
  id: NodeId,
  fromDisplay: number,
  toDisplay: number,
): Command | null {
  const sib = siblingsOf(s, id);
  if (fromDisplay === toDisplay || sib[modelIndex(sib.length, fromDisplay)] !== id) return null;
  return { type: "reorder", id, index: modelIndex(sib.length, toDisplay) };
}

export function pathCount(s: DocState, id: NodeId): number {
  const n = s.nodesById.get(id);
  if (!n) return 0;
  if (n.kind === "path") return 1;
  if (!isContainer(n)) return 0;
  let k = 0;
  for (const c of n.orderedChildIds) k += pathCount(s, c);
  return k;
}

export function displayName(n: DocNode, s: DocState): string {
  if (n.name) return n.name;
  if (n.kind === "path") return `Path ${n.geometry.pathIndex + 1}`;
  if (n.kind === "source") {
    const a = s.sourceAssetsById.get(n.assetId);
    return a ? `Source image ${a.width}×${a.height}` : "Source image";
  }
  return n.kind === "group" ? "Group" : "Layer";
}

/**
 * The friendly form of an engine-generated palette name, or null for a name the engine does not
 * generate. The engine numbers a trace's colours from 0 by preset: `p0`…`p7` (Limited Palette),
 * `c0`, `c1`… (Full Colour), `ink`, `ink1`… (Black & White and halftone; `ink` is the first),
 * `x0`… (a Limited Palette fallback). They become "Colour N+1", N being the number in the name,
 * never the list position (the palette is in first-use order).
 */
export function generatedLabel(name: string): string | null {
  if (name === "ink") return "Colour 1";
  const m = /^(?:p|c|x|ink)(\d+)$/.exec(name);
  return m ? `Colour ${Number(m[1]) + 1}` : null;
}

const labelCache = new WeakMap<DocState, ReadonlyMap<PaletteId, string>>();
/**
 * What each palette entry is called on screen and to assistive technology (display only: the
 * entries, their IDs, names, colours and order, and export are unchanged).
 *
 * A name is treated as engine-generated only when trace provenance proves it, never because of
 * its pattern alone. The commit path names each entry after the scene's palette id, and the
 * layer's `traceProvenance.originalScene.palette` lists those ids. An entry is generated when a
 * path under a traced layer uses it and that layer's provenance records the entry's name.
 *
 * Strict (maintainer final acceptance): an entry no path uses has no identifiable trace owner, so
 * it keeps its stored name. Its origin is never inferred from unrelated traces; a raw engine name
 * ("p2") is preferred over relabelling a name that may be user-defined.
 * Accepted limitation of the current document model: a custom name equal to an id of the entry's
 * own trace is indistinguishable from a generated one. To be resolved before user-facing palette
 * renaming is introduced (TECHNICAL-DEBT, G-UI-R report §18).
 *
 * Generated names become "Colour N+1"; every other name is shown as it is. A generated label is
 * unique in the palette: if a stored name or an earlier entry already has it, " (2)", " (3)"…
 * is added, in palette order, so a second trace's colours read "Colour 1 (2)"…
 *
 * Cost: one walk of each traced layer's subtree, with each layer's recorded ids collected once,
 * then one pass over the palette; linear in nodes and entries. (The previous form copied each
 * trace's id list into a set per entry: quadratic in a Full Colour trace's palette, 13,662
 * entries for bark-1224, and it exhausted the heap; scripts/bench-palette-labels.mjs.)
 */
export function paletteLabels(s: DocState): ReadonlyMap<PaletteId, string> {
  const cached = labelCache.get(s);
  if (cached) return cached;
  const generated = new Set<PaletteId>();
  for (const root of s.orderedRootIds) {
    const layer = s.nodesById.get(root);
    if (layer?.kind !== "layer" || !layer.traceProvenance) continue;
    const ids = new Set(layer.traceProvenance.originalScene.palette.map((e) => e.id));
    if (ids.size === 0) continue;
    const stack: NodeId[] = [];
    for (const c of layer.orderedChildIds) stack.push(c);
    while (stack.length > 0) {
      const n = s.nodesById.get(stack.pop()!);
      if (!n) continue;
      if (n.kind === "path") {
        const ref = s.stylesById.get(n.styleRef)?.paletteRef ?? null;
        if (ref !== null && !generated.has(ref) && ids.has(s.paletteById.get(ref)?.name ?? ""))
          generated.add(ref);
      } else if (isContainer(n)) for (const c of n.orderedChildIds) stack.push(c);
    }
  }
  const entries = [...s.paletteById.values()];
  const friendly = new Map<PaletteId, string>();
  for (const e of entries) {
    const g = generated.has(e.id) ? generatedLabel(e.name) : null;
    if (g !== null) friendly.set(e.id, g);
  }
  const taken = new Set<string>();
  for (const e of entries) if (!friendly.has(e.id)) taken.add(e.name);
  const next = new Map<string, number>(); // per label: the next suffix to try
  const out = new Map<PaletteId, string>();
  for (const e of entries) {
    const g = friendly.get(e.id);
    if (g === undefined) {
      out.set(e.id, e.name);
      continue;
    }
    let label = g;
    let k = next.get(g) ?? 2;
    while (taken.has(label)) label = `${g} (${k++})`;
    next.set(g, k);
    taken.add(label);
    out.set(e.id, label);
  }
  labelCache.set(s, out);
  return out;
}

/** Effective fill of a path (palette entries resolved), or null for no fill. */
export function pathFill(
  s: DocState,
  id: NodeId,
): { color: number | null; paletteId: PaletteId | null } {
  const n = s.nodesById.get(id);
  if (n?.kind !== "path") return { color: null, paletteId: null };
  const st = s.stylesById.get(n.styleRef)!;
  if (st.paletteRef === null) return { color: st.fill, paletteId: null };
  return { color: s.paletteById.get(st.paletteRef)!.color, paletteId: st.paletteRef };
}

/**
 * The paths a fill edit applies to: selected paths and the paths inside selected layers and
 * groups (so a fill is reachable by keyboard through the Layers panel), skipping anything
 * locked. `setFill` accepts paths only.
 */
export function fillTargets(s: DocState, ids: readonly NodeId[]): NodeId[] {
  const out = new Set<NodeId>();
  const walk = (id: NodeId) => {
    const n = s.nodesById.get(id);
    if (!n || n.locked) return;
    if (n.kind === "path") out.add(id);
    else if (isContainer(n)) n.orderedChildIds.forEach(walk);
  };
  ids.forEach(walk);
  return [...out];
}
