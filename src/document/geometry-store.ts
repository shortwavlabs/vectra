// GeometryStore (contract C2): privately owns every committed chunk's buffers.
// commit = shape check → move (detaching transfer) → validate the owned bytes via the port →
// publish. No API returns a committed ArrayBuffer or a view over one; jobCopy/renderCopy are
// the only routes to a transfer list and always return fresh buffers.

import { canonicalJsonBytes } from "../persistence/canonical-json.ts";
import { type ChunkId, DocumentError, MAX_CHUNK_NUMBER } from "./model.ts";
import {
  DEFAULT_PACKET_LIMITS,
  type DerivedMetadata,
  type IncomingPacket,
  type PacketArrays,
  type PacketLimits,
  type PacketManifest,
  type PacketPort,
  SECTION_KEYS,
  type TransferPacket,
  packetMemBytes,
} from "./packet-port.ts";

export type OwnerKind = "document" | "snapshot" | "job" | "history";
/** Attribution precedence for bytes() (C3.2): document > snapshot > job > history. */
export const OWNER_KINDS: readonly OwnerKind[] = ["document", "snapshot", "job", "history"];
export interface OwnerRef {
  readonly kind: OwnerKind;
}

/** Read-only chunk accessors (C2 rule 6): element reads, counts and iteration only. */
export interface ChunkView {
  readonly id: ChunkId;
  readonly manifest: Readonly<PacketManifest>; // deep-frozen plain data
  readonly pathCount: number;
  readonly verbCount: number;
  readonly coordCount: number;
  verb(i: number): number;
  coord(i: number): number;
  verbOffset(i: number): number;
  coordOffset(i: number): number;
  styleIndex(i: number): number;
  groupIndex(i: number): number;
  /** Commands of one path as plain values: `{ verb, coords }`. */
  commands(pathIndex: number): Generator<{ verb: number; coords: number[] }>;
}

/** Read-only view of the C3 derived metadata; no typed array leaves the store. */
export interface DerivedView {
  readonly anchors: number;
  readonly pathCount: number;
  readonly subpathCount: number;
  pathAnchors(i: number): number;
  subpathStart(k: number): number;
  /** [minX, minY, maxX, maxY] of path i's control points. */
  bounds(i: number): [number, number, number, number];
}

export interface CommitTiming {
  moveMs: number;
  validateMs: number;
  publishMs: number;
}

interface Chunk {
  readonly id: ChunkId;
  readonly manifest: Readonly<PacketManifest>;
  arrays: PacketArrays | null; // null once freed
  derived: DerivedMetadata | null;
  readonly cost: number;
  readonly counts: Record<OwnerKind, number>;
  readonly view: ChunkView;
  readonly derivedView: DerivedView;
}

type ViewCtor = new (buffer: ArrayBuffer) => ArrayBufferView;
const VIEW_CTORS: Record<string, ViewCtor> = {
  "[object Int8Array]": Int8Array,
  "[object Uint8Array]": Uint8Array,
  "[object Uint8ClampedArray]": Uint8ClampedArray,
  "[object Int16Array]": Int16Array,
  "[object Uint16Array]": Uint16Array,
  "[object Int32Array]": Int32Array,
  "[object Uint32Array]": Uint32Array,
  "[object Float32Array]": Float32Array,
  "[object Float64Array]": Float64Array,
  "[object BigInt64Array]": BigInt64Array,
  "[object BigUint64Array]": BigUint64Array,
  "[object DataView]": DataView,
};
const tag = (v: unknown) => Object.prototype.toString.call(v);
// Intrinsic accessors: a subclass cannot override what the shape check reads (G-DOC review 9c).
const TypedArrayProto = Object.getPrototypeOf(Uint8Array.prototype) as object;
const intrinsic = (proto: object, key: PropertyKey) => {
  // Reflect.get with an explicit receiver runs the intrinsic getter on `v`, ignoring overrides.
  return (v: unknown): unknown => Reflect.get(proto, key, v);
};
const taTag = intrinsic(TypedArrayProto, Symbol.toStringTag);
const taBuffer = intrinsic(TypedArrayProto, "buffer");
const taByteOffset = intrinsic(TypedArrayProto, "byteOffset");
const taByteLength = intrinsic(TypedArrayProto, "byteLength");
const abByteLength = intrinsic(ArrayBuffer.prototype, "byteLength");
type BufferExt = ArrayBuffer & { resizable?: boolean; detached?: boolean };

/** C2 rule 1 over the six section values (each read once). Returns the reason, or null. */
function shapeProblem(views: readonly unknown[]): string | null {
  const seen = new Set<ArrayBufferLike>();
  for (let i = 0; i < views.length; i++) {
    const a = views[i];
    const key = SECTION_KEYS[i];
    const realTag = ArrayBuffer.isView(a) ? (taTag(a) as string | undefined) : undefined;
    if (realTag === undefined || !(`[object ${realTag}]` in VIEW_CTORS))
      return `${key} is not a typed array`;
    const buf = taBuffer(a) as BufferExt;
    if (tag(buf) !== "[object ArrayBuffer]") return `${key} views a SharedArrayBuffer`;
    if (buf.resizable === true) return `${key} views a resizable ArrayBuffer`;
    if (buf.detached === true) return `${key} views a detached ArrayBuffer`;
    if (taByteOffset(a) !== 0 || taByteLength(a) !== abByteLength(buf))
      return `${key} does not span its whole buffer`;
    if (seen.has(buf)) return `${key} shares a buffer with another section`;
    seen.add(buf);
  }
  return null;
}

function deepFreeze<T>(v: T): T {
  if (typeof v === "object" && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
}

const checkIndex = (i: number, n: number) => {
  if (!(Number.isInteger(i) && i >= 0 && i < n)) throw new RangeError(`index ${i} out of range`);
};

function makeViews(c: Omit<Chunk, "view" | "derivedView">): Pick<Chunk, "view" | "derivedView"> {
  const live = () => {
    if (!c.arrays || !c.derived) throw new DocumentError("unknown_chunk", `${c.id} was freed`);
    return { a: c.arrays, d: c.derived };
  };
  const read = (key: keyof PacketArrays) => (i: number) => {
    const arr = live().a[key];
    checkIndex(i, arr.length);
    return arr[i]!;
  };
  const m = c.manifest;
  const view: ChunkView = Object.freeze({
    id: c.id,
    manifest: m,
    pathCount: m.pathCount,
    verbCount: m.verbCount,
    coordCount: m.coordCount,
    verb: read("verbs"),
    coord: read("coords"),
    verbOffset: read("verbOffsets"),
    coordOffset: read("coordOffsets"),
    styleIndex: read("styleIndex"),
    groupIndex: read("groupIndex"),
    commands: function* (pathIndex: number) {
      checkIndex(pathIndex, m.pathCount);
      const { verbs, coords, verbOffsets, coordOffsets } = live().a;
      let ci = coordOffsets[pathIndex]!;
      for (let k = verbOffsets[pathIndex]!; k < verbOffsets[pathIndex + 1]!; k++) {
        const verb = verbs[k]!;
        const n = verb === 2 ? 6 : verb === 3 ? 0 : 2;
        yield { verb, coords: Array.from(coords.subarray(ci, ci + n)) };
        ci += n;
      }
    },
  });
  const derivedView: DerivedView = Object.freeze({
    anchors: c.derived!.anchors,
    pathCount: m.pathCount,
    subpathCount: c.derived!.subpathStart.length,
    pathAnchors: (i: number) => {
      const d = live().d.pathAnchors;
      checkIndex(i, d.length);
      return d[i]!;
    },
    subpathStart: (k: number) => {
      const d = live().d.subpathStart;
      checkIndex(k, d.length);
      return d[k]!;
    },
    bounds: (i: number): [number, number, number, number] => {
      const b = live().d.bounds;
      checkIndex(i, m.pathCount);
      return [b[4 * i]!, b[4 * i + 1]!, b[4 * i + 2]!, b[4 * i + 3]!];
    },
  });
  return { view, derivedView };
}

export class GeometryStore {
  readonly #port: PacketPort;
  readonly #limits: PacketLimits;
  readonly #chunks = new Map<ChunkId, Chunk>();
  readonly #pending = new Set<ChunkId>();
  #nextChunkId: number;
  /** Diagnostics: calls that allocate geometry (C2 rule 9 tests). */
  readonly stats = { commits: 0, jobCopies: 0, renderCopies: 0 };
  /** C9 "Store commit": per-step timings of the last successful commit. */
  lastCommitTiming: CommitTiming | null = null;

  constructor(port: PacketPort, o: { limits?: PacketLimits; nextChunkId?: number } = {}) {
    this.#port = port;
    this.#limits = o.limits ?? DEFAULT_PACKET_LIMITS;
    this.#nextChunkId = o.nextChunkId ?? 1;
    if (
      !(
        Number.isSafeInteger(this.#nextChunkId) &&
        this.#nextChunkId >= 1 &&
        this.#nextChunkId <= MAX_CHUNK_NUMBER + 1
      )
    )
      throw new DocumentError("invariant", "nextChunkId outside the chunk id space");
  }

  get nextChunkId(): number {
    return this.#nextChunkId;
  }

  /** Container load only: moves the high-water mark forward (never backwards, C1). */
  advanceChunkCounter(n: number): void {
    if (!Number.isSafeInteger(n) || n < this.#nextChunkId || n > MAX_CHUNK_NUMBER)
      throw new DocumentError(
        "invariant",
        `nextChunkId cannot move from ${this.#nextChunkId} to ${n}`,
      );
    this.#nextChunkId = n;
  }

  /** C2 commit sequence. Consumes `packet` from the move on, whether it succeeds or fails. */
  commit(packet: IncomingPacket): ChunkId {
    this.stats.commits++;
    const t0 = performance.now();
    if (typeof packet !== "object" || packet === null)
      throw new DocumentError("ownership", "packet is not an object");
    // Read each section once, so a getter cannot pass the check and then return another view.
    const views = SECTION_KEYS.map((k) => (packet as unknown as Record<string, unknown>)[k]);
    const problem = shapeProblem(views);
    if (problem) throw new DocumentError("ownership", problem);
    const ctors = views.map((v) => VIEW_CTORS[`[object ${taTag(v) as string}]`]!);
    const buffers = views.map((v) => taBuffer(v) as ArrayBuffer);
    let moved: ArrayBuffer[];
    try {
      moved = structuredClone(buffers, { transfer: buffers });
    } catch (e) {
      throw new DocumentError("ownership", `transfer failed: ${String(e)}`);
    }
    // The packet is consumed from here on.
    let manifest: PacketManifest;
    try {
      manifest = structuredClone(packet.manifest);
    } catch {
      throw new DocumentError("manifest", "manifest is not plain data");
    }
    const arrays = Object.fromEntries(
      SECTION_KEYS.map((k, i) => [k, new ctors[i]!(moved[i]!)]),
    ) as unknown as PacketArrays;
    const t1 = performance.now();
    const r = this.#port.validate(manifest, arrays, this.#limits);
    if (!r.ok) throw new DocumentError(r.code, r.message);
    const t2 = performance.now();
    if (this.#nextChunkId > MAX_CHUNK_NUMBER)
      throw new DocumentError("invariant", "the chunk id space is exhausted");
    const id = `chk_${this.#nextChunkId}`;
    const cost =
      packetMemBytes(manifest) +
      canonicalJsonBytes(manifest).length +
      36 * manifest.pathCount +
      4 * r.derived.subpathStart.length;
    const base = {
      id,
      manifest: deepFreeze(manifest),
      arrays,
      derived: r.derived,
      cost,
      counts: { document: 0, snapshot: 0, job: 0, history: 0 },
    };
    this.#chunks.set(id, Object.assign(base, makeViews(base)));
    this.#nextChunkId++;
    this.#pending.add(id); // freed at the next settle() unless an owner retains it
    this.lastCommitTiming = {
      moveMs: t1 - t0,
      validateMs: t2 - t1,
      publishMs: performance.now() - t2,
    };
    return id;
  }

  #get(id: ChunkId): Chunk {
    const c = this.#chunks.get(id);
    if (!c) throw new DocumentError("unknown_chunk", `no chunk ${String(id)}`);
    return c;
  }

  has(id: ChunkId): boolean {
    return this.#chunks.has(id);
  }
  chunkIds(): ChunkId[] {
    return [...this.#chunks.keys()];
  }
  view(id: ChunkId): ChunkView {
    return this.#get(id).view;
  }
  derived(id: ChunkId): DerivedView {
    return this.#get(id).derivedView;
  }
  /** C3.2 chunk ledger cost: M_mem + manifestBytes + D. */
  cost(id: ChunkId): number {
    return this.#get(id).cost;
  }

  #copy(ids: readonly ChunkId[]): { packets: TransferPacket[]; transfer: ArrayBuffer[] } {
    const packets: TransferPacket[] = [];
    const transfer: ArrayBuffer[] = [];
    for (const id of ids) {
      const a = this.#get(id).arrays!;
      const p = {
        manifest: this.#get(id).manifest as PacketManifest,
        verbs: a.verbs.slice(),
        coords: a.coords.slice(),
        verbOffsets: a.verbOffsets.slice(),
        coordOffsets: a.coordOffsets.slice(),
        styleIndex: a.styleIndex.slice(),
        groupIndex: a.groupIndex.slice(),
      };
      packets.push(p);
      for (const k of SECTION_KEYS) transfer.push(p[k].buffer as ArrayBuffer);
    }
    return { packets, transfer };
  }
  jobCopy(ids: readonly ChunkId[]) {
    this.stats.jobCopies++;
    return this.#copy(ids);
  }
  renderCopy(ids: readonly ChunkId[]) {
    this.stats.renderCopies++;
    return this.#copy(ids);
  }

  /** C3.0 geometry record of a chunk (fresh bytes), for the container serializer. */
  encodeRecord(id: ChunkId): Uint8Array {
    const c = this.#get(id);
    return this.#port.encodeRecord(c.manifest as PacketManifest, c.arrays!);
  }

  retain(id: ChunkId, owner: OwnerRef): void {
    this.#get(id).counts[owner.kind]++;
  }
  release(id: ChunkId, owner: OwnerRef): void {
    const c = this.#get(id);
    if (c.counts[owner.kind] <= 0)
      throw new DocumentError("invariant", `${id} has no ${owner.kind} owner`);
    c.counts[owner.kind]--;
    if (OWNER_KINDS.every((k) => c.counts[k] === 0)) this.#pending.add(id);
  }
  ownerCounts(id: ChunkId): Readonly<Record<OwnerKind, number>> {
    return { ...this.#get(id).counts };
  }

  /**
   * End of a transaction or job settle: frees every chunk whose counts are all zero (C2 rule 8;
   * also chunks committed in a failed transaction). Returns the freed IDs.
   */
  settle(): ChunkId[] {
    const freed: ChunkId[] = [];
    for (const id of this.#pending) {
      const c = this.#chunks.get(id);
      if (c && OWNER_KINDS.every((k) => c.counts[k] === 0)) {
        c.arrays = null;
        c.derived = null;
        this.#chunks.delete(id);
        freed.push(id);
      }
    }
    this.#pending.clear();
    return freed;
  }

  /**
   * C3.2 store aggregation: each live chunk counted once, attributed to its highest-precedence
   * owner. A chunk committed in the current transaction and not yet retained is attributed to
   * `document` (only document-bound commits create chunks); settle() frees it otherwise.
   */
  bytes(): { byOwnerKind: Record<OwnerKind, number>; total: number } {
    const byOwnerKind: Record<OwnerKind, number> = { document: 0, snapshot: 0, job: 0, history: 0 };
    let total = 0;
    for (const c of this.#chunks.values()) {
      total += c.cost;
      byOwnerKind[OWNER_KINDS.find((k) => c.counts[k] > 0) ?? "document"] += c.cost;
    }
    return { byOwnerKind, total };
  }

  /** True when no committed buffer has been detached or resized (TD-ARCH-005 tests). */
  checkIntegrity(): boolean {
    for (const c of this.#chunks.values()) {
      const a = c.arrays!;
      const m = c.manifest;
      const want = [
        m.verbCount,
        8 * m.coordCount,
        4 * (m.pathCount + 1),
        4 * (m.pathCount + 1),
        4 * m.pathCount,
        4 * m.pathCount,
      ];
      if (
        SECTION_KEYS.some(
          (k, i) => a[k].byteLength !== want[i] || (a[k].buffer as BufferExt).detached === true,
        )
      )
        return false;
    }
    return true;
  }
}

/** Diagnostics for explicit defensive copies (C2 rule 5). */
export const copyDiagnostics = { defensiveCopies: 0, bytes: 0 };

/** C2 rule 5: one fresh buffer per array, for callers whose arrays fail the shape check. */
export function copyIncoming(packet: IncomingPacket): IncomingPacket {
  const out: Record<string, unknown> = { manifest: structuredClone(packet.manifest) };
  let bytes = 0;
  for (const key of SECTION_KEYS) {
    const a = packet[key] as unknown;
    if (!ArrayBuffer.isView(a) || tag(a) === "[object DataView]")
      throw new DocumentError("ownership", `${key} is not a typed array`);
    const copy = (a as Uint8Array).slice();
    bytes += copy.byteLength;
    out[key] = copy;
  }
  copyDiagnostics.defensiveCopies++;
  copyDiagnostics.bytes += bytes;
  return out as unknown as IncomingPacket;
}

/** C2 startup check (fail closed): little-endian host and a detaching transfer. */
export function startupCheck(): { ok: boolean; littleEndian: boolean; detachingTransfer: boolean } {
  const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  let detachingTransfer = false;
  try {
    const probe = new ArrayBuffer(8);
    structuredClone(probe, { transfer: [probe] });
    detachingTransfer = probe.byteLength === 0;
  } catch {
    detachingTransfer = false;
  }
  return { ok: littleEndian && detachingTransfer, littleEndian, detachingTransfer };
}
