// Document v1 ↔ the container's `document` section (C7): a plain JSON value, written as RFC 8785
// canonical JSON. The reader is a strict schema: unknown or missing fields are rejected, and
// semantic invariants are left to validateState (run by the session constructor on load).

import {
  type Artboard,
  type DocNode,
  type DocState,
  DOCUMENT_SCHEMA_VERSION,
  type Matrix,
  type PaletteEntry,
  type Rect,
  type SourceAsset,
  type SourceMime,
  type Style,
} from "../document/model.ts";

export class SchemaError extends Error {
  override name = "SchemaError";
  readonly version: boolean;
  constructor(message: string, version = false) {
    super(message);
    this.version = version;
  }
}

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

const COMMON = ["id", "kind", "name", "visible", "locked", "localTransform"];
const KIND_FIELDS = {
  layer: ["orderedChildIds"],
  group: ["orderedChildIds"],
  path: ["geometry", "styleRef", "fillRule"],
  source: ["assetId", "sourceToDocument"],
} as const;
const NODE_FIELDS = {
  layer: [...COMMON, ...KIND_FIELDS.layer],
  group: [...COMMON, ...KIND_FIELDS.group],
  path: [...COMMON, ...KIND_FIELDS.path],
  source: [...COMMON, ...KIND_FIELDS.source],
};

function parseNode(key: string, v: unknown): DocNode {
  const kind = (v as J | null)?.kind;
  if (kind !== "layer" && kind !== "group" && kind !== "path" && kind !== "source")
    return fail(`node ${key}: unknown kind ${String(kind)}`);
  const o = obj(v, `node ${key}`, NODE_FIELDS[kind], ["clipRef"]);
  const w = `node ${key}`;
  const base = {
    id: str(o.id, w),
    name: str(o.name, w),
    visible: bool(o.visible, w),
    locked: bool(o.locked, w),
    localTransform: matrix(o.localTransform, `${w}.localTransform`),
    ...(o.clipRef === undefined ? {} : { clipRef: rect(o.clipRef, `${w}.clipRef`) }),
  };
  if (kind === "layer" || kind === "group")
    return { ...base, kind, orderedChildIds: strArray(o.orderedChildIds, `${w}.orderedChildIds`) };
  if (kind === "path") {
    const g = obj(o.geometry, `${w}.geometry`, ["chunkId", "pathIndex"]);
    const fillRule =
      o.fillRule === "evenodd" || o.fillRule === "nonzero" ? o.fillRule : fail(`${w}: fillRule`);
    return {
      ...base,
      kind,
      geometry: { chunkId: str(g.chunkId, w), pathIndex: num(g.pathIndex, w) },
      styleRef: str(o.styleRef, w),
      fillRule,
    };
  }
  return {
    ...base,
    kind,
    assetId: str(o.assetId, w),
    sourceToDocument: matrix(o.sourceToDocument, `${w}.sourceToDocument`),
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
}

export function parseDocumentJson(v: unknown): ParsedDocument {
  const top = (v as J | null)?.documentSchemaVersion;
  if (top !== DOCUMENT_SCHEMA_VERSION)
    throw new SchemaError(`unsupported documentSchemaVersion ${String(top)}`, true);
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
  const stylesById = idMap(o.stylesById, "stylesById", (k, x): Style => {
    const s = obj(x, `style ${k}`, ["id", "fill", "paletteRef", "stroke"]);
    return {
      id: str(s.id, k),
      fill: nullable(s.fill, (y) => num(y, k)),
      paletteRef: nullable(s.paletteRef, (y) => str(y, k)),
      stroke: nullable(s.stroke, (y) => {
        const t = obj(y, `style ${k}.stroke`, ["color", "width"]);
        return { color: num(t.color, k), width: num(t.width, k) };
      }),
    };
  });
  const paletteById = idMap(o.paletteById, "paletteById", (k, x): PaletteEntry => {
    const p = obj(x, `palette ${k}`, ["id", "name", "color"]);
    return { id: str(p.id, k), name: str(p.name, k), color: num(p.color, k) };
  });
  const sourceAssetsById = idMap(o.sourceAssetsById, "sourceAssetsById", (k, x): SourceAsset => {
    const s = obj(x, `asset ${k}`, ["id", "digest", "mime", "width", "height", "embedded"]);
    return {
      id: str(s.id, k),
      digest: str(s.digest, k),
      mime: str(s.mime, k) as SourceMime,
      width: num(s.width, k),
      height: num(s.height, k),
      embedded: bool(s.embedded, k),
    };
  });
  return {
    state: {
      documentId: str(o.documentId, "documentId"),
      artboard,
      orderedRootIds: strArray(o.orderedRootIds, "orderedRootIds"),
      nodesById: idMap(o.nodesById, "nodesById", parseNode),
      stylesById,
      paletteById,
      sourceAssetsById,
    },
    nextId: posInt(o.nextId, "nextId"),
    nextChunkId: posInt(o.nextChunkId, "nextChunkId"),
  };
}

/** The canonical JSON value of a document state (optional members omitted when absent). */
export function documentJson(s: DocState, nextId: number, nextChunkId: number): J {
  const nodes: J = {};
  for (const [k, n] of s.nodesById) nodes[k] = { ...n, localTransform: [...n.localTransform] };
  return {
    documentSchemaVersion: DOCUMENT_SCHEMA_VERSION,
    documentId: s.documentId,
    nextId,
    nextChunkId,
    artboard: { ...s.artboard },
    orderedRootIds: [...s.orderedRootIds],
    nodesById: nodes,
    stylesById: Object.fromEntries(s.stylesById),
    paletteById: Object.fromEntries(s.paletteById),
    sourceAssetsById: Object.fromEntries(s.sourceAssetsById),
  };
}
