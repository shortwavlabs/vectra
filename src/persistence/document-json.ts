// Document ↔ the container's `document` section (C7): a plain JSON value, written as RFC 8785
// canonical JSON. Writers write documentSchemaVersion 2, the compact encoding (C10 r2, AM-3.2);
// readers accept 1 and 2. Each reader is a strict schema: unknown, missing or non-canonical
// members are rejected, and semantic invariants are left to validateState (run by the session
// constructor on load).
//
// v2 compact encoding, the rules (normative text: C10 r2):
// - an ID-keyed map entry omits `id`, which its key implies (nodes, styles, palette, assets);
// - a node omits `kind`, which its key prefix implies: lay → layer, grp → group, pth → path,
//   src → source. A key with any other prefix is rejected;
// - a node omits each member at its default, and a default is never written:
//   name "", visible true, locked false, localTransform [1,0,0,1,0,0] (by value);
// - a style omits each of fill, paletteRef and stroke when it is null, and null is never written;
// - everything else is as in v1.
// So every document has exactly one v2 encoding, and the reader rejects any other.

import {
  checkSourceProvenance,
  checkTraceProvenance,
  type DecodePolicy,
} from "../document/provenance.ts";
import {
  type Artboard,
  type DocNode,
  type DocState,
  DOCUMENT_SCHEMA_VERSION,
  freezeEntry,
  IDENTITY,
  MAX_CHUNK_NUMBER,
  sealMap,
  type Matrix,
  type PaletteEntry,
  type Rect,
  type SourceAsset,
  type SourceMime,
  type Style,
} from "../document/model.ts";
import { NodeMap } from "../document/node-map.ts";

export class SchemaError extends Error {
  override name = "SchemaError";
  readonly version: boolean;
  constructor(message: string, version = false) {
    super(message);
    this.version = version;
  }
}

/** The documentSchemaVersion values this build reads. It writes DOCUMENT_SCHEMA_VERSION (2). */
export const READ_SCHEMA_VERSIONS: ReadonlySet<unknown> = new Set([1, 2]);

type J = Record<string, unknown>;
const fail = (m: string): never => {
  throw new SchemaError(m);
};
function obj(
  v: unknown,
  where: string,
  required: readonly string[],
  optional: readonly string[] = [],
): J {
  if (typeof v !== "object" || v === null || Array.isArray(v))
    return fail(`${where}: expected an object`);
  const o = v as J;
  for (const k of required) if (!Object.hasOwn(o, k)) fail(`${where}: missing field ${k}`);
  for (const k of Object.keys(o))
    if (!required.includes(k) && !optional.includes(k)) fail(`${where}: unknown field ${k}`);
  return o;
}
const str = (v: unknown, where: string) =>
  typeof v === "string" ? v : fail(`${where}: expected a string`);
const num = (v: unknown, where: string) =>
  typeof v === "number" ? v : fail(`${where}: expected a number`);
const bool = (v: unknown, where: string) =>
  typeof v === "boolean" ? v : fail(`${where}: expected a boolean`);
const nullable = <T>(v: unknown, f: (v: unknown) => T): T | null => (v === null ? null : f(v));
const strArray = (v: unknown, where: string) =>
  Array.isArray(v)
    ? v.map((x, i) => str(x, `${where}[${i}]`))
    : fail(`${where}: expected an array`);
const matrix = (v: unknown, where: string): Matrix =>
  Array.isArray(v) && v.length === 6
    ? (v.map((x, i) => num(x, `${where}[${i}]`)) as unknown as Matrix)
    : fail(`${where}: expected 6 numbers`);
const rect = (v: unknown, where: string): Rect => {
  const r = obj(v, where, ["x", "y", "width", "height"]);
  return {
    x: num(r.x, where),
    y: num(r.y, where),
    width: num(r.width, where),
    height: num(r.height, where),
  };
};
/** Identity by value: `-0` cannot occur in canonical text, and equals 0 here anyway. */
const isIdentity = (m: Matrix) =>
  m === IDENTITY ||
  (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0);

const KIND_FIELDS = {
  layer: ["orderedChildIds"],
  group: ["orderedChildIds"],
  path: ["geometry", "styleRef", "fillRule"],
  source: ["assetId", "sourceToDocument"],
} as const;
type Kind = keyof typeof KIND_FIELDS;

/** The kind-specific part of a node, shared by both versions (`o` already checked by `obj`). */
function nodeOf(
  kind: Kind,
  w: string,
  o: J,
  common: Omit<DocNode, "kind" | "orderedChildIds">,
): DocNode {
  if (kind === "layer" && o.traceProvenance !== undefined)
    return {
      ...common,
      kind,
      orderedChildIds: strArray(o.orderedChildIds, `${w}.orderedChildIds`),
      traceProvenance: checkTraceProvenance(o.traceProvenance, `${w}.traceProvenance`),
    };
  if (kind === "layer" || kind === "group")
    return {
      ...common,
      kind,
      orderedChildIds: strArray(o.orderedChildIds, `${w}.orderedChildIds`),
    };
  if (kind === "path") {
    const g = obj(o.geometry, `${w}.geometry`, ["chunkId", "pathIndex"]);
    const fillRule =
      o.fillRule === "evenodd" || o.fillRule === "nonzero" ? o.fillRule : fail(`${w}: fillRule`);
    return {
      ...common,
      kind,
      geometry: { chunkId: str(g.chunkId, w), pathIndex: num(g.pathIndex, w) },
      styleRef: str(o.styleRef, w),
      fillRule,
    };
  }
  return {
    ...common,
    kind,
    assetId: str(o.assetId, w),
    sourceToDocument: matrix(o.sourceToDocument, `${w}.sourceToDocument`),
  };
}
const clipOf = (o: J, w: string) =>
  o.clipRef === undefined ? {} : { clipRef: rect(o.clipRef, `${w}.clipRef`) };

// --- v1 (C10 r1) --------------------------------------------------------------------------------
const COMMON_V1 = ["id", "kind", "name", "visible", "locked", "localTransform"];

function parseNodeV1(key: string, v: unknown): DocNode {
  const kind = (v as J | null)?.kind;
  if (kind !== "layer" && kind !== "group" && kind !== "path" && kind !== "source")
    return fail(`node ${key}: unknown kind ${String(kind)}`);
  const w = `node ${key}`;
  const o = obj(
    v,
    w,
    [...COMMON_V1, ...KIND_FIELDS[kind]],
    kind === "layer" ? ["clipRef", "traceProvenance"] : ["clipRef"],
  );
  return nodeOf(kind, w, o, {
    id: str(o.id, w),
    name: str(o.name, w),
    visible: bool(o.visible, w),
    locked: bool(o.locked, w),
    localTransform: matrix(o.localTransform, `${w}.localTransform`),
    ...clipOf(o, w),
  } as Omit<DocNode, "kind" | "orderedChildIds">);
}
const parseStyleV1 = (k: string, x: unknown): Style => {
  const s = obj(x, `style ${k}`, ["id", "fill", "paletteRef", "stroke"]);
  return {
    id: str(s.id, k),
    fill: nullable(s.fill, (y) => num(y, k)),
    paletteRef: nullable(s.paletteRef, (y) => str(y, k)),
    stroke: nullable(s.stroke, (y) => strokeOf(y, k)),
  };
};
const parsePaletteV1 = (k: string, x: unknown): PaletteEntry => {
  const p = obj(x, `palette ${k}`, ["id", "name", "color"]);
  return { id: str(p.id, k), name: str(p.name, k), color: num(p.color, k) };
};
const ASSET_FIELDS = ["digest", "mime", "width", "height", "embedded", "decodePolicy"];
const parseAssetV1 = (k: string, x: unknown): SourceAsset =>
  assetOf(k, obj(x, `asset ${k}`, ["id", ...ASSET_FIELDS], ["provenance"]), true);

// --- v2 (C10 r2) --------------------------------------------------------------------------------
const PREFIX_KIND: Readonly<Record<string, Kind>> = {
  lay: "layer",
  grp: "group",
  pth: "path",
  src: "source",
};
const COMMON_V2 = ["name", "visible", "locked", "localTransform", "clipRef"];

function parseNodeV2(key: string, v: unknown): DocNode {
  const w = `node ${key}`;
  const kind = key.charAt(3) === "_" ? PREFIX_KIND[key.slice(0, 3)] : undefined;
  if (!kind) return fail(`${w}: the key has no node kind prefix (lay_, grp_, pth_, src_)`);
  const o = obj(
    v,
    w,
    KIND_FIELDS[kind],
    kind === "layer" ? [...COMMON_V2, "traceProvenance"] : COMMON_V2,
  );
  const atDefault = (m: string) => fail(`${w}: ${m} is written at its default (non-canonical)`);
  const name = o.name === undefined ? "" : str(o.name, w);
  if (o.name !== undefined && name === "") atDefault("name");
  const visible = o.visible === undefined ? true : bool(o.visible, w);
  if (o.visible !== undefined && visible) atDefault("visible");
  const locked = o.locked === undefined ? false : bool(o.locked, w);
  if (o.locked !== undefined && !locked) atDefault("locked");
  const localTransform =
    o.localTransform === undefined ? IDENTITY : matrix(o.localTransform, `${w}.localTransform`);
  if (o.localTransform !== undefined && isIdentity(localTransform)) atDefault("localTransform");
  return nodeOf(kind, w, o, {
    id: key,
    name,
    visible,
    locked,
    localTransform,
    ...clipOf(o, w),
  } as Omit<DocNode, "kind" | "orderedChildIds">);
}
const parseStyleV2 = (k: string, x: unknown): Style => {
  // An absent member is null; a written member is never null (num/str/strokeOf refuse null).
  const s = obj(x, `style ${k}`, [], ["fill", "paletteRef", "stroke"]);
  return {
    id: k,
    fill: s.fill === undefined ? null : num(s.fill, k),
    paletteRef: s.paletteRef === undefined ? null : str(s.paletteRef, k),
    stroke: s.stroke === undefined ? null : strokeOf(s.stroke, k),
  };
};
const parsePaletteV2 = (k: string, x: unknown): PaletteEntry => {
  const p = obj(x, `palette ${k}`, ["name", "color"]);
  return { id: k, name: str(p.name, k), color: num(p.color, k) };
};
const parseAssetV2 = (k: string, x: unknown): SourceAsset =>
  assetOf(k, obj(x, `asset ${k}`, ASSET_FIELDS, ["provenance"]), false);

// --- shared -------------------------------------------------------------------------------------
function strokeOf(y: unknown, k: string) {
  const t = obj(y, `style ${k}.stroke`, ["color", "width"]);
  return { color: num(t.color, k), width: num(t.width, k) };
}
function assetOf(k: string, s: J, withId: boolean): SourceAsset {
  return {
    id: withId ? str(s.id, k) : k,
    digest: str(s.digest, k),
    mime: str(s.mime, k) as SourceMime,
    width: num(s.width, k),
    height: num(s.height, k),
    embedded: bool(s.embedded, k),
    decodePolicy: str(s.decodePolicy, k) as DecodePolicy,
    ...(s.provenance === undefined
      ? {}
      : { provenance: checkSourceProvenance(s.provenance, `asset ${k}.provenance`) }),
  };
}
function idMap<T extends { id: string }>(
  v: unknown,
  where: string,
  parse: (k: string, v: unknown) => T,
) {
  if (typeof v !== "object" || v === null || Array.isArray(v))
    return fail(`${where}: expected an object`);
  return new Map(Object.entries(v).map(([k, x]) => [k, parse(k, x)] as const));
}

export interface ParsedDocument {
  state: DocState;
  nextId: number;
  nextChunkId: number;
  /** The documentSchemaVersion it was read from (1 or 2). */
  version: 1 | 2;
}

/** Freezes every entry; the node map then becomes a NodeMap (G-DOC-R stage D). */
const sealFrozenEntries = <K, V extends object>(m: ReadonlyMap<K, V>) => {
  for (const v of m.values()) freezeEntry(v);
  return m;
};
const sealFrozen = <K, V extends object>(m: ReadonlyMap<K, V>) => {
  for (const v of m.values()) freezeEntry(v);
  return sealMap(m);
};

const READERS = {
  1: { node: parseNodeV1, style: parseStyleV1, palette: parsePaletteV1, asset: parseAssetV1 },
  2: { node: parseNodeV2, style: parseStyleV2, palette: parsePaletteV2, asset: parseAssetV2 },
} as const;

export function parseDocumentJson(v: unknown): ParsedDocument {
  const top = (v as J | null)?.documentSchemaVersion;
  if (!READ_SCHEMA_VERSIONS.has(top))
    throw new SchemaError(`unsupported documentSchemaVersion ${String(top)}`, true);
  const version = top as 1 | 2;
  const read = READERS[version];
  const o = obj(v, "document", [
    "documentSchemaVersion",
    "documentId",
    "nextId",
    "nextChunkId",
    "artboard",
    "orderedRootIds",
    "nodesById",
    "stylesById",
    "paletteById",
    "sourceAssetsById",
  ]);
  const posInt = (x: unknown, w: string) =>
    Number.isSafeInteger(x) && (x as number) > 0
      ? (x as number)
      : fail(`${w}: expected a positive safe integer`);
  const a = obj(o.artboard, "artboard", ["width", "height", "background"]);
  const artboard: Artboard = {
    width: num(a.width, "artboard"),
    height: num(a.height, "artboard"),
    background: nullable(a.background, (x) => num(x, "artboard.background")),
  };
  const stylesById = idMap(o.stylesById, "stylesById", read.style);
  const paletteById = idMap(o.paletteById, "paletteById", read.palette);
  const sourceAssetsById = idMap(o.sourceAssetsById, "sourceAssetsById", read.asset);
  const nodesById = idMap(o.nodesById, "nodesById", read.node);
  const nextChunkId = posInt(o.nextChunkId, "nextChunkId");
  // A chunk id must stay writable as a 15-digit section id (C1, C7; G-DOC review 5).
  if (nextChunkId > MAX_CHUNK_NUMBER + 1) fail("nextChunkId exceeds the chunk id space");
  // C10: a provenance chunk reference may be historical, but is always below nextChunkId.
  for (const [k, n] of nodesById)
    if (
      n.kind === "layer" &&
      n.traceProvenance &&
      Number(n.traceProvenance.chunkId.slice(4)) >= nextChunkId
    )
      fail(`node ${k}: traceProvenance.chunkId is not below nextChunkId`);
  return {
    state: Object.freeze({
      documentId: str(o.documentId, "documentId"),
      artboard: freezeEntry({ ...artboard }),
      orderedRootIds: Object.freeze(strArray(o.orderedRootIds, "orderedRootIds")),
      nodesById: NodeMap.from(sealFrozenEntries(nodesById)),
      stylesById: sealFrozen(stylesById),
      paletteById: sealFrozen(paletteById),
      sourceAssetsById: sealFrozen(sourceAssetsById),
    }),
    nextId: posInt(o.nextId, "nextId"),
    nextChunkId,
    version,
  };
}

// --- v2 writer ----------------------------------------------------------------------------------
// Each encoder copies only what it writes; values that are not written (or invalid ones) are
// left for validateState and the reader to refuse, never coerced.

/** A node's v2 value: no id or kind, defaults omitted. */
export function encodeNode(n: DocNode): J {
  const o: J = {};
  if (n.name !== "") o.name = n.name;
  if (n.visible !== true) o.visible = n.visible;
  if (n.locked !== false) o.locked = n.locked;
  if (!isIdentity(n.localTransform)) o.localTransform = n.localTransform;
  if (n.clipRef !== undefined) o.clipRef = n.clipRef;
  if (n.kind === "layer" || n.kind === "group") {
    o.orderedChildIds = n.orderedChildIds;
    if (n.kind === "layer" && n.traceProvenance !== undefined)
      o.traceProvenance = n.traceProvenance;
  } else if (n.kind === "path") {
    o.geometry = n.geometry;
    o.styleRef = n.styleRef;
    o.fillRule = n.fillRule;
  } else {
    o.assetId = n.assetId;
    o.sourceToDocument = n.sourceToDocument;
  }
  return o;
}
/** A style's v2 value: no id, null members omitted. */
export function encodeStyle(s: Style): J {
  const o: J = {};
  if (s.fill !== null) o.fill = s.fill;
  if (s.paletteRef !== null) o.paletteRef = s.paletteRef;
  if (s.stroke !== null) o.stroke = s.stroke;
  return o;
}
export const encodePalette = (p: PaletteEntry): J => ({ name: p.name, color: p.color });
export const encodeAsset = (a: SourceAsset): J => ({
  digest: a.digest,
  mime: a.mime,
  width: a.width,
  height: a.height,
  embedded: a.embedded,
  decodePolicy: a.decodePolicy,
  ...(a.provenance === undefined ? {} : { provenance: a.provenance }),
});
const encodeMap = <V>(m: ReadonlyMap<string, V>, enc: (v: V) => J): J => {
  const o: J = {};
  for (const [k, v] of m) o[k] = enc(v);
  return o;
};

/** The canonical JSON value of a document state: documentSchemaVersion 2, compact (C10 r2). */
export function documentJson(s: DocState, nextId: number, nextChunkId: number): J {
  return {
    documentSchemaVersion: DOCUMENT_SCHEMA_VERSION,
    documentId: s.documentId,
    nextId,
    nextChunkId,
    artboard: { ...s.artboard },
    orderedRootIds: s.orderedRootIds,
    nodesById: encodeMap(s.nodesById, encodeNode),
    stylesById: encodeMap(s.stylesById, encodeStyle),
    paletteById: encodeMap(s.paletteById, encodePalette),
    sourceAssetsById: encodeMap(s.sourceAssetsById, encodeAsset),
  };
}
