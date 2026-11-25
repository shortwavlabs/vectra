// P1-A end-to-end document export pipeline (integration proof; shared by the unit test and
// scripts/document-export-regression.mjs):
//   scene v1 → GeometryPacket (WASM sceneToPacket) → document commitTrace (with provenance)
//   → .vectra save → strict load → export draw list (buildExport) → Rust bake (WASM)
//   → scene JSON, SVG, PDF.
import { createHash } from "node:crypto";
import { buildExport, type ExportJob } from "../../src/document/export.ts";
import { GeometryStore } from "../../src/document/geometry-store.ts";
import { createDocument } from "../../src/document/model.ts";
import {
  hexToRgba,
  type SceneMetaJson,
  traceProvenanceFromSceneMeta,
} from "../../src/document/provenance.ts";
import { DocumentSession } from "../../src/document/session.ts";
import { type Codec, loadContainer, saveContainer } from "../../src/persistence/container.ts";

/** The subset of the WASM module the pipeline uses. */
export interface EngineWasm {
  engineVersion(): string;
  sceneToPacket(sceneJson: string): {
    manifestJson: string;
    sceneMetaJson: string;
    takeVerbs(): Uint8Array;
    takeCoords(): Float64Array;
    takeVerbOffsets(): Uint32Array;
    takeCoordOffsets(): Uint32Array;
    takeStyleIndex(): Uint32Array;
    takeGroupIndex(): Uint32Array;
    free(): void;
  };
  PacketSet: new () => {
    add(
      m: string,
      ...a: [Uint8Array, Float64Array, Uint32Array, Uint32Array, Uint32Array, Uint32Array]
    ): number;
    free(): void;
  };
  exportDrawListScene(drawList: string, sceneMeta: string, set: unknown): string;
  exportDrawListSvg(drawList: string, sceneMeta: string, set: unknown): string;
  exportDrawListPdf(drawList: string, sceneMeta: string, options: string, set: unknown): Uint8Array;
}

export const PDF_OPTIONS = JSON.stringify({ width: 200, unit: "mm", dpi: null });
export const sha256 = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");

/** A document holding one committed trace of `sceneJson`, as the app would record it. */
export function documentFromScene(w: EngineWasm, sceneJson: string): DocumentSession {
  const p = w.sceneToPacket(sceneJson);
  const manifest = JSON.parse(p.manifestJson);
  const meta = JSON.parse(p.sceneMetaJson) as SceneMetaJson;
  const packet = {
    manifest,
    verbs: p.takeVerbs(),
    coords: p.takeCoords(),
    verbOffsets: p.takeVerbOffsets(),
    coordOffsets: p.takeCoordOffsets(),
    styleIndex: p.takeStyleIndex(),
    groupIndex: p.takeGroupIndex(),
  };
  p.free();
  const md = meta.metadata;
  const settings = md.params as { fit?: { mode?: string } };
  const session = new DocumentSession(new GeometryStore(), {
    state: createDocument({
      documentId: "p1a-e2e",
      width: manifest.width,
      height: manifest.height,
      background: meta.background === null ? null : hexToRgba(meta.background),
    }),
  });
  session.dispatch({
    type: "commitTrace",
    packet,
    provenance: traceProvenanceFromSceneMeta({
      sceneMeta: meta,
      width: manifest.width,
      height: manifest.height,
      traceRequest: {
        presetVersion: md.presetVersion,
        seed: md.seed,
        maxPixels: 50_000_000,
        maxAnchors: 1_000_000,
        settings: md.params as Record<string, unknown>,
      },
      // Content identity of the input this proof traces from (no pixels here).
      source: { digest: sha256(sceneJson), width: md.sourceWidth, height: md.sourceHeight },
      decodePolicy: "external",
      precisionFitVersion: settings.fit?.mode === "precision" ? 1 : null,
    }),
    name: "trace",
  });
  return session;
}

export interface Exported {
  job: ExportJob;
  scene: string;
  svg: string;
  pdf: Uint8Array;
  container: Uint8Array;
}

/** Saves, strictly reloads and exports a document through the Rust bake. */
export async function saveLoadExport(
  w: EngineWasm,
  session: DocumentSession,
  codec: Codec,
): Promise<Exported> {
  const container = await saveContainer(session, { codec });
  const loaded = await loadContainer(container, {});
  const job = buildExport(loaded.state, loaded.store, w.engineVersion());
  const { packets } = loaded.store.jobCopy([...job.chunks]);
  const set = new w.PacketSet();
  try {
    for (const p of packets)
      set.add(
        JSON.stringify(p.manifest),
        p.verbs,
        p.coords,
        p.verbOffsets,
        p.coordOffsets,
        p.styleIndex,
        p.groupIndex,
      );
    const dl = JSON.stringify(job.drawList);
    const sm = JSON.stringify(job.sceneMeta);
    return {
      job,
      scene: w.exportDrawListScene(dl, sm, set),
      svg: w.exportDrawListSvg(dl, sm, set),
      pdf: w.exportDrawListPdf(dl, sm, PDF_OPTIONS, set),
      container,
    };
  } finally {
    set.free();
  }
}
