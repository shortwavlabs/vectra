// The packet port: the only C3 surface G-DOC production code depends on (G0 next-gate brief,
// "How G-DOC stays independent"). The GeometryStore and the container code receive a port at
// construction. Until the P1-A integration step, tests inject the test-only adapter
// (src/document/testing/packet-adapter.ts); integration wires G-ENG's production validator and
// C3.0 codec (src/geometry/packet) in its place and deletes the duplicated shapes below.

/** C3 validation codes, plus the C3.0 byte-decoding-only `padding` (and `length`). */
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

export interface PacketRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PacketStyle {
  fill: number | null; // RGBA8888
  paletteId: string | null;
  stroke: { color: number; width: number } | null;
  evenOdd: boolean;
}

export interface PacketGroup {
  id: string;
  clip: PacketRect | null;
}

/** C3 manifest. */
export interface PacketManifest {
  packetVersion: 1;
  width: number;
  height: number;
  pathCount: number;
  verbCount: number;
  coordCount: number;
  styles: PacketStyle[];
  groups: PacketGroup[];
}

/** The six C3 sections, in table order. */
export interface PacketArrays {
  verbs: Uint8Array;
  coords: Float64Array;
  verbOffsets: Uint32Array;
  coordOffsets: Uint32Array;
  styleIndex: Uint32Array;
  groupIndex: Uint32Array;
}

export const SECTION_KEYS = [
  "verbs",
  "coords",
  "verbOffsets",
  "coordOffsets",
  "styleIndex",
  "groupIndex",
] as const satisfies readonly (keyof PacketArrays)[];

/** A C3 manifest plus the six section arrays (C2). */
export interface IncomingPacket extends PacketArrays {
  manifest: PacketManifest;
}

/** Fresh copies returned by `jobCopy`/`renderCopy`; safe to put in a transfer list. */
export type TransferPacket = IncomingPacket;

/** C3.1 derived metadata, computed in the validation pass; never transported. */
export interface DerivedMetadata {
  bounds: Float64Array; // 4 per path: minX, minY, maxX, maxY (control points)
  pathAnchors: Uint32Array; // per path
  subpathStart: Uint32Array; // verb index of every M
  anchors: number;
}

/** C3.2 caps (defaults; a profile may lower them). */
export interface PacketLimits {
  maxAnchors: number;
  maxPaths: number;
  /** Cap on `M_mem + D_max`. */
  maxBytes: number;
  maxStyles: number;
  maxGroups: number;
  /** Cap on `Lm` for byte streams. */
  maxManifestBytes: number;
}

export const DEFAULT_PACKET_LIMITS: Readonly<PacketLimits> = Object.freeze({
  maxAnchors: 1_000_000,
  maxPaths: 1_000_000,
  maxBytes: 512 * 2 ** 20,
  maxStyles: 65_536,
  maxGroups: 65_536,
  maxManifestBytes: 16 * 2 ** 20,
});

export type PacketFailure = { ok: false; code: PacketErrorCode; message: string };

export interface PacketPort {
  /** C3 validation, in the C3 order, over arrays the caller owns. Never throws. */
  validate(
    manifest: PacketManifest,
    arrays: PacketArrays,
    limits: PacketLimits,
  ): { ok: true; derived: DerivedMetadata } | PacketFailure;
  /** C3.0 geometry record (`u32 Lm | canonical manifest | pad | block`). Fresh bytes. */
  encodeRecord(manifest: PacketManifest, arrays: PacketArrays): Uint8Array;
  /** C3.0 decode with caps before allocation; arrays are fresh and whole-buffer. Never throws. */
  decodeRecord(
    bytes: Uint8Array,
    limits: PacketLimits,
  ): { ok: true; packet: IncomingPacket } | PacketFailure;
}

/** `M_mem` (C3.2): the sum of the six section byte lengths. */
export const packetMemBytes = (m: Pick<PacketManifest, "pathCount" | "verbCount" | "coordCount">) =>
  m.verbCount + 8 * m.coordCount + 16 * m.pathCount + 8;
