// TraceProvenance v1 and the source-asset subsets (contract C10, AM-1). Provenance is the
// historical record of one trace, stored on the Layer the trace created. No command ever
// modifies it, and it is never authoritative for current styles, transforms, palette, artboard
// or geometry: export-unedited status is computed from current state (src/document/export.ts).
import { canonicalJsonBytes } from "../persistence/canonical-json.ts";
import { type ChunkId, DocumentError, SCENE_ID_RE } from "./model.ts";

export const PROVENANCE_VERSION = 1;

/** Closed enum (C10): how the traced pixels were decoded. */
export type DecodePolicy = "browser-canvas-v1" | "external";
export const DECODE_POLICIES: ReadonlySet<string> = new Set(["browser-canvas-v1", "external"]);
export type FitMode = "spline" | "polygon" | "pixel" | "precision";
const FIT_MODES: ReadonlySet<string> = new Set(["spline", "polygon", "pixel", "precision"]);

/** v1 subset of source-asset provenance (C10). */
export interface SourceProvenance {
  readonly kind: "local-file";
}

export interface SceneMetadataRecord {
  readonly generator: string;
  readonly engineVersion: string;
  readonly mode: string;
  readonly presetVersion: number;
  readonly seed: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /** The engine's settings JSON, exactly as recorded (canonical JSON in files). */
  readonly params: Readonly<Record<string, unknown>>;
}

export interface TraceRequestRecord {
  readonly presetVersion: number;
  readonly seed: number;
  readonly maxPixels: number;
  readonly maxAnchors: number;
  readonly settings: Readonly<Record<string, unknown>>;
}

export interface TraceProvenance {
  readonly provenanceVersion: 1;
  /** The commit-time chunk: a historical geometry reference (may no longer resolve). */
  readonly chunkId: ChunkId;
  /** Content identity of the traced pixels; never a file name. */
  readonly source: { readonly digest: string; readonly width: number; readonly height: number };
  readonly decodePolicy: DecodePolicy;
  readonly traceRequest: TraceRequestRecord;
  readonly engineVersion: string;
  readonly fitMode: FitMode | null;
  readonly precisionFitVersion: number | null;
  readonly presetVersion: number;
  readonly seed: number;
  readonly originalScene: {
    readonly width: number;
    readonly height: number;
    readonly background: number | null;
    readonly palette: readonly { readonly id: string; readonly color: number }[];
    readonly metadata: SceneMetadataRecord;
  };
}

/** What a caller supplies to `commitTrace`; the store assigns `chunkId`. */
export type TraceProvenanceInput = Omit<TraceProvenance, "chunkId">;

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_PALETTE = 65_536;
const U32_MAX = 2 ** 32 - 1;
const DIGEST_RE = /^[0-9a-f]{64}$/;
const VERSION_RE = /^[0-9A-Za-z.+-]{1,64}$/;
const CHUNK_RE = /^chk_[0-9]{1,15}$/;

const fail = (where: string, m: string): never => {
  throw new DocumentError("invariant", `${where}: ${m}`);
};
type J = Record<string, unknown>;
const object = (v: unknown, where: string, keys: readonly string[]): J => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) fail(where, "expected an object");
  const o = v as J;
  if (Object.keys(o).length !== keys.length || !keys.every((k) => Object.hasOwn(o, k)))
    fail(where, `members must be exactly ${keys.join(", ")}`);
  return o;
};
const isU32 = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= U32_MAX;
const isDim = (v: unknown, integer: boolean): v is number =>
  typeof v === "number" && v > 0 && v <= 16_384 && (!integer || Number.isInteger(v));
const plainJson = (v: unknown, where: string): J => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) fail(where, "expected an object");
  return v as J;
};

/** Strict shape and value check for an on-file or committed provenance record. */
export function checkTraceProvenance(v: unknown, where: string, withChunk = true): TraceProvenance {
  const keys = [
    "provenanceVersion",
    "source",
    "decodePolicy",
    "traceRequest",
    "engineVersion",
    "fitMode",
    "precisionFitVersion",
    "presetVersion",
    "seed",
    "originalScene",
  ];
  const o = object(v, where, withChunk ? [...keys, "chunkId"] : keys);
  if (o.provenanceVersion !== PROVENANCE_VERSION) fail(where, "unsupported provenanceVersion");
  if (withChunk && !(typeof o.chunkId === "string" && CHUNK_RE.test(o.chunkId)))
    fail(where, "chunkId must be a chunk id");
  const src = object(o.source, `${where}.source`, ["digest", "width", "height"]);
  if (!(typeof src.digest === "string" && DIGEST_RE.test(src.digest)))
    fail(where, "source.digest must be lowercase SHA-256 hex");
  if (!isDim(src.width, true) || !isDim(src.height, true)) fail(where, "source size out of range");
  if (typeof o.decodePolicy !== "string" || !DECODE_POLICIES.has(o.decodePolicy))
    fail(where, "decodePolicy is not a known policy");
  const req = object(o.traceRequest, `${where}.traceRequest`, [
    "presetVersion",
    "seed",
    "maxPixels",
    "maxAnchors",
    "settings",
  ]);
  for (const k of ["presetVersion", "seed", "maxPixels", "maxAnchors"] as const)
    if (!isU32(req[k]) || ((k === "maxPixels" || k === "maxAnchors") && req[k] === 0))
      fail(where, `traceRequest.${k} out of range`);
  const settings = plainJson(req.settings, `${where}.traceRequest.settings`);
  if (typeof settings.mode !== "string") fail(where, "traceRequest.settings.mode must be a string");
  if (canonicalJsonBytes(req).length > MAX_REQUEST_BYTES)
    fail(where, "traceRequest larger than 64 KiB");
  if (!(typeof o.engineVersion === "string" && VERSION_RE.test(o.engineVersion)))
    fail(where, "engineVersion must be 1–64 bytes of [0-9A-Za-z.+-]");
  if (o.fitMode !== null && !(typeof o.fitMode === "string" && FIT_MODES.has(o.fitMode)))
    fail(where, "fitMode is not a known fit mode");
  const fit = settings.fit as J | undefined;
  const settingsFit =
    fit && typeof fit === "object" && typeof fit.mode === "string" ? fit.mode : null;
  if ((o.fitMode ?? null) !== settingsFit)
    fail(where, "fitMode must equal traceRequest.settings.fit.mode");
  if (
    o.precisionFitVersion !== null &&
    !(Number.isInteger(o.precisionFitVersion) && (o.precisionFitVersion as number) >= 1)
  )
    fail(where, "precisionFitVersion must be a positive integer or null");
  if (!isU32(o.presetVersion) || o.presetVersion !== req.presetVersion)
    fail(where, "presetVersion must equal traceRequest.presetVersion");
  if (!isU32(o.seed) || o.seed !== req.seed) fail(where, "seed must equal traceRequest.seed");
  const sc = object(o.originalScene, `${where}.originalScene`, [
    "width",
    "height",
    "background",
    "palette",
    "metadata",
  ]);
  if (!isDim(sc.width, false) || !isDim(sc.height, false))
    fail(where, "originalScene size out of range");
  if (sc.background !== null && !isU32(sc.background))
    fail(where, "originalScene.background must be RGBA8888");
  if (!Array.isArray(sc.palette) || sc.palette.length > MAX_PALETTE)
    fail(where, "originalScene.palette must be an array of at most 65,536 entries");
  const ids = new Set<string>();
  (sc.palette as unknown[]).forEach((e, i) => {
    const p = object(e, `${where}.originalScene.palette[${i}]`, ["id", "color"]);
    if (!(typeof p.id === "string" && SCENE_ID_RE.test(p.id)) || ids.has(p.id))
      fail(where, `originalScene.palette[${i}].id is invalid or duplicated`);
    ids.add(p.id as string);
    if (!isU32(p.color)) fail(where, `originalScene.palette[${i}].color must be RGBA8888`);
  });
  const md = object(sc.metadata, `${where}.originalScene.metadata`, [
    "generator",
    "engineVersion",
    "mode",
    "presetVersion",
    "seed",
    "sourceWidth",
    "sourceHeight",
    "params",
  ]);
  for (const k of ["generator", "mode"] as const)
    if (!(typeof md[k] === "string" && (md[k] as string).length <= 64))
      fail(where, `metadata.${k} must be a short string`);
  plainJson(md.params, `${where}.originalScene.metadata.params`);
  if (md.engineVersion !== o.engineVersion)
    fail(where, "metadata.engineVersion must equal engineVersion");
  if (md.presetVersion !== o.presetVersion)
    fail(where, "metadata.presetVersion must equal presetVersion");
  if (md.seed !== o.seed) fail(where, "metadata.seed must equal seed");
  if (md.sourceWidth !== src.width || md.sourceHeight !== src.height)
    fail(where, "metadata source size must equal source.width/height");
  return o as unknown as TraceProvenance;
}

export function checkSourceProvenance(v: unknown, where: string): SourceProvenance {
  const o = object(v, where, ["kind"]);
  if (o.kind !== "local-file") fail(where, 'source provenance kind must be "local-file" in v1');
  return o as unknown as SourceProvenance;
}

/** The engine's `SceneMeta` JSON (`sceneMetaJson` from `vectorizePacket`/`fitPacket`). */
export interface SceneMetaJson {
  readonly background: string | null;
  readonly palette: readonly { readonly id: string; readonly color: string }[];
  readonly metadata: SceneMetadataRecord;
}

/** `#rrggbb` / `#rrggbbaa` → RGBA8888, as the engine's `Rgba`. */
export function hexToRgba(hex: string): number {
  if (!/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(hex))
    throw new DocumentError("invalid_argument", `colour ${JSON.stringify(hex)} is not #rrggbb[aa]`);
  const n = parseInt(hex.slice(1), 16);
  return hex.length === 9 ? n >>> 0 : ((n * 256) | 0xff) >>> 0;
}

/** RGBA8888 → `#rrggbb` (opaque) or `#rrggbbaa`, as the engine serialises `Rgba`. */
export function rgbaToHex(v: number): string {
  const hex = (v >>> 0).toString(16).padStart(8, "0");
  return hex.endsWith("ff") ? `#${hex.slice(0, 6)}` : `#${hex}`;
}

/**
 * Builds a trace's provenance from what the engine returned with it (C10). `width`/`height`
 * are the scene's artboard (the packet manifest's), `traceRequest` the request that was run.
 */
export function traceProvenanceFromSceneMeta(o: {
  sceneMeta: SceneMetaJson;
  width: number;
  height: number;
  traceRequest: TraceRequestRecord;
  source: { digest: string; width: number; height: number };
  decodePolicy: DecodePolicy;
  precisionFitVersion: number | null;
}): TraceProvenanceInput {
  const md = o.sceneMeta.metadata;
  const fit = o.traceRequest.settings.fit as { mode?: unknown } | undefined;
  const input = {
    provenanceVersion: PROVENANCE_VERSION,
    source: { ...o.source },
    decodePolicy: o.decodePolicy,
    traceRequest: structuredClone(o.traceRequest),
    engineVersion: md.engineVersion,
    fitMode: (typeof fit?.mode === "string" ? fit.mode : null) as FitMode | null,
    precisionFitVersion: o.precisionFitVersion,
    presetVersion: md.presetVersion,
    seed: md.seed,
    originalScene: {
      width: o.width,
      height: o.height,
      background: o.sceneMeta.background === null ? null : hexToRgba(o.sceneMeta.background),
      palette: o.sceneMeta.palette.map((e) => ({ id: e.id, color: hexToRgba(e.color) })),
      metadata: structuredClone(md),
    },
  };
  return checkTraceProvenance(input, "provenance", false);
}
