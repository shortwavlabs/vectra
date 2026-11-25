// Render snapshot and packet read types (C8 r2). Immutable once sent; the renderer never sees the
// document, only these values and render copies of packets.

/** 2×3 affine transform [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Affine = readonly [number, number, number, number, number, number];

export interface RenderRun {
  readonly id: string;
  /** Effective clip in document space, or null. */
  readonly clip: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  } | null;
}

export interface RenderItem {
  readonly chunkId: string;
  readonly pathIndex: number;
  /** Effective (composed) transform, document space. */
  readonly transform: Affine;
  /** RGBA 0xRRGGBBAA, or null for no fill. */
  readonly fill: number | null;
  readonly stroke?: { readonly color: number; readonly width: number };
  readonly evenOdd: boolean;
  /** Index into `runs`. */
  readonly groupRun: number;
}

export interface RenderSnapshot {
  readonly renderRevision: number;
  readonly documentRevision: number;
  /** Artboard size and background (RGBA or null = paper). */
  readonly artboard: {
    readonly width: number;
    readonly height: number;
    readonly background: number | null;
  };
  readonly runs: readonly RenderRun[];
  /** Paint order. */
  readonly drawList: readonly RenderItem[];
  /** Draw-list indices of selected items (outlined). */
  readonly selection: readonly number[];
}

/** A render copy of a packet's geometry (fresh buffers from `GeometryStore.renderCopy`). */
export interface RenderPacket {
  readonly chunkId: string;
  readonly verbs: Uint8Array;
  readonly coords: Float64Array;
  readonly verbOffsets: Uint32Array;
  readonly coordOffsets: Uint32Array;
}

/** Document → CSS pixels: x_css = scale · x_doc + tx (same for y). */
export interface Camera {
  readonly scale: number;
  readonly tx: number;
  readonly ty: number;
}
