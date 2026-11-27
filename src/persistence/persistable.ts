// G-PRJ-0, AM-3.3: exact persistable-size accounting over the complete container. The session
// keeps one number per state, `body`: the length of the v2 document section without the digits
// of the two high-water marks (nextId, nextChunkId), which live outside the state. A transaction
// updates it from its write log (bodyDelta), with no traversal of unchanged nodes; geometry and
// source sizes are summed from the state's chunk and asset maps, never from the document.
//
// Enforcement (persistProblem) charges each high-water mark at its maximum width, MARK_DIGITS,
// because the marks only grow and survive undo: a state accepted at the exact limit must still
// save after later edits widen the marks and the artist undoes back to it.
//
// Precondition for every function here: the state passed validateState (or the incremental
// proof). In particular every node, style, palette and asset key, and every child and root id,
// is a C1 id: plain ASCII that canonical JSON writes as the string in quotes.

import type { ChunkId, DocNode, DocState, SourceAsset } from "../document/model.ts";
import { changedKeys } from "../document/node-map.ts";
import { DEFAULT_PACKET_LIMITS } from "../document/packet-port.ts";
import { MAX_MANIFEST_BYTES } from "../geometry/packet/types.ts";
import { canonicalJsonBytes, canonicalLength, canonicalStringLength } from "./canonical-json.ts";
import {
  documentJson,
  encodeAsset,
  encodeNode,
  encodePalette,
  encodeStyle,
} from "./document-json.ts";
import { CONTAINER_LIMITS, MANIFEST } from "./limits.ts";

export interface PersistLimits {
  /** C7 document-section cap (64 MiB). */
  readonly maxDocumentBytes: number;
  /** C7 section count, manifest and document included (4,096). */
  readonly maxSections: number;
  /** C7 total declared uncompressed bytes: the profile's session budget (512 MiB). */
  readonly sessionBudget: number;
  /** C7 source-section cap (20 MiB). */
  readonly maxSourceBytes: number;
  /** C7 geometry-section cap: the C3.0 record within the default packet caps. */
  readonly maxGeometryBytes: number;
}
export const DEFAULT_PERSIST_LIMITS: Readonly<PersistLimits> = Object.freeze({
  maxDocumentBytes: CONTAINER_LIMITS.maxDocumentBytes,
  maxSections: CONTAINER_LIMITS.maxSections,
  sessionBudget: CONTAINER_LIMITS.sessionBudget,
  maxSourceBytes: CONTAINER_LIMITS.maxSourceBytes,
  maxGeometryBytes: DEFAULT_PACKET_LIMITS.maxBytes + MAX_MANIFEST_BYTES + 24,
});

/** Digits of the largest nextId and nextChunkId (C1: 15-digit numbers, so ≤ 10^15). */
export const MARK_DIGITS = 16;
export const MANIFEST_BYTES = canonicalJsonBytes(MANIFEST).length;

const commas = (n: number) => (n > 1 ? n - 1 : 0);
/** A JSON object of length `objLen` with one more member of length `memberLen`. */
const withMember = (objLen: number, memberLen: number) =>
  objLen === 2 ? 2 + memberLen : objLen + 1 + memberLen;
const keyed = (k: string, valueLen: number) => canonicalStringLength(k) + 1 + valueLen;
const CHILDREN = canonicalStringLength("orderedChildIds") + 1;
const PROVENANCE = canonicalStringLength("traceProvenance") + 1;

/** An array of C1 ids (precondition): each is written as the id in quotes. */
export function idArrayLength(ids: readonly string[]): number {
  let n = ids.length > 1 ? ids.length + 1 : 2;
  for (let i = 0; i < ids.length; i++) n += ids[i]!.length + 2;
  return n;
}

/** Trace provenance is immutable and shared by every state that keeps its layer; its length is
 *  computed once per record. Keys are weak: the memo never keeps a record or a state alive. */
const provenanceMemo = new WeakMap<object, number>();
function provenanceLength(p: object): number {
  let n = provenanceMemo.get(p);
  if (n === undefined) provenanceMemo.set(p, (n = canonicalLength(p)));
  return n;
}

/** The length of a node's v2 value. A container's child list and provenance are measured
 *  apart from the rest: one without regular expressions, the other once per record. */
export function nodeLength(n: DocNode): number {
  const o = encodeNode(n);
  if (n.kind !== "layer" && n.kind !== "group") return canonicalLength(o);
  let len = canonicalLength({ ...o, orderedChildIds: undefined, traceProvenance: undefined });
  len = withMember(len, CHILDREN + idArrayLength(n.orderedChildIds));
  if (n.kind === "layer" && n.traceProvenance !== undefined)
    len = withMember(len, PROVENANCE + provenanceLength(n.traceProvenance));
  return len;
}

/** `body` by full encoding: the v2 document section of `s`, minus the marks' digits. */
export const fullBody = (s: DocState): number => canonicalLength(documentJson(s, 0, 0)) - 2;

function mapDelta<V>(
  x: ReadonlyMap<string, V>,
  y: ReadonlyMap<string, V>,
  enc: (v: V) => Record<string, unknown>,
): number {
  if (x === y) return 0;
  let d = commas(y.size) - commas(x.size);
  for (const k of changedKeys(x, y)) {
    const a = x.get(k);
    const b = y.get(k);
    if (a !== undefined) d -= keyed(k, canonicalLength(enc(a)));
    if (b !== undefined) d += keyed(k, canonicalLength(enc(b)));
  }
  return d;
}

/**
 * body(b) − body(a). `writes` is the transaction's complete Draft write log (a superset of the
 * node keys whose entries differ), or null for an identity diff of the node map. Everything
 * outside the node map is compared by identity first: unchanged parts cost nothing.
 */
export function bodyDelta(a: DocState, b: DocState, writes: Iterable<string> | null): number {
  let d = 0;
  if (a.documentId !== b.documentId)
    d += canonicalStringLength(b.documentId) - canonicalStringLength(a.documentId);
  if (a.artboard !== b.artboard) d += canonicalLength(b.artboard) - canonicalLength(a.artboard);
  if (a.orderedRootIds !== b.orderedRootIds)
    d += idArrayLength(b.orderedRootIds) - idArrayLength(a.orderedRootIds);
  if (a.nodesById !== b.nodesById) {
    d += commas(b.nodesById.size) - commas(a.nodesById.size);
    for (const k of writes ?? changedKeys(a.nodesById, b.nodesById)) {
      const x = a.nodesById.get(k);
      const y = b.nodesById.get(k);
      if (x === y) continue; // a superset key
      if (x !== undefined) d -= keyed(k, nodeLength(x));
      if (y !== undefined) d += keyed(k, nodeLength(y));
    }
  }
  d += mapDelta(a.stylesById, b.stylesById, encodeStyle);
  d += mapDelta(a.paletteById, b.paletteById, encodePalette);
  d += mapDelta(a.sourceAssetsById, b.sourceAssetsById, encodeAsset);
  return d;
}

/** Sizes of the container a state would write (all exact, in bytes). */
export interface PersistInfo {
  /** The v2 document section without the marks' digits. */
  readonly body: number;
  /** The document section with the current marks. */
  readonly documentBytes: number;
  /** The document section with both marks at MARK_DIGITS: what enforcement charges. */
  readonly documentBound: number;
  readonly geometryBytes: number;
  /** Embedded sources only; non-embedded sources write no section. */
  readonly sourceBytes: number;
  /** Manifest, document, one per referenced chunk, one per embedded source. */
  readonly sections: number;
  /** Total declared uncompressed bytes with the current marks. */
  readonly totalBytes: number;
  /** Total with documentBound: what enforcement charges against the session budget. */
  readonly totalBound: number;
  /** The largest geometry record and its chunk, the largest embedded source and its asset. */
  readonly largestGeometry: { readonly id: ChunkId; readonly bytes: number } | null;
  readonly largestSource: { readonly id: string; readonly bytes: number } | null;
  /** Embedded assets whose bytes the session does not hold (the file could not be written). */
  readonly missingSources: readonly string[];
}

export function persistSizes(o: {
  body: number;
  nextId: number;
  nextChunkId: number;
  chunks: Iterable<ChunkId>;
  recordBytes: (id: ChunkId) => number;
  assets: Iterable<SourceAsset>;
  sourceBytes: (id: string) => number | undefined;
}): PersistInfo {
  let geometryBytes = 0;
  let chunkCount = 0;
  let largestGeometry: PersistInfo["largestGeometry"] = null;
  for (const id of o.chunks) {
    const n = o.recordBytes(id);
    geometryBytes += n;
    chunkCount++;
    if (!largestGeometry || n > largestGeometry.bytes) largestGeometry = { id, bytes: n };
  }
  let sourceBytes = 0;
  let embedded = 0;
  let largestSource: PersistInfo["largestSource"] = null;
  const missingSources: string[] = [];
  for (const a of o.assets) {
    if (!a.embedded) continue;
    embedded++;
    const n = o.sourceBytes(a.id);
    if (n === undefined) missingSources.push(a.id);
    else {
      sourceBytes += n;
      if (!largestSource || n > largestSource.bytes) largestSource = { id: a.id, bytes: n };
    }
  }
  const documentBytes = o.body + String(o.nextId).length + String(o.nextChunkId).length;
  const documentBound = o.body + 2 * MARK_DIGITS;
  const rest = MANIFEST_BYTES + geometryBytes + sourceBytes;
  return {
    body: o.body,
    documentBytes,
    documentBound,
    geometryBytes,
    sourceBytes,
    sections: 2 + chunkCount + embedded,
    totalBytes: rest + documentBytes,
    totalBound: rest + documentBound,
    largestGeometry,
    largestSource,
    missingSources,
  };
}

const fmt = (x: number) => x.toLocaleString("en-US");

/** The first persistence limit `i` exceeds, as an actionable message naming it; else null. */
export function persistProblem(i: PersistInfo, L: PersistLimits): string | null {
  if (i.missingSources.length)
    return `The embedded source ${i.missingSources[0]} has no image bytes in this session, so the project could not be saved`;
  if (i.documentBound > L.maxDocumentBytes)
    return `This change would make the document too complex to save: its document section would need ${fmt(i.documentBound)} bytes, and the document section cap is ${fmt(L.maxDocumentBytes)} bytes`;
  if (i.sections > L.maxSections)
    return `This change would need ${fmt(i.sections)} container sections, and the cap is ${fmt(L.maxSections)} (one per geometry chunk and embedded source, plus two)`;
  if (i.largestSource && i.largestSource.bytes > L.maxSourceBytes)
    return `The embedded source ${i.largestSource.id} is ${fmt(i.largestSource.bytes)} bytes, and the source section cap is ${fmt(L.maxSourceBytes)} bytes`;
  if (i.largestGeometry && i.largestGeometry.bytes > L.maxGeometryBytes)
    return `The geometry chunk ${i.largestGeometry.id} needs ${fmt(i.largestGeometry.bytes)} bytes, and the geometry section cap is ${fmt(L.maxGeometryBytes)} bytes`;
  if (i.totalBound > L.sessionBudget)
    return `This change would need ${fmt(i.totalBound)} uncompressed bytes in total, and the session budget cap is ${fmt(L.sessionBudget)} bytes`;
  return null;
}
