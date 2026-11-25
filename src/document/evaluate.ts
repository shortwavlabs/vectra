// The single document evaluation (C8 rule 5): composed transforms, effective visibility,
// style and fill rule, effective clips and runs. It produces the C8 `{ runs, drawList }` that
// the render snapshot, hit testing and the export draw list share.

import {
  type ChunkId,
  type ContainerNode,
  type DocState,
  intersectRects,
  mapRect,
  type Matrix,
  multiply,
  type NodeId,
  type PaletteId,
  type Rect,
  SCENE_ID_RE,
} from "./model.ts";

export interface Run {
  /** Scene-v1 id: the container's name when valid and unused by an earlier run, else run-<k>. */
  readonly id: string;
  /** Effective clip in document space, or null. */
  readonly clip: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  } | null;
  /** The root Layer the run belongs to (export attribution; not part of the C8 snapshot). */
  readonly layerId: NodeId;
}
export interface DrawItem {
  readonly chunkId: ChunkId;
  readonly pathIndex: number;
  readonly transform: Matrix; // effective (composed) 2×3, [a, b, c, d, e, f]
  readonly fill: number | null;
  readonly stroke?: { readonly color: number; readonly width: number };
  readonly evenOdd: boolean;
  readonly groupRun: number;
  /** Effective palette entry, or null for a literal fill (the export's `paletteId` source). */
  readonly paletteRef: PaletteId | null;
  /** The root Layer the item belongs to (export attribution; not part of the C8 snapshot). */
  readonly layerId: NodeId;
  /** The PathObject drawn (hit testing and selection; not part of the C8 snapshot). */
  readonly nodeId: NodeId;
  /** The PathObject or an ancestor is locked: drawn, but not selectable on the canvas. */
  readonly locked: boolean;
}
export interface Evaluation {
  readonly runs: readonly Run[];
  readonly drawList: readonly DrawItem[];
}

const isEmpty = (r: Rect) => !(r.width > 0 && r.height > 0);

/**
 * Visible items in paint order. Fully clipped subtrees (empty effective clip) are omitted, and
 * so are their runs. A visible, not fully clipped container whose subtree emits nothing yields
 * one empty run (C8 rule 6; see the gate report for why this reading is used).
 */
export function evaluate(s: DocState): Evaluation {
  const runs: Run[] = [];
  const drawList: DrawItem[] = [];
  const used = new Set<string>();
  let runOwner: NodeId | null = null;
  let layerId: NodeId = "";

  const startRun = (node: ContainerNode, clip: Rect | null) => {
    const k = runs.length;
    let id = SCENE_ID_RE.test(node.name) && !used.has(node.name) ? node.name : `run-${k}`;
    for (let n = 1; used.has(id); n++) id = `run-${k}-${n}`; // only if a container took run-<k>
    used.add(id);
    runs.push({
      id,
      clip: clip && { x: clip.x, y: clip.y, w: clip.width, h: clip.height },
      layerId,
    });
    runOwner = node.id;
  };

  const visit = (node: ContainerNode, m: Matrix, clip: Rect | null, locked: boolean) => {
    let emitted = false;
    for (const childId of node.orderedChildIds) {
      const child = s.nodesById.get(childId)!;
      if (!child.visible) continue;
      if (child.kind === "path") {
        if (runOwner !== node.id) startRun(node, clip);
        const style = s.stylesById.get(child.styleRef)!;
        const fill =
          style.paletteRef === null ? style.fill : s.paletteById.get(style.paletteRef)!.color;
        drawList.push({
          chunkId: child.geometry.chunkId,
          pathIndex: child.geometry.pathIndex,
          transform: multiply(m, child.localTransform),
          fill,
          ...(style.stroke
            ? { stroke: { color: style.stroke.color, width: style.stroke.width } }
            : {}),
          evenOdd: child.fillRule === "evenodd",
          groupRun: runs.length - 1,
          paletteRef: style.paletteRef,
          layerId,
          nodeId: child.id,
          locked: locked || child.locked,
        });
        emitted = true;
      } else if (child.kind === "group") {
        const cm = multiply(m, child.localTransform);
        const cclip = child.clipRef ? intersectRects(clip, mapRect(cm, child.clipRef)) : clip;
        if (cclip && isEmpty(cclip)) continue; // fully clipped: omitted with its runs
        visit(child, cm, cclip, locked || child.locked);
        emitted = true;
      }
    }
    if (!emitted) startRun(node, clip);
  };

  for (const id of s.orderedRootIds) {
    const n = s.nodesById.get(id)!;
    if (n.kind !== "layer" || !n.visible) continue; // sources are never in the draw list
    const clip = n.clipRef ? mapRect(n.localTransform, n.clipRef) : null;
    if (clip && isEmpty(clip)) continue;
    layerId = n.id;
    visit(n, n.localTransform, clip, n.locked);
  }
  return { runs, drawList };
}
