// `.vectra` container v1 (contract C7, RFC-002 §14): serializer and strict, atomic loader.
//
//   magic "VECTRA\0\x01" | u32 LE header length H | header JSON (canonical, H ≤ 1 MiB) | sections
//
// Section `offset`s are relative to the first byte after the header (absolute offsets would
// make the header length depend on itself). Sections are contiguous, in the fixed order
// manifest, document, geometry by chunk number, source by asset number, and the file ends at the
// last section. `sha256` is over the uncompressed bytes. Compressed bytes are not canonical.

import { MAX_MANIFEST_BYTES } from "../geometry/packet/types.ts";
import { GeometryStore } from "../document/geometry-store.ts";
import type { DocLimits } from "../document/invariants.ts";
import { type AssetId, type ChunkId, DocumentError, idNumber } from "../document/model.ts";
import { DEFAULT_PACKET_LIMITS, type PacketLimits, decodeRecord } from "../document/packet-port.ts";
import { DocumentSession, type HistoryLimits, sha256Hex } from "../document/session.ts";
import { IntakeError, sniffImage } from "../vectorization/intake.ts";
import { canonicalJsonBytes, parseCanonicalJson } from "./canonical-json.ts";
import {
  documentJson,
  parseDocumentJson,
  READ_SCHEMA_VERSIONS,
  SchemaError,
} from "./document-json.ts";
import { CONTAINER_LIMITS, MANIFEST } from "./limits.ts";
import { DEFAULT_PERSIST_LIMITS, persistProblem } from "./persistable.ts";

export { CONTAINER_LIMITS } from "./limits.ts";
export const MAGIC = Uint8Array.of(0x56, 0x45, 0x43, 0x54, 0x52, 0x41, 0x00, 0x01);
export const FORMAT_VERSION = 1;
export type Codec = "none" | "deflate-raw";
export type SectionKind = "manifest" | "document" | "geometry" | "source";

export type ContainerErrorCode =
  | "truncated"
  | "magic"
  | "header"
  | "version"
  | "section"
  | "codec"
  | "limit"
  | "inflate"
  | "sha256"
  | "manifest"
  | "document"
  | "packet"
  | "source";

export class ContainerError extends Error {
  override name = "ContainerError";
  readonly code: ContainerErrorCode;
  /** The underlying packet or document code, when there is one. */
  readonly detail: string | undefined;
  constructor(code: ContainerErrorCode, message: string, detail?: string) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

export interface SectionEntry {
  id: string;
  kind: SectionKind;
  codec: Codec;
  offset: number;
  length: number;
  uncompressedLength: number;
  sha256: string;
}
export interface ContainerHeader {
  formatVersion: 1;
  sections: SectionEntry[];
  /** Absolute file offset of the first section byte (12 + H). Not stored. */
  dataStart: number;
}

const fail = (code: ContainerErrorCode, message: string, detail?: string): never => {
  throw new ContainerError(code, message, detail);
};
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const exactKeys = (o: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
const isSize = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const SHA_RE = /^[0-9a-f]{64}$/;
const SECTION_RE = { geometry: /^chk_[0-9]{1,15}$/, source: /^ast_[0-9]{1,15}$/ };
const ENTRY_KEYS = ["id", "kind", "codec", "offset", "length", "uncompressedLength", "sha256"];

/** Parses and checks magic, header and the section table. Allocates nothing per section. */
export function readHeader(bytes: Uint8Array): ContainerHeader {
  if (bytes.length < 12) fail("truncated", "file shorter than the fixed header");
  if (!MAGIC.every((b, i) => bytes[i] === b)) fail("magic", "not a .vectra container");
  const H = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
  if (H > CONTAINER_LIMITS.maxHeaderBytes) fail("header", `header length ${H} exceeds 1 MiB`);
  if (12 + H > bytes.length) fail("truncated", "file ends inside the header");
  const parsed = parseCanonicalJson(bytes.subarray(12, 12 + H));
  if (!parsed || !isObj(parsed.value)) return fail("header", "header is not canonical JSON");
  const h = parsed.value;
  if (h.formatVersion !== FORMAT_VERSION)
    fail("version", `unsupported container formatVersion ${String(h.formatVersion)}`);
  if (!exactKeys(h, ["formatVersion", "sections"]) || !Array.isArray(h.sections))
    fail("header", "header must hold exactly formatVersion and sections");
  const raw = h.sections as unknown[];
  if (raw.length > CONTAINER_LIMITS.maxSections) fail("section", "more than 4,096 sections");
  const available = bytes.length - 12 - H;
  const ids = new Set<string>();
  let end = 0;
  let lastNumber = { geometry: -1, source: -1 };
  const sections = raw.map((e, i): SectionEntry => {
    if (!isObj(e) || !exactKeys(e, ENTRY_KEYS))
      return fail("section", `section ${i}: invalid entry`);
    const { id, kind, codec, offset, length, uncompressedLength, sha256 } = e;
    if (typeof id !== "string") return fail("section", `section ${i}: invalid id`);
    if (ids.has(id)) fail("section", `duplicate section id ${id}`);
    ids.add(id);
    if (kind !== "manifest" && kind !== "document" && kind !== "geometry" && kind !== "source")
      return fail("section", `section ${id}: unknown kind ${String(kind)}`);
    if (codec !== "none" && codec !== "deflate-raw")
      return fail("codec", `section ${id}: unknown codec ${String(codec)}`);
    if (!isSize(offset) || !isSize(length) || !isSize(uncompressedLength))
      return fail("section", `section ${id}: invalid sizes`);
    if (typeof sha256 !== "string" || !SHA_RE.test(sha256))
      return fail("section", `section ${id}: invalid sha256`);
    // Fixed order: manifest, document, geometry by chunk number, source by asset number.
    const fixed = i === 0 ? "manifest" : i === 1 ? "document" : null;
    if (fixed ? kind !== fixed || id !== fixed : kind === "manifest" || kind === "document")
      fail("section", `section ${i}: expected ${fixed ?? "geometry or source"}, got ${kind} ${id}`);
    if (kind === "geometry" || kind === "source") {
      if (!SECTION_RE[kind].test(id)) fail("section", `section ${id}: id does not match its kind`);
      if (kind === "geometry" && lastNumber.source >= 0) fail("section", "geometry after source");
      const n = idNumber(id);
      if (n <= lastNumber[kind]) fail("section", `section ${id}: not in ascending order`);
      lastNumber = { ...lastNumber, [kind]: n };
    }
    if (codec === "none" && length !== uncompressedLength)
      fail("section", `section ${id}: codec none with length != uncompressedLength`);
    if (offset !== end) fail("section", `section ${id}: overlaps, leaves a gap or is out of order`);
    end = offset + length;
    if (end > available) fail("truncated", `section ${id} extends past the end of the file`);
    return { id, kind, codec, offset, length, uncompressedLength, sha256 };
  });
  if (sections.length < 2) fail("section", "manifest and document sections are required");
  if (end !== available) fail("section", "trailing bytes after the last section");
  return { formatVersion: 1, sections, dataStart: 12 + H };
}

/** Declared sizes against the caps, before any section allocation. */
function checkLimits(h: ContainerHeader, packetLimits: PacketLimits, sessionBudget: number): void {
  let total = 0;
  const geometryCap = packetLimits.maxBytes + MAX_MANIFEST_BYTES + 24;
  for (const s of h.sections) {
    total += s.uncompressedLength;
    const cap =
      s.kind === "manifest"
        ? CONTAINER_LIMITS.maxManifestBytes
        : s.kind === "document"
          ? CONTAINER_LIMITS.maxDocumentBytes
          : s.kind === "source"
            ? CONTAINER_LIMITS.maxSourceBytes
            : geometryCap;
    if (s.uncompressedLength > cap)
      fail("limit", `section ${s.id} declares ${s.uncompressedLength} bytes (cap ${cap})`);
  }
  if (total > sessionBudget)
    fail("limit", `declared ${total} uncompressed bytes exceed the session budget`);
}

const INFLATE_CHUNK = 64 * 1024;

/** Streaming inflation into a buffer of exactly `expected` bytes; aborted past it (bombs). */
async function inflate(data: Uint8Array, expected: number, id: string): Promise<Uint8Array> {
  let pos = 0;
  const input = new ReadableStream<Uint8Array>(
    {
      pull(ctrl) {
        if (pos >= data.length) ctrl.close();
        else {
          ctrl.enqueue(data.subarray(pos, pos + INFLATE_CHUNK));
          pos += INFLATE_CHUNK;
        }
      },
    },
    { highWaterMark: 0 },
  );
  const reader = input
    .pipeThrough(
      new DecompressionStream("deflate-raw") as unknown as ReadableWritablePair<
        Uint8Array,
        Uint8Array
      >,
    )
    .getReader();
  const out = new Uint8Array(expected);
  let n = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.length > expected - n) {
        await reader.cancel().catch(() => {});
        fail("inflate", `section ${id} inflates beyond its uncompressedLength`);
      }
      out.set(value, n);
      n += value.length;
    }
  } catch (e) {
    if (e instanceof ContainerError) throw e;
    fail("inflate", `section ${id}: corrupt deflate stream (${String(e)})`);
  }
  if (n !== expected) fail("inflate", `section ${id} inflates to ${n} bytes, declared ${expected}`);
  return out;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(
      new CompressionStream("deflate-raw") as unknown as ReadableWritablePair<
        Uint8Array,
        Uint8Array
      >,
    );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Uncompressed bytes of one section, SHA-256 verified before anything parses them. With codec
 * `none` this is a view into `bytes`; consumers copy (decodeRecord slices fresh arrays).
 */
export async function readSection(
  bytes: Uint8Array,
  h: ContainerHeader,
  s: SectionEntry,
): Promise<Uint8Array> {
  const start = h.dataStart + s.offset;
  const stored = bytes.subarray(start, start + s.length);
  const data = s.codec === "none" ? stored : await inflate(stored, s.uncompressedLength, s.id);
  if ((await sha256Hex(data)) !== s.sha256) fail("sha256", `section ${s.id}: SHA-256 mismatch`);
  return data;
}

/** Checks the manifest and returns its documentSchemaVersion (1 or 2: both are read). */
function checkManifest(data: Uint8Array): number {
  const p = parseCanonicalJson(data);
  if (!p || !isObj(p.value)) return fail("manifest", "manifest section is not canonical JSON");
  const m = p.value;
  for (const k of ["formatVersion", "packetVersion"] as const)
    if (m[k] !== 1) fail("version", `unsupported ${k} ${String(m[k])}`);
  if (!READ_SCHEMA_VERSIONS.has(m.documentSchemaVersion))
    fail("version", `unsupported documentSchemaVersion ${String(m.documentSchemaVersion)}`);
  if (!exactKeys(m, Object.keys(MANIFEST)) || m.app !== "vectra")
    fail("manifest", "invalid manifest section");
  return m.documentSchemaVersion as number;
}

/** Packet failures: a newer packetVersion is a `version` refusal, anything else `packet`. */
const packetFail = (id: string, code: string, message: string): never =>
  code === "version"
    ? fail("version", `${id}: ${message}`)
    : fail("packet", `${id}: ${message}`, code);

export interface LoadOptions {
  packetLimits?: PacketLimits;
  limits?: DocLimits;
  history?: HistoryLimits;
  sessionBudget?: number;
}

const MIME_OF = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" } as const;

/**
 * Strict, atomic load: a new GeometryStore and DocumentSession are built off to the side and
 * returned only on success (the caller swaps them in). Any failure throws a ContainerError and
 * touches nothing that existed before the call.
 */
export async function loadContainer(bytes: Uint8Array, o: LoadOptions): Promise<DocumentSession> {
  const packetLimits = o.packetLimits ?? DEFAULT_PACKET_LIMITS;
  const h = readHeader(bytes);
  checkLimits(h, packetLimits, o.sessionBudget ?? CONTAINER_LIMITS.sessionBudget);
  const data: Uint8Array[] = [];
  for (const s of h.sections) data.push(await readSection(bytes, h, s));

  const manifestVersion = checkManifest(data[0]!);
  const docValue = parseCanonicalJson(data[1]!);
  if (!docValue) return fail("document", "document section is not canonical JSON");
  let parsed;
  try {
    parsed = parseDocumentJson(docValue.value);
  } catch (e) {
    if (e instanceof SchemaError) return fail(e.version ? "version" : "document", e.message);
    throw e;
  }
  if (parsed.version !== manifestVersion)
    fail(
      "manifest",
      `manifest documentSchemaVersion ${manifestVersion} differs from the document's ${parsed.version}`,
    );

  const store = new GeometryStore({ limits: packetLimits });
  const sources = new Map<AssetId, Uint8Array>();
  const sectionChunks: ChunkId[] = [];
  for (let i = 2; i < h.sections.length; i++) {
    const s = h.sections[i]!;
    if (s.kind === "geometry") {
      const r = decodeRecord(data[i]!, packetLimits);
      if (!r.ok) return packetFail(s.id, r.code, r.message);
      const n = idNumber(s.id);
      if (n >= parsed.nextChunkId)
        fail("document", `${s.id} is not below nextChunkId ${parsed.nextChunkId}`);
      if (n < store.nextChunkId) fail("section", `${s.id} is out of order or below chk_1`);
      store.advanceChunkCounter(n);
      try {
        store.commit(r.packet); // C2: the file → store trust boundary
      } catch (e) {
        if (e instanceof DocumentError) packetFail(s.id, e.code, e.message);
        throw e;
      }
      sectionChunks.push(s.id);
    } else {
      const asset = parsed.state.sourceAssetsById.get(s.id);
      if (!asset?.embedded) return fail("document", `source section ${s.id} has no embedded asset`);
      const src = data[i]!.slice(); // the session owns its source bytes
      try {
        const sniffed = sniffImage(src);
        if (
          MIME_OF[sniffed.format] !== asset.mime ||
          sniffed.width !== asset.width ||
          sniffed.height !== asset.height
        )
          fail("source", `${s.id}: bytes do not match the asset's type or dimensions`);
      } catch (e) {
        if (e instanceof IntakeError) fail("source", `${s.id}: ${e.message}`, e.code);
        throw e;
      }
      if ((await sha256Hex(src)) !== asset.digest) fail("source", `${s.id}: digest mismatch`);
      sources.set(s.id, src);
    }
  }
  for (const a of parsed.state.sourceAssetsById.values())
    if (a.embedded && !sources.has(a.id))
      fail("document", `embedded asset ${a.id} has no source section`);
  store.advanceChunkCounter(parsed.nextChunkId);

  let session: DocumentSession;
  try {
    session = new DocumentSession(store, {
      state: parsed.state,
      nextId: parsed.nextId,
      sources,
      // The session keeps every later state within what this loader accepts (AM-3.3).
      persistLimits: {
        ...DEFAULT_PERSIST_LIMITS,
        sessionBudget: o.sessionBudget ?? CONTAINER_LIMITS.sessionBudget,
      },
      ...(o.limits ? { limits: o.limits } : {}),
      ...(o.history ? { history: o.history } : {}),
    });
  } catch (e) {
    if (e instanceof DocumentError)
      return fail(e.code === "persist_limit" ? "limit" : "document", e.message, e.code);
    throw e;
  }
  // Every geometry section must be referenced (the constructor freed unreferenced chunks).
  for (const id of sectionChunks)
    if (!store.has(id)) fail("document", `geometry section ${id} is unreferenced`);
  return session;
}

const digestCache = new WeakMap<GeometryStore, Map<ChunkId, string>>();

/**
 * Serializes the session's current state and returns the container bytes. Section contents are
 * built synchronously from the immutable state, so edits during compression cannot change what
 * is saved.
 *
 * It does **not** mark anything saved (C7 r3, AM-3.4): serialization is not a save. The caller
 * marks the saved state (`session.markSaved(state)`) only after the bytes were written and
 * verified (G-PRJ-1), or after an explicit decision such as a confirmed download.
 *
 * Pre-flight (AM-3.3): the exact sizes from the session's accounting are checked against the
 * loader's limits before any section is serialized, hashed or compressed.
 */
export async function saveContainer(
  session: DocumentSession,
  o: { codec?: Codec } = {},
): Promise<Uint8Array> {
  const codec = o.codec ?? "deflate-raw";
  const state = session.state;
  const store = session.store;
  const info = session.persistInfo();
  const problem = persistProblem(info, DEFAULT_PERSIST_LIMITS);
  if (problem) fail("limit", problem);
  const byNumber = (a: string, b: string) => idNumber(a) - idNumber(b);
  const chunkIds = [...session.derivedOf(state)!.chunks.keys()].sort(byNumber);
  const embedded = [...state.sourceAssetsById.values()]
    .filter((a) => a.embedded)
    .map((a) => a.id)
    .sort(byNumber);
  const plain: { id: string; kind: SectionKind; data: Uint8Array }[] = [
    { id: "manifest", kind: "manifest", data: canonicalJsonBytes(MANIFEST) },
    {
      id: "document",
      kind: "document",
      data: canonicalJsonBytes(documentJson(state, session.nextId, store.nextChunkId)),
    },
    ...chunkIds.map((id) => ({ id, kind: "geometry" as const, data: store.encodeRecord(id) })),
    ...embedded.map((id) => {
      const data = session.sourceBytes(id);
      if (!data)
        throw new ContainerError("source", `embedded asset ${id} has no bytes in this session`);
      return { id, kind: "source" as const, data };
    }),
  ];
  // The accounting must describe exactly what was built: a mismatch is a defect, never a user
  // error, and nothing is written.
  const built = plain.reduce((t, s) => t + s.data.length, 0);
  if (
    plain[1]!.data.length !== info.documentBytes ||
    plain.length !== info.sections ||
    built !== info.totalBytes
  )
    throw new Error(
      `persistability accounting disagrees with serialization: document ${plain[1]!.data.length}/${info.documentBytes}, sections ${plain.length}/${info.sections}, total ${built}/${info.totalBytes}`,
    );
  let cache = digestCache.get(store);
  if (!cache) digestCache.set(store, (cache = new Map()));
  const entries: SectionEntry[] = [];
  const stored: Uint8Array[] = [];
  let offset = 0;
  for (const s of plain) {
    let sha = s.kind === "geometry" ? cache.get(s.id) : undefined; // chunks are immutable (C1)
    if (!sha) {
      sha = await sha256Hex(s.data);
      if (s.kind === "geometry") cache.set(s.id, sha);
    }
    const body = codec === "none" ? s.data : await deflate(s.data);
    entries.push({
      id: s.id,
      kind: s.kind,
      codec,
      offset,
      length: body.length,
      uncompressedLength: s.data.length,
      sha256: sha,
    });
    stored.push(body);
    offset += body.length;
  }
  const header = canonicalJsonBytes({ formatVersion: FORMAT_VERSION, sections: entries });
  // Never write a file the strict loader would refuse.
  if (entries.length > CONTAINER_LIMITS.maxSections) fail("limit", "more than 4,096 sections");
  if (header.length > CONTAINER_LIMITS.maxHeaderBytes) fail("limit", "header exceeds 1 MiB");
  checkLimits(
    { formatVersion: 1, sections: entries, dataStart: 0 },
    DEFAULT_PACKET_LIMITS,
    CONTAINER_LIMITS.sessionBudget,
  );
  const out = new Uint8Array(12 + header.length + offset);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(8, header.length, true);
  out.set(header, 12);
  let pos = 12 + header.length;
  for (const b of stored) {
    out.set(b, pos);
    pos += b.length;
  }
  return out; // AM-3.4: no markSaved here
}
