// GeometryPacket v1 types (G-0 contract C3). Shared with the Rust engine
// (crates/vector-engine/src/packet.rs); both validators run tests/fixtures/packet-conformance.

export const PACKET_VERSION = 1;
export const MAX_COORD = 1e6;
export const MAX_ARTBOARD = 16_384;
export const MAX_TABLE_ENTRIES = 65_536;
export const MAX_MANIFEST_BYTES = 16 * 2 ** 20;
export const MAX_U32 = 2 ** 32 - 1;

export const VERB_M = 0;
export const VERB_L = 1;
export const VERB_C = 2;
export const VERB_Z = 3;

export type PacketErrorCode =
  | "version"
  | "manifest"
  | "budget"
  | "type"
  | "length"
  | "offsets"
  | "ref"
  | "opcode"
  | "grammar"
  | "arity"
  | "coord"
  | "padding";

export class PacketError extends Error {
  readonly code: PacketErrorCode;
  constructor(code: PacketErrorCode, message: string) {
    super(message);
    this.name = "PacketError";
    this.code = code;
  }
}

export interface ClipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StrokeStyle {
  /** RGBA8888. */
  color: number;
  width: number;
}

export interface Style {
  /** RGBA8888, or null for no fill. */
  fill: number | null;
  paletteId: string | null;
  stroke: StrokeStyle | null;
  evenOdd: boolean;
}

export interface GroupEntry {
  id: string;
  clip: ClipRect | null;
}

export interface Manifest {
  packetVersion: 1;
  width: number;
  height: number;
  pathCount: number;
  verbCount: number;
  coordCount: number;
  styles: Style[];
  groups: GroupEntry[];
}

export interface PacketArrays {
  verbs: Uint8Array;
  coords: Float64Array;
  verbOffsets: Uint32Array;
  coordOffsets: Uint32Array;
  styleIndex: Uint32Array;
  groupIndex: Uint32Array;
}

export interface GeometryPacket extends PacketArrays {
  manifest: Manifest;
}

/** Derived in the validation pass; never transported (C3.1). */
export interface Derived {
  /** Control-point bounds [x0, y0, x1, y1] per path. */
  bounds: Float64Array;
  pathAnchors: Uint32Array;
  /** Verb index of every M. */
  subpathStart: Uint32Array;
  anchors: number;
}

/** Caps checked before allocation (C3.2). */
export interface Limits {
  maxPaths: number;
  maxAnchors: number;
  /** Bound on M_mem + D_max. */
  maxBytes: number;
}

export const PRODUCT_LIMITS: Readonly<Limits> = Object.freeze({
  maxPaths: 1_000_000,
  maxAnchors: 1_000_000,
  maxBytes: 512 * 2 ** 20,
});

/** Engine engineering ceiling; never a product limit. */
export const ENGINEERING_LIMITS: Readonly<Limits> = Object.freeze({
  maxPaths: 1_000_000,
  maxAnchors: 5_000_000,
  maxBytes: 512 * 2 ** 20,
});
