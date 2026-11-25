// Export snapshot (C8 export draw list, AM-1 AR-2; C10 export metadata semantics). Builds the
// frozen input of an export job from the current document: the export draw list, the chunks it
// references (packet-set order) and the SceneMeta. The engine bakes it (`bake_draw_list`).
//
// - Unedited single trace: the whole draw list equals one export-unedited traced layer's C3.1
//   identity draw list and the artboard equals that trace's original scene, so the trace's
//   original background, palette and metadata are used verbatim (byte-identical export).
// - Everything else exports in document form: the current document is the authority, and
//   provenance appears only as labelled `derivedFrom` entries. Original trace metadata is never
//   presented as describing edited artwork.
import { evaluate, type DrawItem, type Run } from "./evaluate.ts";
import type { GeometryStore } from "./geometry-store.ts";
import { type ChunkId, type DocState, IDENTITY, type LayerNode, SCENE_ID_RE } from "./model.ts";
import { rgbaToHex, type TraceProvenance } from "./provenance.ts";

export interface ExportRun {
  readonly id: string;
  readonly clip: { x: number; y: number; width: number; height: number } | null;
}
export interface ExportItem {
  readonly chunk: number;
  readonly pathIndex: number;
  readonly transform: readonly number[];
  readonly fill: number | null;
  readonly paletteId: string | null;
  readonly stroke: { color: number; width: number } | null;
  readonly evenOdd: boolean;
  readonly groupRun: number;
}
export interface ExportDrawList {
  readonly width: number;
  readonly height: number;
  readonly runs: readonly ExportRun[];
  readonly items: readonly ExportItem[];
}
export interface ExportSceneMeta {
  readonly background: string | null;
  readonly palette: readonly { readonly id: string; readonly color: string }[];
  readonly metadata: Readonly<Record<string, unknown>>;
}
export interface ExportJob {
  readonly form: "original" | "document";
  readonly drawList: ExportDrawList;
  /** Packet-set order: `items[k].chunk` indexes this list. */
  readonly chunks: readonly ChunkId[];
  readonly sceneMeta: ExportSceneMeta;
}

interface Contribution {
  runs: Run[];
  items: DrawItem[];
  firstRun: number;
}

const sameClip = (
  a: Run["clip"],
  b: { x: number; y: number; width: number; height: number } | null,
) =>
  a === null
    ? b === null
    : b !== null && a.x === b.x && a.y === b.y && a.w === b.width && a.h === b.height;

/**
 * True when a layer's exported runs and items are exactly the C3.1 identity draw list of its
 * trace's chunk (C10 "export-unedited"). Computed from current state on every call. A run id
 * renamed only because an earlier layer's run already took the packet's group id (C8 rule 6)
 * is not an edit; the single-trace original form separately requires exact ids.
 */
function isExportUnedited(
  s: DocState,
  store: GeometryStore,
  p: TraceProvenance,
  c: Contribution,
  takenBefore: ReadonlySet<string>,
): boolean {
  if (!store.has(p.chunkId)) return false;
  const v = store.view(p.chunkId);
  const m = v.manifest;
  if (c.runs.length !== m.groups.length || c.items.length !== m.pathCount) return false;
  for (let g = 0; g < m.groups.length; g++) {
    const r = c.runs[g]!;
    const id = m.groups[g]!.id;
    const renamedForCollision = takenBefore.has(id) && /^run-[0-9]+(-[0-9]+)?$/.test(r.id);
    if ((r.id !== id && !renamedForCollision) || !sameClip(r.clip, m.groups[g]!.clip)) return false;
  }
  for (let i = 0; i < m.pathCount; i++) {
    const it = c.items[i]!;
    const st = m.styles[v.styleIndex(i)]!;
    const name = it.paletteRef === null ? null : s.paletteById.get(it.paletteRef)!.name;
    const stroke = it.stroke ?? null;
    if (
      it.chunkId !== p.chunkId ||
      it.pathIndex !== i ||
      it.groupRun - c.firstRun !== v.groupIndex(i) ||
      !it.transform.every((x, k) => x === IDENTITY[k]) ||
      it.fill !== st.fill ||
      name !== st.paletteId ||
      it.evenOdd !== st.evenOdd ||
      (stroke === null) !== (st.stroke === null) ||
      (stroke !== null && (stroke.color !== st.stroke!.color || stroke.width !== st.stroke!.width))
    )
      return false;
  }
  return true;
}

export function buildExport(s: DocState, store: GeometryStore, engineVersion: string): ExportJob {
  const ev = evaluate(s);
  const contributions = new Map<string, Contribution>();
  const contribution = (layerId: string, firstRun: number) => {
    let c = contributions.get(layerId);
    if (!c) contributions.set(layerId, (c = { runs: [], items: [], firstRun }));
    return c;
  };
  ev.runs.forEach((r, k) => contribution(r.layerId, k).runs.push(r));
  for (const it of ev.drawList) contribution(it.layerId, it.groupRun).items.push(it);

  const traced: { layer: LayerNode; p: TraceProvenance; unedited: boolean }[] = [];
  for (const [layerId, c] of contributions) {
    const layer = s.nodesById.get(layerId) as LayerNode;
    if (layer.traceProvenance) {
      const takenBefore = new Set(ev.runs.slice(0, c.firstRun).map((r) => r.id));
      traced.push({
        layer,
        p: layer.traceProvenance,
        unedited: isExportUnedited(s, store, layer.traceProvenance, c, takenBefore),
      });
    }
  }
  const single = contributions.size === 1 && traced.length === 1 ? traced[0]! : null;
  const ab = s.artboard;
  const original =
    single !== null &&
    single.unedited &&
    ab.width === single.p.originalScene.width &&
    ab.height === single.p.originalScene.height &&
    ab.background === single.p.originalScene.background;

  // Palette: names verbatim in original form; in document form, first-use order with unique ids.
  const sceneIds = new Map<string, string>();
  const palette: { id: string; color: string }[] = [];
  const used = new Set<string>();
  if (!original)
    for (const it of ev.drawList) {
      if (it.paletteRef === null || sceneIds.has(it.paletteRef)) continue;
      const e = s.paletteById.get(it.paletteRef)!;
      let id = SCENE_ID_RE.test(e.name) && !used.has(e.name) ? e.name : "";
      for (let k = 0; id === ""; k++) if (!used.has(`p${k}`)) id = `p${k}`;
      used.add(id);
      sceneIds.set(it.paletteRef, id);
      palette.push({ id, color: rgbaToHex(e.color) });
    }

  const chunks: ChunkId[] = [];
  const chunkIndex = new Map<ChunkId, number>();
  const items: ExportItem[] = ev.drawList.map((it) => {
    let chunk = chunkIndex.get(it.chunkId);
    if (chunk === undefined) {
      chunk = chunks.length;
      chunks.push(it.chunkId);
      chunkIndex.set(it.chunkId, chunk);
    }
    return {
      chunk,
      pathIndex: it.pathIndex,
      transform: [...it.transform],
      fill: it.fill,
      paletteId:
        it.paletteRef === null
          ? null
          : original
            ? s.paletteById.get(it.paletteRef)!.name
            : sceneIds.get(it.paletteRef)!,
      stroke: it.stroke ? { color: it.stroke.color, width: it.stroke.width } : null,
      evenOdd: it.evenOdd,
      groupRun: it.groupRun,
    };
  });
  const drawList: ExportDrawList = {
    width: ab.width,
    height: ab.height,
    runs: ev.runs.map((r) => ({
      id: r.id,
      clip: r.clip && { x: r.clip.x, y: r.clip.y, width: r.clip.w, height: r.clip.h },
    })),
    items,
  };

  if (original) {
    const sc = single!.p.originalScene;
    return {
      form: "original",
      drawList,
      chunks,
      sceneMeta: {
        background: sc.background === null ? null : rgbaToHex(sc.background),
        palette: sc.palette.map((e) => ({ id: e.id, color: rgbaToHex(e.color) })),
        metadata: structuredClone(sc.metadata) as unknown as Record<string, unknown>,
      },
    };
  }
  return {
    form: "document",
    drawList,
    chunks,
    sceneMeta: {
      background: ab.background === null ? null : rgbaToHex(ab.background),
      palette,
      metadata: {
        generator: "vectra",
        engineVersion,
        mode: "document",
        presetVersion: 0,
        seed: 0,
        sourceWidth: Math.ceil(ab.width),
        sourceHeight: Math.ceil(ab.height),
        params: {
          documentSchemaVersion: 1,
          derivedFrom: traced.map(({ p, unedited }) => ({
            sourceDigest: p.source.digest,
            mode: p.originalScene.metadata.mode,
            presetVersion: p.presetVersion,
            seed: p.seed,
            fitMode: p.fitMode,
            precisionFitVersion: p.precisionFitVersion,
            edited: !unedited,
          })),
        },
      },
    },
  };
}
