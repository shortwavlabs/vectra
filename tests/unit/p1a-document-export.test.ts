// P1-A integration proof (AM-1): P0 scene → GeometryPacket → document commit → .vectra
// save → strict load → effective draw list → Rust export bake → SVG/PDF.
// Unedited documents must reproduce the frozen P0 hashes (a4cf172.sha256); edited documents
// must export current document values, never the historical packet styles or provenance.
// The full regression corpus runs locally: scripts/document-export-regression.mjs.
import { readdirSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "vite-plus/test";
import * as wasm from "../../packages/vector-engine-wasm/pkg/vector_engine_wasm.js";
import type { LayerNode, PathNode } from "../../src/document/model.ts";
import {
  documentFromScene,
  type EngineWasm,
  saveLoadExport,
  sha256,
} from "./p1a-export-pipeline.ts";

const w = wasm as unknown as EngineWasm;
beforeAll(() => {
  wasm.initSync({
    module: readFileSync(
      new URL("../../packages/vector-engine-wasm/pkg/vector_engine_wasm_bg.wasm", import.meta.url),
    ),
  });
});

const frozen = new Map(
  readFileSync(
    new URL("../../docs/research/p0-r-geo/artifacts/regression/a4cf172.sha256", import.meta.url),
    "utf8",
  )
    .trim()
    .split("\n")
    .map((l) => {
      const [h, f] = l.split(/\s+/);
      return [f!, h!] as const;
    }),
);
// Procedural corpus scenes committed by both gates (native, frozen G-0 outputs).
const dirs = ["../../src/document/testing/fixtures/", "../fixtures/packet-determinism/"].map(
  (d) => new URL(d, import.meta.url),
);
const scenes = new Map<string, string>();
for (const d of dirs)
  for (const f of readdirSync(d))
    if (f.endsWith(".scene.json.raw"))
      scenes.set(f.slice(0, -".scene.json.raw".length), readFileSync(new URL(f, d), "utf8"));

describe("unedited documents reproduce the frozen P0 exports", () => {
  test("the committed corpus subset is frozen and covers the export cases", () => {
    expect(scenes.size).toBeGreaterThanOrEqual(12);
    for (const [c, text] of scenes) expect(sha256(text), c).toBe(frozen.get(`${c}.scene.json`));
    // halftone (clip + background), mosaic, limited, color, bw, transparent halftone
    expect([...scenes.keys()]).toEqual(
      expect.arrayContaining([
        "thin_strokes-halftone",
        "thin_strokes-halftone-transparent",
        "adjacent_colors-mosaic",
        "adjacent_colors-limited",
        "circle-bw",
      ]),
    );
  });

  for (const codec of ["none", "deflate-raw"] as const)
    for (const c of [...scenes.keys()].sort())
      test(`${c} (${codec})`, async () => {
        const out = await saveLoadExport(w, documentFromScene(w, scenes.get(c)!), codec);
        expect(out.job.form).toBe("original");
        expect(out.scene).toBe(scenes.get(c)); // byte-identical scene JSON
        expect(sha256(out.scene)).toBe(frozen.get(`${c}.scene.json`));
        expect(sha256(out.svg)).toBe(frozen.get(`${c}.svg`));
        expect(sha256(out.pdf)).toBe(frozen.get(`${c}.pdf`));
      });
});

const commitInput = ({ chunkId: _chunk, ...rest }: NonNullable<LayerNode["traceProvenance"]>) =>
  rest;
const pick = <T>(xs: Iterable<T>, f: (x: T) => boolean) => [...xs].find(f)!;
const paths = (s: ReturnType<typeof documentFromScene>) =>
  [...s.state.nodesById.values()].filter((n): n is PathNode => n.kind === "path");
const layerOf = (s: ReturnType<typeof documentFromScene>) =>
  s.state.nodesById.get(s.state.orderedRootIds[0]!) as LayerNode;
type SceneJson = {
  background: string | null;
  palette: { id: string; color: string }[];
  groups: {
    id: string;
    clip: unknown;
    paths: { fill: { color: string; paletteId: string | null } | null; coords: number[] }[];
  }[];
  metadata: { mode: string; params: { derivedFrom?: { edited: boolean }[] } };
};

describe("edited documents export current values (document form)", () => {
  test("recolouring a path overrides the packet style", async () => {
    const s = documentFromScene(w, scenes.get("adjacent_colors-color")!);
    s.dispatch({ type: "setFill", ids: [paths(s)[0]!.id], fill: { color: 0x123456ff } });
    const out = await saveLoadExport(w, s, "deflate-raw");
    const scene = JSON.parse(out.scene) as SceneJson;
    expect(out.job.form).toBe("document");
    expect(scene.groups[0]!.paths[0]!.fill).toEqual({ color: "#123456", paletteId: null });
    expect(scene.metadata.mode).toBe("document");
    expect(scene.metadata.params.derivedFrom![0]!.edited).toBe(true);
  });

  test("editing a palette entry recolours every path that references it", async () => {
    const s = documentFromScene(w, scenes.get("adjacent_colors-limited")!);
    const ref = [...s.state.paletteById.keys()][0]!;
    const name = s.state.paletteById.get(ref)!.name;
    s.dispatch({ type: "setPaletteColor", paletteRef: ref, color: 0xff00ffff });
    const scene = JSON.parse((await saveLoadExport(w, s, "none")).scene) as SceneJson;
    const entry = pick(scene.palette, (e) => e.id === name);
    expect(entry.color).toBe("#ff00ff");
    const refs = scene.groups.flatMap((g) => g.paths).filter((p) => p.fill?.paletteId === name);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.every((p) => p.fill!.color === "#ff00ff")).toBe(true);
  });

  test("a transform is baked into the coordinates in f64", async () => {
    const s = documentFromScene(w, scenes.get("circle-bw")!);
    const original = JSON.parse(scenes.get("circle-bw")!) as SceneJson;
    s.dispatch({ type: "setTransform", id: layerOf(s).id, matrix: [2, 0, 0, 2, 10, -5] });
    const scene = JSON.parse((await saveLoadExport(w, s, "deflate-raw")).scene) as SceneJson;
    const [x0, y0] = original.groups[0]!.paths[0]!.coords;
    const [x1, y1] = scene.groups[0]!.paths[0]!.coords;
    expect(x1).toBe(2 * x0! + 10);
    expect(y1).toBe(2 * y0! - 5);
  });

  test("a clip and visibility come from the document", async () => {
    const s = documentFromScene(w, scenes.get("circle-bw")!);
    s.dispatch({
      type: "setClip",
      id: layerOf(s).id,
      rect: { x: 10, y: 20, width: 100, height: 50 },
    });
    let scene = JSON.parse((await saveLoadExport(w, s, "none")).scene) as SceneJson;
    expect(scene.groups[0]!.clip).toEqual({ x: 10, y: 20, width: 100, height: 50 });
    s.dispatch({ type: "setVisible", ids: [paths(s)[0]!.id], visible: false });
    scene = JSON.parse((await saveLoadExport(w, s, "none")).scene) as SceneJson;
    expect(scene.groups.flatMap((g) => g.paths).length).toBe(paths(s).length - 1);
  });

  test("multiple layers export as one document with both traces", async () => {
    const s = documentFromScene(w, scenes.get("circle-bw")!);
    const other = documentFromScene(w, scenes.get("nested_rings-bw")!);
    // Re-trace the second scene into the first document.
    const p = wasm.sceneToPacket(scenes.get("nested_rings-bw")!);
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
    s.dispatch({
      type: "commitTrace",
      packet,
      provenance: commitInput(layerOf(other).traceProvenance!),
    });
    const out = await saveLoadExport(w, s, "deflate-raw");
    const scene = JSON.parse(out.scene) as SceneJson;
    expect(out.job.form).toBe("document");
    expect(scene.groups.map((g) => g.id)).toEqual(["bw", "run-1"]); // run ids stay unique
    expect(scene.metadata.params.derivedFrom!.map((d) => d.edited)).toEqual([false, false]);
    expect(new Set(scene.palette.map((e) => e.id)).size).toBe(scene.palette.length);
  });

  test("an empty group keeps its run in the export", async () => {
    const s = documentFromScene(w, scenes.get("circle-bw")!);
    s.dispatch({ type: "delete", ids: paths(s).map((n) => n.id) });
    const out = await saveLoadExport(w, s, "none");
    const scene = JSON.parse(out.scene) as SceneJson;
    expect(scene.groups).toEqual([expect.objectContaining({ id: "bw", paths: [] })]);
  });

  test("a halftone background follows the artboard in document form", async () => {
    const s = documentFromScene(w, scenes.get("thin_strokes-halftone")!);
    expect(JSON.parse((await saveLoadExport(w, s, "none")).scene).background).toBe(
      (JSON.parse(scenes.get("thin_strokes-halftone")!) as SceneJson).background,
    );
    const a = s.state.artboard;
    s.dispatch({ type: "setArtboard", width: a.width, height: a.height, background: 0x0000ffff });
    const out = await saveLoadExport(w, s, "none");
    expect(out.job.form).toBe("document");
    expect((JSON.parse(out.scene) as SceneJson).background).toBe("#0000ff");
  });
});
