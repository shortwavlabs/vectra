// Default settings per mode. Mirrors the engine defaults (crates/vector-engine/src/params.rs);
// they are starting hypotheses, not tuned presets (PRESETS.md).
import type { FitSettings, Mode, Settings, TraceRequest } from "../vectorization/types.ts";

const fit: FitSettings = {
  mode: "spline",
  cornerThreshold: 60,
  lengthThreshold: 4,
  spliceThreshold: 45,
  simplify: 0,
};

export const DEFAULT_SETTINGS: { [M in Mode]: Extract<Settings, { mode: M }> } = {
  bw: {
    mode: "bw",
    threshold: 128,
    invert: false,
    speckle: 16,
    alphaThreshold: 128,
    ink: "#000000",
    fit,
  },
  color: {
    mode: "color",
    colorPrecision: 6,
    layerDifference: 16,
    speckle: 16,
    alphaThreshold: 128,
    compositing: "stacked",
    fit,
  },
  limited: {
    mode: "limited",
    colors: 8,
    palette: null,
    speckle: 16,
    alphaThreshold: 128,
    compositing: "mosaic",
    fit,
  },
  halftone: {
    mode: "halftone",
    pitch: 8,
    angle: 45,
    ink: "#1d1d1b",
    paper: "#f3ead8",
    gamma: 1,
    contrast: 0,
    minCoverage: 0.02,
    dotPaths: "compound",
  },
};

export const MODE_LABELS: Record<Mode, string> = {
  bw: "Black & White",
  color: "Full Color",
  limited: "Limited Color (experiment)",
  halftone: "Old Print halftone (experiment)",
};

export function makeRequest(
  settings: Settings,
  maxPixels: number,
  maxAnchors = 1_000_000,
  seed = 1,
): TraceRequest {
  return { presetVersion: 1, seed, maxPixels, maxAnchors, settings };
}
