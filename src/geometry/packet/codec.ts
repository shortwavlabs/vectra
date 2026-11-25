// C3.0 byte serialisation of GeometryPacket v1: the packet block (little-endian sections at
// 8-byte-aligned offsets computed from the manifest counts, zero padding) and the geometry
// record used by `.vectra` geometry sections (u32 LE manifest length, canonical RFC 8785
// manifest JSON, zero padding to 8, block). Decoding returns fresh whole-buffer arrays, ready
// for GeometryStore.commit (C2 rule 1). Typed-array views assume a little-endian host, which
// the editor's startup check guarantees (C2).
import {
  type GeometryPacket,
  type Limits,
  type Manifest,
  MAX_MANIFEST_BYTES,
  PacketError,
  type PacketArrays,
  PRODUCT_LIMITS,
} from "./types.ts";
import { parseManifest } from "./validate.ts";

const align8 = (x: number) => x + ((8 - (x % 8)) % 8);

/** Section offsets and the block length B (C3.0). */
export function blockLayout(pathCount: number, verbCount: number, coordCount: number) {
  const lengths = [
    verbCount,
    8 * coordCount,
    4 * (pathCount + 1),
    4 * (pathCount + 1),
    4 * pathCount,
    4 * pathCount,
  ];
  const offsets: number[] = [];
  let at = 0;
  lengths.forEach((len, k) => {
    offsets.push(at);
    at += len;
    if (k < 5) at = align8(at);
  });
  return { offsets, lengths, block: align8(at) };
}

const SECTIONS = [
  "verbs",
  "coords",
  "verbOffsets",
  "coordOffsets",
  "styleIndex",
  "groupIndex",
] as const;

/** Encodes a packet whose arrays match its manifest (validate first). */
export function encodeBlock(p: GeometryPacket): Uint8Array<ArrayBuffer> {
  const m = p.manifest;
  const { offsets, block } = blockLayout(m.pathCount, m.verbCount, m.coordCount);
  const out = new Uint8Array(block);
  SECTIONS.forEach((k, i) => {
    const a = p[k];
    out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), offsets[i]);
  });
  return out;
}

/** Decodes a block. Steps 1–2 run on the manifest first (caps before allocation), then the
 *  block length (`length`) and padding (`padding`). Validate the result with validatePacket. */
export function decodeBlock(
  manifest: unknown,
  bytes: Uint8Array,
  limits: Limits = PRODUCT_LIMITS,
): GeometryPacket {
  const m = parseManifest(manifest, limits);
  const { offsets, lengths, block } = blockLayout(m.pathCount, m.verbCount, m.coordCount);
  if (bytes.length !== block)
    throw new PacketError(
      "length",
      `block is ${bytes.length} bytes, the manifest requires ${block}`,
    );
  let covered = 0;
  for (let k = 0; k <= 6; k++) {
    const end = k < 6 ? offsets[k]! : block;
    for (let i = covered; i < end; i++)
      if (bytes[i] !== 0) throw new PacketError("padding", "non-zero padding");
    if (k < 6) covered = offsets[k]! + lengths[k]!;
  }
  // slice() gives each section its own buffer starting at offset 0 (aligned, whole-buffer).
  const section = (k: number) =>
    bytes.slice(offsets[k]!, offsets[k]! + lengths[k]!).buffer as ArrayBuffer;
  const arrays: PacketArrays = {
    verbs: new Uint8Array(section(0)),
    coords: new Float64Array(section(1)),
    verbOffsets: new Uint32Array(section(2)),
    coordOffsets: new Uint32Array(section(3)),
    styleIndex: new Uint32Array(section(4)),
    groupIndex: new Uint32Array(section(5)),
  };
  return { manifest: m, ...arrays };
}

/** RFC 8785 (JCS) canonical JSON for manifests: sorted keys (UTF-16 code units), ECMAScript
 *  number formatting (so -0 is written as 0), no whitespace. Rejects non-finite numbers. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new PacketError("manifest", "non-finite number");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
  }
  throw new PacketError("manifest", `unsupported JSON value of type ${typeof v}`);
}

/** C3.0 geometry record: u32 LE Lm, canonical manifest JSON, zero padding to 8, block. */
export function encodeRecord(p: GeometryPacket): Uint8Array<ArrayBuffer> {
  const json = new TextEncoder().encode(canonicalJson(p.manifest));
  const head = align8(4 + json.length);
  const block = encodeBlock(p);
  const out = new Uint8Array(head + block.length);
  new DataView(out.buffer).setUint32(0, json.length, true);
  out.set(json, 4);
  out.set(block, head);
  return out;
}

export function decodeRecord(bytes: Uint8Array, limits: Limits = PRODUCT_LIMITS): GeometryPacket {
  if (bytes.length < 4) throw new PacketError("length", "record shorter than its header");
  const lm = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (lm > MAX_MANIFEST_BYTES) throw new PacketError("budget", `manifest of ${lm} bytes`);
  const head = align8(4 + lm);
  if (head > bytes.length) throw new PacketError("length", "record shorter than its manifest");
  let manifest: Manifest;
  try {
    manifest = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(4, 4 + lm)),
    );
  } catch {
    throw new PacketError("manifest", "manifest is not valid UTF-8 JSON");
  }
  for (let i = 4 + lm; i < head; i++)
    if (bytes[i] !== 0) throw new PacketError("padding", "non-zero padding after the manifest");
  return decodeBlock(manifest, bytes.subarray(head), limits);
}
