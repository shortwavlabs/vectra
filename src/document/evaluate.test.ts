import { describe, expect, test } from "vite-plus/test";
import { evaluate } from "./evaluate.ts";
import {
  type ContainerNode,
  type DocState,
  IDENTITY,
  type Matrix,
  rotate90Matrix,
} from "./model.ts";
import { FIXTURE_SCENES } from "./testing/fixtures.ts";
import { emptySession, fixtureSession } from "./testing/helpers.ts";
import { parseColor, syntheticPacket } from "./testing/synthetic.ts";

const kids = (s: DocState, id: string) => (s.nodesById.get(id) as ContainerNode).orderedChildIds;
const lastLayer = (s: DocState) => s.orderedRootIds[s.orderedRootIds.length - 1]!;

/** A layer with groups whose clips and transforms the tests set up. */
function clipDoc(groups = 3) {
  const session = emptySession({}, 1000, 1000);
  session.dispatch({
    type: "commitTrace",
    packet: syntheticPacket({ paths: groups * 2, anchorsPerPath: 3, groups }),
  });
  const layer = lastLayer(session.state);
  return { session, layer, groups: kids(session.state, layer) };
}

describe("unedited P0 route", () => {
  test("every fixture: runs equal the scene groups 1:1; the draw list equals the scene paths", () => {
    for (const [name, { scene }] of FIXTURE_SCENES) {
      const { runs, drawList } = evaluate(fixtureSession([name]).state);
      expect(
        runs.map((r) => r.id),
        name,
      ).toEqual(scene.groups.map((g) => g.id));
      expect(runs.map((r) => r.clip)).toEqual(
        scene.groups.map(
          (g) => g.clip && { x: g.clip.x, y: g.clip.y, w: g.clip.width, h: g.clip.height },
        ),
      );
      const paths = scene.groups.flatMap((g, gi) => g.paths.map((p) => ({ p, gi })));
      expect(drawList).toHaveLength(paths.length);
      drawList.forEach((item, i) => {
        const { p, gi } = paths[i]!;
        expect(item.pathIndex).toBe(i);
        expect(item.groupRun).toBe(gi);
        expect(item.transform).toEqual(IDENTITY);
        expect(item.fill).toBe(p.fill ? parseColor(p.fill.color) : null);
        expect(item.evenOdd).toBe(p.fillRule === "evenodd");
        expect(item.stroke).toBeUndefined();
      });
    }
  });

  test("multi-group packets, including empty groups, map to one run per group", () => {
    const session = emptySession({}, 1000, 1000);
    session.dispatch({
      type: "commitTrace",
      packet: syntheticPacket({ paths: 2, anchorsPerPath: 3, groups: 4 }),
    });
    const { runs, drawList } = evaluate(session.state);
    expect(runs.map((r) => r.id)).toEqual(["g0", "g1", "g2", "g3"]);
    expect(drawList.map((d) => d.groupRun)).toEqual([0, 2]); // g1 and g3 are empty runs
  });
});

describe("C8 rules 2–6: effective clips and runs", () => {
  test("nested clips intersect; the effective clip moves with the node, not with children", () => {
    const { session, layer, groups } = clipDoc();
    const g0 = groups[0]!;
    session.dispatch([
      { type: "setClip", id: layer, rect: { x: 0, y: 0, width: 500, height: 400 } },
      { type: "setClip", id: g0, rect: { x: 100, y: 50, width: 600, height: 100 } },
      {
        type: "applyTransform",
        ids: [kids(session.state, g0)[0]!],
        matrix: [1, 0, 0, 1, 300, 300],
      },
    ]);
    const { runs } = evaluate(session.state);
    expect(runs[0]!.clip).toEqual({ x: 100, y: 50, w: 400, h: 100 });
    expect(runs[1]!.clip).toEqual({ x: 0, y: 0, w: 500, h: 400 });
  });

  test("translated, scaled, reflected and 90°-rotated clips map through the composed transform", () => {
    const cases: [Matrix, { x: number; y: number; w: number; h: number }][] = [
      [[1, 0, 0, 1, 10, 20], { x: 10, y: 20, w: 100, h: 50 }],
      [[2, 0, 0, 3, 0, 0], { x: 0, y: 0, w: 200, h: 150 }],
      [[-1, 0, 0, 1, 0, 0], { x: -100, y: 0, w: 100, h: 50 }],
      [rotate90Matrix(1), { x: -50, y: 0, w: 50, h: 100 }],
      [rotate90Matrix(3), { x: 0, y: -100, w: 50, h: 100 }],
    ];
    for (const [m, want] of cases) {
      const { session, groups } = clipDoc(1);
      session.dispatch([
        { type: "setClip", id: groups[0]!, rect: { x: 0, y: 0, width: 100, height: 50 } },
        { type: "setTransform", id: groups[0]!, matrix: m },
      ]);
      const { runs, drawList } = evaluate(session.state);
      expect(runs[0]!.clip).toEqual(want);
      expect(drawList[0]!.transform).toEqual(m);
    }
  });

  test("an empty intersection fully clips the subtree: no items, no run", () => {
    const { session, layer, groups } = clipDoc();
    session.dispatch([
      { type: "setClip", id: layer, rect: { x: 0, y: 0, width: 100, height: 100 } },
      { type: "setClip", id: groups[1]!, rect: { x: 100, y: 0, width: 50, height: 50 } }, // touches the edge
    ]);
    const { runs, drawList } = evaluate(session.state);
    expect(runs.map((r) => r.id)).toEqual(["g0", "g2"]);
    expect(drawList).toHaveLength(4);
    expect(drawList.every((d) => d.groupRun === 0 || d.groupRun === 1)).toBe(true);
  });

  test("hidden nodes are omitted; a visible group with no visible paths yields one empty run", () => {
    const { session, groups } = clipDoc();
    session.dispatch([
      { type: "setVisible", ids: [groups[0]!], visible: false },
      { type: "setVisible", ids: kids(session.state, groups[1]!), visible: false },
    ]);
    const { runs, drawList } = evaluate(session.state);
    expect(runs.map((r) => r.id)).toEqual(["g1", "g2"]);
    expect(drawList.map((d) => d.groupRun)).toEqual([1, 1]);
  });

  test("a run is a maximal sequence of items with the same nearest container", () => {
    const session = emptySession({}, 1000, 1000);
    session.dispatch({
      type: "commitTrace",
      packet: syntheticPacket({ paths: 3, anchorsPerPath: 3, groups: 1 }),
    });
    const g = kids(session.state, lastLayer(session.state))[0]!;
    const [, b] = kids(session.state, g);
    session.dispatch({ type: "group", ids: [b!], name: "inner" });
    const { runs, drawList } = evaluate(session.state);
    expect(runs.map((r) => r.id)).toEqual(["g0", "inner", "run-2"]); // g0's name is already used
    expect(drawList.map((d) => d.groupRun)).toEqual([0, 1, 2]);
  });

  test("run ids: invalid or duplicate names fall back to run-<k>; collisions are disambiguated", () => {
    const { session, groups } = clipDoc();
    session.dispatch([
      { type: "rename", id: groups[0]!, name: "run-1" },
      { type: "rename", id: groups[1]!, name: "not valid!" },
      { type: "rename", id: groups[2]!, name: "run-1" },
    ]);
    expect(evaluate(session.state).runs.map((r) => r.id)).toEqual(["run-1", "run-1-1", "run-2"]);
  });

  test("palette recolour and literal fills give the effective colour", () => {
    const session = fixtureSession(["circle-bw"]);
    const pal = [...session.state.paletteById.keys()][0]!;
    session.dispatch({ type: "setPaletteColor", paletteRef: pal, color: 0x11223344 });
    expect(evaluate(session.state).drawList[0]!.fill).toBe(0x11223344);
    const path = kids(session.state, kids(session.state, lastLayer(session.state))[0]!)[0]!;
    session.dispatch({ type: "setFill", ids: [path], fill: null });
    expect(evaluate(session.state).drawList[0]!.fill).toBeNull();
  });

  test("ungroup leaves the evaluation unchanged", () => {
    const session = emptySession({}, 1000, 1000);
    session.dispatch({
      type: "commitTrace",
      packet: syntheticPacket({ paths: 4, anchorsPerPath: 3, groups: 2 }),
    });
    const g = kids(session.state, lastLayer(session.state))[0]!;
    session.dispatch({ type: "applyTransform", ids: [g], matrix: [2, 0, 0, 2, 3, 4] });
    const before = evaluate(session.state).drawList.map((d) => d.transform);
    session.dispatch({ type: "ungroup", id: g });
    expect(evaluate(session.state).drawList.map((d) => d.transform)).toEqual(before);
  });
});
