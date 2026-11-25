// TEST-ONLY provenance helpers (no Vite-only imports, so plain Node scripts can use them).
import {
  type SceneMetaJson,
  type TraceProvenanceInput,
  traceProvenanceFromSceneMeta,
} from "../provenance.ts";

const placeholderDigest = (label: string) =>
  Array.from(
    { length: 64 },
    (_, i) => "0123456789abcdef"[(label.charCodeAt(i % label.length) + i) % 16],
  ).join("");

/** Provenance for a scene-v1 fixture, as a trace of that scene would record it (C10). */
export function sceneProvenance(
  scene: {
    width: number;
    height: number;
    background: string | null;
    palette: { id: string; color: string }[];
    metadata: Record<string, unknown>;
  },
  label = "fixture",
): TraceProvenanceInput {
  const md = scene.metadata as unknown as SceneMetaJson["metadata"];
  return traceProvenanceFromSceneMeta({
    sceneMeta: { background: scene.background, palette: scene.palette, metadata: md },
    width: scene.width,
    height: scene.height,
    traceRequest: {
      presetVersion: md.presetVersion,
      seed: md.seed,
      maxPixels: 50_000_000,
      maxAnchors: 1_000_000,
      settings: md.params as Record<string, unknown>,
    },
    source: { digest: placeholderDigest(label), width: md.sourceWidth, height: md.sourceHeight },
    decodePolicy: "external",
    precisionFitVersion: null,
  });
}

/** Generic valid provenance for synthetic packets (tests only). */
export const TEST_PROVENANCE: TraceProvenanceInput = sceneProvenance(
  {
    width: 256,
    height: 256,
    background: null,
    palette: [],
    metadata: {
      generator: "vectra",
      engineVersion: "0.0.0",
      mode: "bw",
      presetVersion: 1,
      seed: 1,
      sourceWidth: 256,
      sourceHeight: 256,
      params: { mode: "bw" },
    },
  },
  "synthetic",
);
