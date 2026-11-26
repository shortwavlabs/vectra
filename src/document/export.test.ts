// C10 export metadata semantics and the C8 export draw list (AM-1). The engine-side bake of
// these jobs is proved in the P1-A integration tests.
import { describe, expect, test } from "vite-plus/test";
import { buildExport } from "./export.ts";
import type { LayerNode, PathNode } from "./model.ts";
import { FIXTURE_SCENES, fixturePacket } from "./testing/fixtures.ts";
import { fixtureProvenance, fixtureSession } from "./testing/helpers.ts";

const ENGINE = "9.9.9";
const firstLayer = (s: ReturnType<typeof fixtureSession>) =>
  s.state.nodesById.get(s.state.orderedRootIds[0]!) as LayerNode;
/** The first path in paint (document) order; the node map's iteration order is not paint
 *  order (stage D: deterministic bucket order). */
const firstPath = (s: ReturnType<typeof fixtureSession>): PathNode => {
  const st = s.state;
  const walk = (id: string): PathNode | undefined => {
    const n = st.nodesById.get(id)!;
    if (n.kind === "path") return n;
    if (n.kind === "layer" || n.kind === "group")
      for (const c of n.orderedChildIds) {
        const p = walk(c);
        if (p) return p;
      }
    return undefined;
  };
  for (const r of st.orderedRootIds) {
    const p = walk(r);
    if (p) return p;
  }
  throw new Error("no path");
};

describe("export metadata semantics (C10)", () => {
  for (const name of FIXTURE_SCENES.keys()) {
    test(`unedited single trace uses the original scene verbatim: ${name}`, () => {
      const session = fixtureSession([name]);
      const job = buildExport(session.state, session.store, ENGINE);
      const scene = FIXTURE_SCENES.get(name)!.scene;
      expect(job.form).toBe("original");
      expect(job.sceneMeta.background).toBe(scene.background);
      expect(job.sceneMeta.palette).toEqual(scene.palette);
      expect(job.sceneMeta.metadata).toEqual(scene.metadata);
      expect(job.drawList.runs.map((r) => r.id)).toEqual(scene.groups.map((g) => g.id));
      expect(job.drawList.runs.map((r) => r.clip)).toEqual(scene.groups.map((g) => g.clip));
      expect(job.drawList.items.length).toBe(scene.groups.reduce((n, g) => n + g.paths.length, 0));
      expect(job.drawList.items.every((it) => it.transform.join() === "1,0,0,1,0,0")).toBe(true);
    });
  }

  test("an edited trace exports in document form and never reuses the trace's metadata", () => {
    const session = fixtureSession(["adjacent_colors-color"]);
    session.dispatch({
      type: "setFill",
      ids: [firstPath(session).id],
      fill: { color: 0x123456ff },
    });
    const job = buildExport(session.state, session.store, ENGINE);
    expect(job.form).toBe("document");
    const md = job.sceneMeta.metadata as Record<string, unknown>;
    expect(md).toMatchObject({
      generator: "vectra",
      engineVersion: ENGINE,
      mode: "document",
      presetVersion: 0,
      seed: 0,
    });
    const params = md.params as { derivedFrom: { edited: boolean; mode: string }[] };
    expect(params.derivedFrom).toEqual([expect.objectContaining({ edited: true, mode: "color" })]);
    expect(job.drawList.items[0]!.fill).toBe(0x123456ff);
    expect(job.drawList.items[0]!.paletteId).toBeNull();
  });

  test("undoing the edit restores the original form (computed, not flagged)", () => {
    const session = fixtureSession(["circle-bw"]);
    session.dispatch({
      type: "setTransform",
      id: firstLayer(session).id,
      matrix: [2, 0, 0, 2, 0, 0],
    });
    expect(buildExport(session.state, session.store, ENGINE).form).toBe("document");
    session.undo();
    expect(buildExport(session.state, session.store, ENGINE).form).toBe("original");
  });

  test("palette edits flow into the export palette (document form)", () => {
    const session = fixtureSession(["adjacent_colors-limited"]);
    const [ref] = [...session.state.paletteById.keys()];
    session.dispatch({ type: "setPaletteColor", paletteRef: ref!, color: 0xff00ffff });
    const job = buildExport(session.state, session.store, ENGINE);
    expect(job.form).toBe("document");
    const entry = job.sceneMeta.palette.find((e) => e.color === "#ff00ff");
    expect(entry).toBeDefined();
    expect(
      job.drawList.items.some((it) => it.paletteId === entry!.id && it.fill === 0xff00ffff),
    ).toBe(true);
  });

  test("multiple traced layers export in document form with one derivedFrom entry each", () => {
    const session = fixtureSession(["circle-bw", "nested_rings-bw"]);
    const job = buildExport(session.state, session.store, ENGINE);
    expect(job.form).toBe("document");
    const params = (job.sceneMeta.metadata as { params: { derivedFrom: { edited: boolean }[] } })
      .params;
    expect(params.derivedFrom.map((d) => d.edited)).toEqual([false, false]);
    // Colliding palette names ("ink" twice) get distinct scene ids.
    const ids = job.sceneMeta.palette.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("hiding a layer leaves the other trace unedited; artboard changes force document form", () => {
    const session = fixtureSession(["circle-bw", "nested_rings-bw"]);
    const second = session.state.orderedRootIds[1]!;
    session.dispatch({ type: "setVisible", ids: [second], visible: false });
    expect(buildExport(session.state, session.store, ENGINE).form).toBe("original");
    session.dispatch({ type: "setArtboard", width: 300, height: 256 });
    expect(buildExport(session.state, session.store, ENGINE).form).toBe("document");
  });

  test("baked geometry exports in document form", () => {
    const session = fixtureSession(["circle-bw"]);
    const paths = [...session.state.nodesById.values()]
      .filter((n) => n.kind === "path")
      .map((n) => n.id);
    session.dispatch({ type: "bake", packet: fixturePacket("circle-bw"), targetIds: paths });
    expect(buildExport(session.state, session.store, ENGINE).form).toBe("document");
  });

  test("a clip added to the trace layer forces document form and appears on the run", () => {
    const session = fixtureSession(["circle-bw"]);
    session.dispatch({
      type: "setClip",
      id: firstLayer(session).id,
      rect: { x: 0, y: 0, width: 100, height: 100 },
    });
    const job = buildExport(session.state, session.store, ENGINE);
    expect(job.form).toBe("document");
    expect(job.drawList.runs[0]!.clip).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  test("a missing source asset does not change the export", () => {
    const session = fixtureSession(["circle-bw"]);
    expect(session.state.sourceAssetsById.size).toBe(0);
    expect(firstLayer(session).traceProvenance!.source.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(buildExport(session.state, session.store, ENGINE).form).toBe("original");
  });

  test("provenance is immutable and copied on duplicate", () => {
    const session = fixtureSession(["circle-bw"]);
    const layer = firstLayer(session);
    expect(Object.isFrozen(layer.traceProvenance)).toBe(true);
    expect(() => {
      (layer.traceProvenance as { seed: number }).seed = 7;
    }).toThrow();
    session.dispatch({ type: "duplicate", ids: [layer.id] });
    const copy = session.state.nodesById.get(session.state.orderedRootIds[1]!) as LayerNode;
    expect(copy.traceProvenance).toEqual(layer.traceProvenance);
    expect(buildExport(session.state, session.store, ENGINE).form).toBe("document");
  });

  test("commitTrace refuses missing or inconsistent provenance before consuming the packet", () => {
    const session = fixtureSession(["circle-bw"]);
    const p = fixturePacket("circle-bw");
    const bad = { ...fixtureProvenance("circle-bw"), seed: 99 };
    expect(() => session.dispatch({ type: "commitTrace", packet: p, provenance: bad })).toThrow(
      /seed/,
    );
    expect(p.coords.byteLength).toBeGreaterThan(0); // not consumed
  });
});
