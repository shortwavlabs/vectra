// Generates the G-R0 renderer correctness fixtures (Node 24, type stripping):
//   node tests/browser/renderer/make-fixtures.ts <out-dir>
// For each fixture document: the `.vectra` container (base64, for the canvas), and the engine's
// SVG export of the same document (for the independent resvg reference). Unedited and edited
// documents cover compound paths and holes, nonzero/evenodd, paint order, translucency, palette
// references, transforms, clips, visibility and locking, empty groups, multiple layers and
// halftone backgrounds.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as wasm from "../../../packages/vector-engine-wasm/pkg/vector_engine_wasm.js";
import { GeometryStore } from "../../../src/document/geometry-store.ts";
import { createDocument, type LayerNode, type PathNode } from "../../../src/document/model.ts";
import { DocumentSession } from "../../../src/document/session.ts";
import { sceneProvenance } from "../../../src/document/testing/provenance.ts";
import { encodeScene } from "../../../src/document/testing/synthetic.ts";
import { CORRECTNESS_SCENE } from "../../../src/hit-test/testing/scenes.ts";
import {
  documentFromScene,
  type EngineWasm,
  saveLoadExport,
} from "../../unit/p1a-export-pipeline.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const out = resolve(process.argv[2] ?? join(ROOT, "tests/output/renderer-fixtures"));
mkdirSync(out, { recursive: true });
wasm.initSync({
  module: readFileSync(join(ROOT, "packages/vector-engine-wasm/pkg/vector_engine_wasm_bg.wasm")),
});
const w = wasm as unknown as EngineWasm;
const scene = (name: string) =>
  readFileSync(
    [
      join(ROOT, "src/document/testing/fixtures", `${name}.scene.json.raw`),
      join(ROOT, "tests/fixtures/packet-determinism", `${name}.scene.json.raw`),
    ].find((p) => {
      try {
        readFileSync(p);
        return true;
      } catch {
        return false;
      }
    })!,
    "utf8",
  );

function synthetic(): DocumentSession {
  const s = new DocumentSession(new GeometryStore(), {
    state: createDocument({
      documentId: "r0-correctness",
      width: CORRECTNESS_SCENE.width,
      height: CORRECTNESS_SCENE.height,
    }),
  });
  s.dispatch({
    type: "commitTrace",
    packet: encodeScene(CORRECTNESS_SCENE),
    provenance: sceneProvenance(CORRECTNESS_SCENE),
  });
  return s;
}
const paths = (s: DocumentSession) =>
  [...s.state.nodesById.values()].filter((n): n is PathNode => n.kind === "path");
const layer = (s: DocumentSession, k = 0) =>
  s.state.nodesById.get(
    s.state.orderedRootIds.filter((id) => s.state.nodesById.get(id)!.kind === "layer")[k]!,
  ) as LayerNode;

const fixtures: Record<string, () => DocumentSession> = {
  "synthetic-correctness": synthetic,
  "adjacent_colors-limited": () => documentFromScene(w, scene("adjacent_colors-limited")),
  "thin_strokes-halftone": () => documentFromScene(w, scene("thin_strokes-halftone")),
  "thin_strokes-halftone-transparent": () =>
    documentFromScene(w, scene("thin_strokes-halftone-transparent")),
  "logo_transparent_hole-mosaic": () => documentFromScene(w, scene("logo_transparent_hole-mosaic")),
  "nested_rings-color": () => documentFromScene(w, scene("nested_rings-color")),
  "edited-transform-clip": () => {
    const s = synthetic();
    const l = layer(s);
    s.dispatch({ type: "setTransform", id: l.id, matrix: [0.75, 0, 0, 0.75, 30, 18] });
    s.dispatch({ type: "setClip", id: l.id, rect: { x: 10, y: 10, width: 220, height: 160 } });
    return s;
  },
  "edited-styles-visibility": () => {
    const s = documentFromScene(w, scene("adjacent_colors-limited"));
    const ref = [...s.state.paletteById.keys()][0]!;
    s.dispatch({ type: "setPaletteColor", paletteRef: ref, color: 0xff00ff99 });
    const p = paths(s);
    s.dispatch({ type: "setFill", ids: [p[1]!.id], fill: { color: 0x1234ff80 } });
    s.dispatch({ type: "setVisible", ids: [p[2]!.id], visible: false });
    s.dispatch({ type: "setLocked", ids: [p[3]!.id], locked: true }); // drawn as before
    return s;
  },
  "multi-layer": () => {
    const s = documentFromScene(w, scene("circle-bw"));
    const p = w.sceneToPacket(scene("nested_rings-color"));
    const packet = {
      manifest: JSON.parse(p.manifestJson),
      verbs: p.takeVerbs(),
      coords: p.takeCoords(),
      verbOffsets: p.takeVerbOffsets(),
      coordOffsets: p.takeCoordOffsets(),
      styleIndex: p.takeStyleIndex(),
      groupIndex: p.takeGroupIndex(),
    };
    p.free();
    const ring = JSON.parse(scene("nested_rings-color"));
    const { chunkId: _c, ...prov } = { ...sceneProvenance(ring, "rings"), chunkId: "" };
    s.dispatch({ type: "commitTrace", packet, provenance: prov });
    const top = layer(s, 1);
    s.dispatch({ type: "setTransform", id: top.id, matrix: [0.5, 0, 0, 0.5, 20, 20] });
    return s;
  },
  "empty-group": () => {
    const s = synthetic();
    const clipped = [...s.state.nodesById.values()].find(
      (n) => n.kind === "group" && n.name === "clipped",
    )!;
    const kids = (clipped as unknown as { orderedChildIds: string[] }).orderedChildIds;
    s.dispatch({ type: "delete", ids: kids });
    return s;
  },
};

const manifest: Record<string, { width: number; height: number; svgBytes: number }> = {};
for (const [name, make] of Object.entries(fixtures)) {
  const s = make();
  const exported = await saveLoadExport(w, s, "none");
  writeFileSync(join(out, `${name}.svg`), exported.svg);
  writeFileSync(
    join(out, `${name}.vectra.b64`),
    Buffer.from(exported.container).toString("base64"),
  );
  manifest[name] = {
    width: s.state.artboard.width,
    height: s.state.artboard.height,
    svgBytes: exported.svg.length,
  };
}
writeFileSync(join(out, "fixtures.json"), JSON.stringify(manifest, null, 2));
console.log(`${Object.keys(manifest).length} renderer fixtures in ${out}`);
