// TypeScript mirror of the engine's request/response schema (crates/vector-engine/src/params.rs,
// lib.rs, scene.rs). The engine re-validates everything; these types only guide the UI.

export type FitMode = "spline" | "polygon" | "pixel";
export type Compositing = "stacked" | "mosaic";

export interface FitSettings {
  mode: FitMode;
  cornerThreshold: number;
  lengthThreshold: number;
  spliceThreshold: number;
  simplify: number;
}

export interface BwSettings {
  mode: "bw";
  threshold: number;
  invert: boolean;
  speckle: number;
  alphaThreshold: number;
  ink: string;
  fit: FitSettings;
}

export interface ColorSettings {
  mode: "color";
  colorPrecision: number;
  layerDifference: number;
  speckle: number;
  alphaThreshold: number;
  compositing: Compositing;
  fit: FitSettings;
}

export interface LimitedSettings {
  mode: "limited";
  colors: number;
  palette: string[] | null;
  speckle: number;
  alphaThreshold: number;
  compositing: Compositing;
  fit: FitSettings;
}

export interface HalftoneSettings {
  mode: "halftone";
  pitch: number;
  angle: number;
  ink: string;
  paper: string | null;
  gamma: number;
  contrast: number;
  minCoverage: number;
  dotPaths: "compound" | "perDot";
}

export type Settings = BwSettings | ColorSettings | LimitedSettings | HalftoneSettings;
export type Mode = Settings["mode"];

export interface TraceRequest {
  presetVersion: 1;
  seed: number;
  maxPixels: number;
  maxAnchors: number;
  settings: Settings;
}

export interface SceneStats {
  groups: number;
  paths: number;
  subpaths: number;
  anchors: number;
  lines: number;
  cubics: number;
}

export interface EngineMetrics {
  width: number;
  height: number;
  mode: Mode;
  timingsMs: Record<
    "preprocess" | "segment" | "colorFit" | "compose" | "optimize" | "scene" | "validate",
    number
  >;
  stats: SceneStats;
  paletteSize: number;
  dots: number;
}

export interface EngineWarning {
  code: string;
  message: string;
}

export type LengthUnit = "mm" | "in" | "pt" | "px";

export interface PdfOptions {
  width: number;
  unit: LengthUnit;
  dpi?: number;
}
