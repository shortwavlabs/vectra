// Document v1 (RFC-002 §5.1) as immutable state objects, C1 identifiers and 2×3 affine helpers.
// One DocState per committed transaction; undo/redo restore states by reference (C7 dirty
// tracking). High-water marks (nextId, nextChunkId) and the revision live outside DocState.

import { NodeMap } from "./node-map.ts";
import type { PacketErrorCode } from "./packet-port.ts";

import type { DecodePolicy, SourceProvenance, TraceProvenance } from "./provenance.ts";

export type NodeId = string;
export type ChunkId = string;
export type StyleId = string;
export type PaletteId = string;
export type AssetId = string;

/** 2×3 affine [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (Canvas order). */
export type Matrix = readonly [number, number, number, number, number, number];
export const IDENTITY: Matrix = Object.freeze([1, 0, 0, 1, 0, 0] as const);

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export type FillRule = "nonzero" | "evenodd";

interface NodeBase {
  readonly id: NodeId;
  readonly name: string;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly localTransform: Matrix;
  /** P1: a rect in the node's local space, Layers and Groups only (C8). */
  readonly clipRef?: Rect;
}
export interface LayerNode extends NodeBase {
  readonly kind: "layer";
  readonly orderedChildIds: readonly NodeId[];
  /** Historical record of the trace that created this layer (C10); never authoritative. */
  readonly traceProvenance?: TraceProvenance;
}
export interface GroupNode extends NodeBase {
  readonly kind: "group";
  readonly orderedChildIds: readonly NodeId[];
}
export interface GeometryRef {
  readonly chunkId: ChunkId;
  readonly pathIndex: number;
}
export interface PathNode extends NodeBase {
  readonly kind: "path";
  readonly geometry: GeometryRef;
  readonly styleRef: StyleId;
  readonly fillRule: FillRule;
}
export interface SourceNode extends NodeBase {
  readonly kind: "source";
  readonly assetId: AssetId;
  readonly sourceToDocument: Matrix;
}
export type DocNode = LayerNode | GroupNode | PathNode | SourceNode;
export type ContainerNode = LayerNode | GroupNode;

/** A document style; `fill` (literal) and `paletteRef` are mutually exclusive colour authorities. */
export interface Style {
  readonly id: StyleId;
  readonly fill: number | null;
  readonly paletteRef: PaletteId | null;
  readonly stroke: { readonly color: number; readonly width: number } | null;
}
/** `name` keeps the packet/scene palette id (scene-v1 id rule) for export. */
export interface PaletteEntry {
  readonly id: PaletteId;
  readonly name: string;
  readonly color: number;
}
export type SourceMime = "image/png" | "image/jpeg" | "image/webp";
export interface SourceAsset {
  readonly id: AssetId;
  readonly digest: string; // SHA-256, lowercase hex
  readonly mime: SourceMime;
  readonly width: number;
  readonly height: number;
  readonly embedded: boolean;
  readonly decodePolicy: DecodePolicy;
  readonly provenance?: SourceProvenance;
}
export interface Artboard {
  readonly width: number;
  readonly height: number;
  readonly background: number | null;
}

export interface DocState {
  readonly documentId: string;
  readonly artboard: Artboard;
  readonly orderedRootIds: readonly NodeId[];
  readonly nodesById: ReadonlyMap<NodeId, DocNode>;
  readonly stylesById: ReadonlyMap<StyleId, Style>;
  readonly paletteById: ReadonlyMap<PaletteId, PaletteEntry>;
  readonly sourceAssetsById: ReadonlyMap<AssetId, SourceAsset>;
}

/** The documentSchemaVersion this build writes: 2, the compact encoding (C10 r2, AM-3.2). It
 *  still reads 1. Export metadata keeps its own literal `documentSchemaVersion: 1` (C10 export
 *  metadata semantics; frozen export bytes), which this constant never changes. */
export const DOCUMENT_SCHEMA_VERSION = 2;

export type DocumentErrorCode =
  | PacketErrorCode
  | "ownership"
  | "unknown_chunk"
  | "history_budget"
  | "clip_unsupported"
  | "clip_transform_unsupported"
  | "invalid_transform"
  | "not_found"
  | "invalid_argument"
  | "palette_conflict"
  | "persist_limit"
  | "invariant";

export class DocumentError extends Error {
  override name = "DocumentError";
  readonly code: DocumentErrorCode;
  constructor(code: DocumentErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

// --- C1 identifiers ---------------------------------------------------------------------------
export const NODE_ID_RE = /^[a-z]{3}_[0-9]{1,15}$/;
export const SCENE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const KIND_PREFIX = { layer: "lay", group: "grp", path: "pth", source: "src" } as const;
export const idNumber = (id: string) => Number(id.slice(4));
export const idPrefix = (id: string) => id.slice(0, 3);

/** Allocates C1 IDs from a draft copy of `nextId`; the session adopts `next` only on success. */
export class IdAllocator {
  next: number;
  constructor(next: number) {
    this.next = next;
  }
  alloc(prefix: string): string {
    if (!Number.isSafeInteger(this.next) || this.next > 999_999_999_999_999)
      throw new DocumentError("invariant", "node ID space exhausted");
    return `${prefix}_${this.next++}`;
  }
}

/** A Map that rejects writes once sealed: committed state maps are immutable at runtime. */
const SEALED = new WeakSet<object>();
export class SealedMap<K, V> extends Map<K, V> {
  override set(k: K, v: V): this {
    if (SEALED.has(this)) throw new TypeError("committed document maps are immutable");
    return super.set(k, v);
  }
  override delete(k: K): boolean {
    if (SEALED.has(this)) throw new TypeError("committed document maps are immutable");
    return super.delete(k);
  }
  override clear(): void {
    if (SEALED.has(this)) throw new TypeError("committed document maps are immutable");
    super.clear();
  }
}
/** True for a sealed (immutable, shareable) document map. */
export const isSealedMap = (m: ReadonlyMap<unknown, unknown>): boolean => SEALED.has(m);
/** Seals `m`: an already sealed map is returned as is (immutable, so shareable); an unsealed
 *  SealedMap owned by the caller is sealed in place; anything else is copied first. */
export function sealMap<K, V>(m: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  if (SEALED.has(m)) return m;
  const out = m instanceof SealedMap ? m : new SealedMap(m);
  SEALED.add(out);
  return out;
}
/** Freezes a node, style, palette entry or asset and its small nested arrays/objects. */
export function freezeEntry<T extends object>(v: T): T {
  if (Object.isFrozen(v)) return v;
  for (const x of Object.values(v))
    if (x !== null && typeof x === "object" && !Object.isFrozen(x)) freezeEntry(x as object);
  return Object.freeze(v);
}
/** Highest chunk number a `.vectra` section id can carry (15 digits, C1/C7). */
export const MAX_CHUNK_NUMBER = 999_999_999_999_999;

export function createDocument(o: {
  documentId?: string;
  width: number;
  height: number;
  background?: number | null;
}): DocState {
  return Object.freeze({
    documentId: o.documentId ?? crypto.randomUUID(),
    artboard: Object.freeze({ width: o.width, height: o.height, background: o.background ?? null }),
    orderedRootIds: Object.freeze([]) as readonly NodeId[],
    nodesById: NodeMap.empty<DocNode>(),
    stylesById: sealMap(new Map()),
    paletteById: sealMap(new Map()),
    sourceAssetsById: sealMap(new Map()),
  });
}

// --- 2×3 affine ---------------------------------------------------------------------------------
/** m1 × m2 (apply m2, then m1). `+ 0` folds -0 to 0, so states stay JSON-equal after load. */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  const [a, b, c, d, e, f] = m1;
  const [A, B, C, D, E, F] = m2;
  return [
    a * A + c * B + 0,
    b * A + d * B + 0,
    a * C + c * D + 0,
    b * C + d * D + 0,
    a * E + c * F + e + 0,
    b * E + d * F + f + 0,
  ];
}

/** C8 rule 3, compared exactly: translation, scale, reflection and 90° rotations. */
export const isAxisPreserving = (m: Matrix) =>
  (m[1] === 0 && m[2] === 0) || (m[0] === 0 && m[3] === 0);

export const MAX_TRANSFORM_ENTRY = 1e9;
/** Condition-number tolerance for "non-singular" (RFC §5.1): κ = σmax/σmin ≤ 1e8. */
export const MAX_CONDITION = 1e8;

export function transformProblem(m: unknown): string | null {
  if (!Array.isArray(m) || m.length !== 6) return "transform must be 6 numbers";
  if (
    !m.every(
      (v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= MAX_TRANSFORM_ENTRY,
    )
  )
    return "transform entries must be finite and |v| ≤ 1e9";
  const [a, b, c, d] = m as number[] as [number, number, number, number];
  const det = a * d - b * c;
  if (det === 0) return "singular transform";
  const t = a * a + b * b + c * c + d * d;
  const smax2 = (t + Math.sqrt(Math.max(0, t * t - 4 * det * det))) / 2;
  const kappa = smax2 / Math.abs(det); // σmax / σmin, since σmin = |det| / σmax
  return kappa <= MAX_CONDITION ? null : `ill-conditioned transform (κ = ${kappa})`;
}

/** Exact quarter-turn matrices about a pivot (y down; turns clockwise on screen). */
export function rotate90Matrix(turns: 1 | 2 | 3, px = 0, py = 0): Matrix {
  if (turns !== 1 && turns !== 2 && turns !== 3)
    throw new DocumentError("invalid_argument", "rotate90 turns must be 1, 2 or 3");
  if (turns === 1) return [0, 1, -1, 0, px + py, py - px];
  if (turns === 2) return [-1, 0, 0, -1, 2 * px, 2 * py];
  return [0, -1, 1, 0, px - py, px + py];
}

/**
 * Axis-aligned image of a local rect under an axis-preserving transform (C8 rule 3). The
 * min corner comes from the transformed corners and the extent from |scale|·size, so an
 * identity transform reproduces the rect bit for bit (C8 rule 2: P0 route unchanged).
 */
export function mapRect(m: Matrix, r: Rect): Rect {
  const [a, b, c, d, e, f] = m;
  if (b === 0 && c === 0)
    return {
      x: a * r.x + e + (a < 0 ? a * r.width : 0),
      y: d * r.y + f + (d < 0 ? d * r.height : 0),
      width: Math.abs(a) * r.width,
      height: Math.abs(d) * r.height,
    };
  if (a === 0 && d === 0)
    return {
      x: c * r.y + e + (c < 0 ? c * r.height : 0),
      y: b * r.x + f + (b < 0 ? b * r.width : 0),
      width: Math.abs(c) * r.height,
      height: Math.abs(b) * r.width,
    };
  throw new DocumentError(
    "clip_transform_unsupported",
    "clip under a non-axis-preserving transform",
  );
}

function axis(a0: number, aw: number, b0: number, bw: number): [number, number] {
  const start = Math.max(a0, b0);
  const end = Math.min(a0 + aw, b0 + bw);
  if (start === a0 && end === a0 + aw) return [a0, aw]; // a's interval inside b's: keep it exact
  if (start === b0 && end === b0 + bw) return [b0, bw];
  return [start, end - start];
}

/** Intersection of two axis-aligned rects (C8 rule 4); width or height ≤ 0 means empty. */
export function intersectRects(p: Rect | null, q: Rect): Rect {
  if (!p) return q;
  const [x, width] = axis(p.x, p.width, q.x, q.width);
  const [y, height] = axis(p.y, p.height, q.y, q.height);
  return { x, y, width, height };
}

export const isContainer = (n: DocNode | undefined): n is ContainerNode =>
  n?.kind === "layer" || n?.kind === "group";
