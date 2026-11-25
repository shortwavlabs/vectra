// The document's packet integration (P1-A integration). G-DOC uses G-ENG's sole production
// validator and C3.0 codec (`src/geometry/packet`): there is no alternative validation path.
// This module adapts their throwing API to the result values the store and loader use, and
// re-exports the C3 types under the names the document code uses.
import { decodeRecord as decode, encodeRecord as encode } from "../geometry/packet/codec.ts";
import {
  type ClipRect,
  type Derived,
  type GeometryPacket,
  type GroupEntry,
  type Limits,
  type Manifest,
  type PacketArrays as Arrays,
  PacketError,
  type PacketErrorCode as Code,
  PRODUCT_LIMITS,
  type Style,
} from "../geometry/packet/types.ts";
import { validatePacket } from "../geometry/packet/validate.ts";

export type PacketErrorCode = Code;
export type PacketRect = ClipRect;
export type PacketStyle = Style;
export type PacketGroup = GroupEntry;
export type PacketManifest = Manifest;
export type PacketArrays = Arrays;
/** A C3 manifest plus the six section arrays (C2). */
export type IncomingPacket = GeometryPacket;
/** Fresh copies returned by `jobCopy`/`renderCopy`; safe to put in a transfer list. */
export type TransferPacket = IncomingPacket;
/** C3.1 derived metadata, computed in the validation pass; never transported. */
export type DerivedMetadata = Derived;
/** C3.2 caps (the product profile by default; a profile may lower them). */
export type PacketLimits = Limits;
export const DEFAULT_PACKET_LIMITS: Readonly<PacketLimits> = PRODUCT_LIMITS;

export const SECTION_KEYS = [
  "verbs",
  "coords",
  "verbOffsets",
  "coordOffsets",
  "styleIndex",
  "groupIndex",
] as const satisfies readonly (keyof PacketArrays)[];

export type PacketFailure = { ok: false; code: PacketErrorCode; message: string };

const failure = (e: unknown): PacketFailure => {
  if (e instanceof PacketError) return { ok: false, code: e.code, message: e.message };
  throw e;
};

/** C3 validation (production validator) over arrays the caller owns. Never throws a PacketError. */
export function validate(
  manifest: PacketManifest,
  arrays: PacketArrays,
  limits: PacketLimits,
): { ok: true; derived: DerivedMetadata } | PacketFailure {
  try {
    return { ok: true, derived: validatePacket({ manifest, ...arrays }, limits) };
  } catch (e) {
    return failure(e);
  }
}

/** C3.0 geometry record of a validated packet (production codec). Fresh bytes. */
export const encodeRecord = (manifest: PacketManifest, arrays: PacketArrays): Uint8Array =>
  encode({ manifest, ...arrays });

/** C3.0 decode with caps before allocation (production codec); fresh whole-buffer arrays. */
export function decodeRecord(
  bytes: Uint8Array,
  limits: PacketLimits,
): { ok: true; packet: IncomingPacket } | PacketFailure {
  try {
    return { ok: true, packet: decode(bytes, limits) };
  } catch (e) {
    return failure(e);
  }
}

/** `M_mem` (C3.2): the sum of the six section byte lengths. */
export const packetMemBytes = (m: Pick<PacketManifest, "pathCount" | "verbCount" | "coordCount">) =>
  m.verbCount + 8 * m.coordCount + 16 * m.pathCount + 8;
