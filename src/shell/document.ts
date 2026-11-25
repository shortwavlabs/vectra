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

/**
 * INTERIM hit test (bounding boxes, not geometry): the visible, unlocked path with the
 * smallest box containing the point; ties go to the later (top-most) path. The G-R0/G-R1
 * renderer replaces this with exact hit testing (RFC-002 §9).
 */
export function hitTestBoxes(s: DocState, store: GeometryStore, x: number, y: number) {
  let best: NodeId | null = null;
  let bestArea = Infinity;
  const visit = (id: NodeId) => {
    const n = s.nodesById.get(id)!;
    if (!n.visible || n.locked) return;
    if (n.kind === "path") {
      const b = worldBounds(s, store, id);
      if (b && x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
        const area = b.width * b.height;
        if (area <= bestArea) [best, bestArea] = [id, area];
      }
    } else if (isContainer(n)) n.orderedChildIds.forEach(visit);
  };
  s.orderedRootIds.forEach(visit);
  return best;
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

/** Effective fill of a path (palette entries resolved), or null for no fill. */
export function pathFill(
  s: DocState,
  id: NodeId,
): { color: number | null; paletteName: string | null } {
  const n = s.nodesById.get(id);
  if (n?.kind !== "path") return { color: null, paletteName: null };
  const st = s.stylesById.get(n.styleRef)!;
  if (st.paletteRef === null) return { color: st.fill, paletteName: null };
  const e = s.paletteById.get(st.paletteRef)!;
  return { color: e.color, paletteName: e.name };
}

/** Path IDs among the targets (fill edits apply to paths only; `setFill` rejects others). */
export const pathIds = (s: DocState, ids: readonly NodeId[]) =>
  ids.filter((id) => s.nodesById.get(id)?.kind === "path");
