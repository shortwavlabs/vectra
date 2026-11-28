// G-PRJ-0: compact canonical document encoding (C10 r2, documentSchemaVersion 2) and the strict
// v1 and v2 readers. The literal below is written by hand from the specification, so it checks
// the encoder independently of the encoder itself.
import { describe, expect, test } from "vite-plus/test";
import {
  createDocument,
  type DocNode,
  type DocState,
  IDENTITY,
  type PaletteEntry,
  sealMap,
  type SourceAsset,
  type Style,
} from "../document/model.ts";
import { NodeMap } from "../document/node-map.ts";
import { documentJsonV1 } from "../document/testing/document-json-v1.ts";
import { TEST_PROVENANCE } from "../document/testing/provenance.ts";
import { canonicalJson } from "./canonical-json.ts";
import { documentJson, parseDocumentJson, SchemaError } from "./document-json.ts";

const DIGEST = "ab".repeat(32);
const base = { name: "", visible: true, locked: false, localTransform: IDENTITY } as const;

/** Every node kind, defaults and non-defaults, a clip, value-identity transforms, every style
 *  shape, a palette entry and an asset with provenance. Built by hand, not by commands. */
function literalState(): DocState {
  const nodes: [string, DocNode][] = [
    [
      "lay_1",
      {
        ...base,
        id: "lay_1",
        kind: "layer",
        orderedChildIds: ["grp_2"],
        clipRef: { x: 0, y: 0, width: 10, height: 20 },
      },
    ],
    [
      "grp_2",
      {
        id: "grp_2",
        kind: "group",
        name: "Group é",
        visible: false,
        locked: true,
        localTransform: [2, 0, 0, 2, -1.5, 3],
        orderedChildIds: ["pth_3", "pth_4"],
      },
    ],
    [
      "pth_3",
      {
        ...base,
        localTransform: [1, 0, 0, 1, 0, 0], // equal to identity by value, another object
        id: "pth_3",
        kind: "path",
        geometry: { chunkId: "chk_1", pathIndex: 0 },
        styleRef: "sty_6",
        fillRule: "nonzero",
      },
    ],
    [
      "pth_4",
      {
        ...base,
        id: "pth_4",
        kind: "path",
        geometry: { chunkId: "chk_1", pathIndex: 1 },
        styleRef: "sty_7",
        fillRule: "evenodd",
      },
    ],
    [
      "src_5",
      {
        ...base,
        name: "photo",
        id: "src_5",
        kind: "source",
        assetId: "ast_9",
        sourceToDocument: [0.5, 0, 0, 0.5, 0, 0],
      },
    ],
  ];
  const styles: [string, Style][] = [
    ["sty_6", { id: "sty_6", fill: 0xff0000ff, paletteRef: null, stroke: null }],
    ["sty_7", { id: "sty_7", fill: null, paletteRef: "pal_8", stroke: { color: 255, width: 1.5 } }],
  ];
  const palette: [string, PaletteEntry][] = [
    ["pal_8", { id: "pal_8", name: "c0", color: 0xffffffff }],
  ];
  const assets: [string, SourceAsset][] = [
    [
      "ast_9",
      {
        id: "ast_9",
        digest: DIGEST,
        mime: "image/png",
        width: 4,
        height: 3,
        embedded: false,
        decodePolicy: "browser-canvas-v1",
        provenance: { kind: "local-file" },
      },
    ],
  ];
  return {
    ...createDocument({ documentId: "lit", width: 100, height: 50 }),
    orderedRootIds: ["lay_1", "src_5"],
    nodesById: NodeMap.from(nodes),
    stylesById: sealMap(new Map(styles)),
    paletteById: sealMap(new Map(palette)),
    sourceAssetsById: sealMap(new Map(assets)),
  };
}

const LITERAL =
  '{"artboard":{"background":null,"height":50,"width":100},"documentId":"lit",' +
  '"documentSchemaVersion":2,"nextChunkId":2,"nextId":10,"nodesById":{' +
  '"grp_2":{"localTransform":[2,0,0,2,-1.5,3],"locked":true,"name":"Group é",' +
  '"orderedChildIds":["pth_3","pth_4"],"visible":false},' +
  '"lay_1":{"clipRef":{"height":20,"width":10,"x":0,"y":0},"orderedChildIds":["grp_2"]},' +
  '"pth_3":{"fillRule":"nonzero","geometry":{"chunkId":"chk_1","pathIndex":0},"styleRef":"sty_6"},' +
  '"pth_4":{"fillRule":"evenodd","geometry":{"chunkId":"chk_1","pathIndex":1},"styleRef":"sty_7"},' +
  '"src_5":{"assetId":"ast_9","name":"photo","sourceToDocument":[0.5,0,0,0.5,0,0]}},' +
  '"orderedRootIds":["lay_1","src_5"],' +
  '"paletteById":{"pal_8":{"color":4294967295,"name":"c0"}},' +
  `"sourceAssetsById":{"ast_9":{"decodePolicy":"browser-canvas-v1","digest":"${DIGEST}",` +
  '"embedded":false,"height":3,"mime":"image/png","provenance":{"kind":"local-file"},"width":4}},' +
  '"stylesById":{"sty_6":{"fill":4278190335},' +
  '"sty_7":{"paletteRef":"pal_8","stroke":{"color":255,"width":1.5}}}}';

const parse = (text: string) => parseDocumentJson(JSON.parse(text));
/** The literal's JSON value with one edit applied. */
const edited = (edit: (d: Record<string, any>) => void) => {
  const d = JSON.parse(LITERAL) as Record<string, any>;
  edit(d);
  return d;
};
const schemaError = (v: unknown) => {
  try {
    parseDocumentJson(v);
  } catch (e) {
    return e instanceof SchemaError ? (e.version ? "version" : "schema") : `other:${String(e)}`;
  }
  return "accepted";
};

describe("C10 r2 compact encoding (documentSchemaVersion 2)", () => {
  test("the encoder writes exactly the hand-written specification literal", () => {
    expect(canonicalJson(documentJson(literalState(), 10, 2))).toBe(LITERAL);
  });

  test("the reader reconstructs ids, kinds and every default", () => {
    const { state, nextId, nextChunkId, version } = parse(LITERAL);
    expect([nextId, nextChunkId, version]).toEqual([10, 2, 2]);
    const n = (k: string) => state.nodesById.get(k)!;
    for (const k of ["lay_1", "grp_2", "pth_3", "pth_4", "src_5"]) expect(n(k).id).toBe(k);
    expect(["lay_1", "grp_2", "pth_3", "pth_4", "src_5"].map((k) => n(k).kind)).toEqual([
      "layer",
      "group",
      "path",
      "path",
      "source",
    ]);
    expect(n("lay_1")).toMatchObject({ name: "", visible: true, locked: false });
    expect(n("lay_1").localTransform).toBe(IDENTITY); // the shared constant
    expect(n("pth_3").localTransform).toBe(IDENTITY);
    expect(n("grp_2")).toMatchObject({ name: "Group é", visible: false, locked: true });
    expect(state.stylesById.get("sty_6")).toEqual({
      id: "sty_6",
      fill: 0xff0000ff,
      paletteRef: null,
      stroke: null,
    });
    expect(state.stylesById.get("sty_7")).toEqual({
      id: "sty_7",
      fill: null,
      paletteRef: "pal_8",
      stroke: { color: 255, width: 1.5 },
    });
    expect(state.paletteById.get("pal_8")).toEqual({ id: "pal_8", name: "c0", color: 0xffffffff });
    expect(state.sourceAssetsById.get("ast_9")!.id).toBe("ast_9");
  });

  test("one encoding per document: decode then encode reproduces the bytes", () => {
    const p = parse(LITERAL);
    expect(canonicalJson(documentJson(p.state, p.nextId, p.nextChunkId))).toBe(LITERAL);
  });

  test("semantically equal to the source state (checked through the independent v1 encoder)", () => {
    const s = literalState();
    const p = parse(LITERAL);
    expect(canonicalJson(documentJsonV1(p.state, 10, 2))).toBe(
      canonicalJson(documentJsonV1(s, 10, 2)),
    );
  });

  test("trace provenance, Unicode, escapes and numeric boundaries round-trip", () => {
    const s = literalState();
    const names = ["\u{1F600} \u{10FFFF}", 'q"u\\o\nte\u0000', "é".repeat(256)];
    const nodes = [...s.nodesById].map(([k, n]): [string, DocNode] => {
      if (k === "lay_1")
        return [k, { ...n, traceProvenance: { ...TEST_PROVENANCE, chunkId: "chk_1" } } as DocNode];
      if (k === "pth_4")
        return [k, { ...n, name: names[0]!, localTransform: [1e9, -1e9, 5e-324, 1, -0.1, 1e-7] }];
      if (k === "src_5") return [k, { ...n, name: names[1]! }];
      if (k === "grp_2") return [k, { ...n, name: names[2]! }];
      return [k, n];
    });
    const t: DocState = {
      ...s,
      artboard: { width: 16_384, height: 0.5, background: 0 },
      nodesById: NodeMap.from(nodes),
      paletteById: sealMap(new Map([["pal_8", { id: "pal_8", name: "Z-9_z", color: 0 }]])),
    };
    const text = canonicalJson(documentJson(t, 999_999_999_999_999, 1_000_000_000_000_000));
    const p = parse(text);
    expect(canonicalJson(documentJson(p.state, p.nextId, p.nextChunkId))).toBe(text);
    expect(canonicalJson(documentJsonV1(p.state, p.nextId, p.nextChunkId))).toBe(
      canonicalJson(documentJsonV1(t, 999_999_999_999_999, 1_000_000_000_000_000)),
    );
  });

  test("an explicitly written default, id or kind is rejected (no ambiguous encodings)", () => {
    const cases: [string, (d: Record<string, any>) => void][] = [
      ["node id", (d) => (d.nodesById.lay_1.id = "lay_1")],
      ["node kind", (d) => (d.nodesById.lay_1.kind = "layer")],
      ['name ""', (d) => (d.nodesById.lay_1.name = "")],
      ["visible true", (d) => (d.nodesById.lay_1.visible = true)],
      ["locked false", (d) => (d.nodesById.lay_1.locked = false)],
      ["identity transform", (d) => (d.nodesById.pth_3.localTransform = [1, 0, 0, 1, 0, 0])],
      ["style id", (d) => (d.stylesById.sty_6.id = "sty_6")],
      ["style null fill", (d) => (d.stylesById.sty_7.fill = null)],
      ["style null paletteRef", (d) => (d.stylesById.sty_6.paletteRef = null)],
      ["style null stroke", (d) => (d.stylesById.sty_6.stroke = null)],
      ["palette id", (d) => (d.paletteById.pal_8.id = "pal_8")],
      ["asset id", (d) => (d.sourceAssetsById.ast_9.id = "ast_9")],
    ];
    for (const [label, edit] of cases) expect(schemaError(edited(edit)), label).toBe("schema");
  });

  test("malformed v2 members are rejected", () => {
    const cases: [string, (d: Record<string, any>) => void][] = [
      ["unknown kind prefix", (d) => (d.nodesById.abc_11 = { orderedChildIds: [] })],
      ["key without prefix", (d) => (d.nodesById["11"] = { orderedChildIds: [] })],
      ["unknown member", (d) => (d.nodesById.pth_3.colour = 1)],
      ["layer member on a path", (d) => (d.nodesById.pth_3.orderedChildIds = [])],
      ["provenance on a group", (d) => (d.nodesById.grp_2.traceProvenance = {})],
      ["missing styleRef", (d) => delete d.nodesById.pth_3.styleRef],
      ["missing orderedChildIds", (d) => delete d.nodesById.lay_1.orderedChildIds],
      ["name not a string", (d) => (d.nodesById.grp_2.name = 7)],
      ["visible not a boolean", (d) => (d.nodesById.grp_2.visible = 0)],
      ["locked not a boolean", (d) => (d.nodesById.grp_2.locked = "true")],
      ["transform of 5 numbers", (d) => (d.nodesById.grp_2.localTransform = [1, 0, 0, 1, 0])],
      ["fillRule", (d) => (d.nodesById.pth_3.fillRule = "oddeven")],
      ["stroke shape", (d) => (d.stylesById.sty_7.stroke = { color: 1 })],
      ["palette missing name", (d) => delete d.paletteById.pal_8.name],
      ["asset missing digest", (d) => delete d.sourceAssetsById.ast_9.digest],
      ["missing top-level member", (d) => delete d.paletteById],
      ["unknown top-level member", (d) => (d.title = "x")],
    ];
    for (const [label, edit] of cases) expect(schemaError(edited(edit)), label).toBe("schema");
  });

  test("versions: 1 and 2 are read strictly, anything else is a version refusal", () => {
    const v1 = documentJsonV1(literalState(), 10, 2);
    expect(parseDocumentJson(v1).version).toBe(1);
    // v1 shapes in a v2 document, and v2 shapes in a v1 document, are refused.
    expect(schemaError({ ...v1, documentSchemaVersion: 2 })).toBe("schema");
    expect(schemaError(edited((d) => (d.documentSchemaVersion = 1)))).toBe("schema");
    for (const v of [0, 3, "2", null, undefined])
      expect(schemaError(edited((d) => (d.documentSchemaVersion = v))), String(v)).toBe("version");
  });
});
