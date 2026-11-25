import { describe, expect, test } from "vite-plus/test";
import { fixtureSession } from "../document/testing/helpers.ts";
import { isContainer } from "../document/model.ts";
import type { DocumentSession } from "../document/session.ts";
import {
  fillTargets,
  isLocked,
  moveCommand,
  quarterTurnAbout,
  scalingAbout,
  selectionBounds,
  stepCommand,
  translation,
  uniformScale,
  worldBounds,
  worldMatrix,
  worldTransformCommands,
} from "./document.ts";

const twoLayers = () => fixtureSession(["adjacent_colors-limited", "circle-bw"]);
const roots = (s: DocumentSession) => s.state.orderedRootIds;
const firstPath = (s: DocumentSession, layer = 0) => {
  const l = s.state.nodesById.get(roots(s)[layer]!)! as { orderedChildIds: readonly string[] };
  const g = s.state.nodesById.get(l.orderedChildIds[0]!)! as { orderedChildIds: readonly string[] };
  return g.orderedChildIds[0]!;
};

describe("layers panel order (top-most first) maps to model paint order", () => {
  test("a display move becomes one reorder with the inverted index", () => {
    const s = twoLayers();
    const [a, b] = roots(s); // paint order: a below b; the panel shows [b, a]
    const cmd = moveCommand(s.state, a!, 1, 0);
    expect(cmd).toEqual({ type: "reorder", id: a, index: 1 });
    s.dispatch(cmd!);
    expect(roots(s)).toEqual([b, a]);
    expect(moveCommand(s.state, a!, 1, 0)).toBeNull(); // stale display index: no command
  });

  test("Move up/down step towards the top/bottom and stop at the ends", () => {
    const s = twoLayers();
    const [a, b] = roots(s);
    expect(stepCommand(s.state, b!, 1)).toBeNull();
    s.dispatch(stepCommand(s.state, a!, 1)!);
    expect(roots(s)).toEqual([b, a]);
    expect(stepCommand(s.state, b!, -1)).toBeNull();
  });
});

describe("world transforms", () => {
  test("a world translation moves a nested path by exactly that amount", () => {
    const s = twoLayers();
    const layer = roots(s)[0]!;
    s.dispatch(worldTransformCommands(s.state, [layer], scalingAbout(2, 0, 0)));
    const p = firstPath(s);
    const before = worldBounds(s.state, s.store, p)!;
    s.dispatch(worldTransformCommands(s.state, [p], translation(10, -4)));
    const after = worldBounds(s.state, s.store, p)!;
    expect(after.x - before.x).toBeCloseTo(10, 9);
    expect(after.y - before.y).toBeCloseTo(-4, 9);
    expect(after.width).toBeCloseTo(before.width, 9);
  });

  test("scaling about the centre keeps the centre; quarter turns are exact", () => {
    const s = twoLayers();
    const layer = roots(s)[1]!;
    const b = worldBounds(s.state, s.store, layer)!;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    s.dispatch(worldTransformCommands(s.state, [layer], scalingAbout(1.5, cx, cy)));
    const c = worldBounds(s.state, s.store, layer)!;
    expect(c.x + c.width / 2).toBeCloseTo(cx, 9);
    expect(c.width).toBeCloseTo(b.width * 1.5, 9);
    expect(uniformScale(worldMatrix(s.state, layer))).toBeCloseTo(1.5, 12);
    s.dispatch(worldTransformCommands(s.state, [layer], quarterTurnAbout(1, cx, cy)));
    const r = worldBounds(s.state, s.store, layer)!;
    expect(r.width).toBeCloseTo(c.height, 9);
  });

  test("a selected ancestor and descendant transform once", () => {
    const s = twoLayers();
    const layer = roots(s)[0]!;
    const p = firstPath(s);
    const before = worldBounds(s.state, s.store, p)!;
    s.dispatch(worldTransformCommands(s.state, [layer, p], translation(5, 0)));
    expect(worldBounds(s.state, s.store, p)!.x - before.x).toBeCloseTo(5, 9);
  });

  test("keyboard steps with one coalesce key form one undo entry (RFC §7)", () => {
    const s = twoLayers();
    const p = firstPath(s);
    const x0 = worldBounds(s.state, s.store, p)!.x;
    const entries = s.historyStates().past.length;
    for (let i = 0; i < 5; i++)
      s.dispatch(worldTransformCommands(s.state, [p], translation(1, 0)), {
        coalesceKey: `move-x:${p}`,
      });
    expect(worldBounds(s.state, s.store, p)!.x).toBeCloseTo(x0 + 5, 9);
    expect(s.historyStates().past.length).toBe(entries + 1);
    s.undo();
    expect(worldBounds(s.state, s.store, p)!.x).toBe(x0);
  });
});

describe("locks and document bounds", () => {
  // Canvas picking is the exact hit-test service (src/hit-test, tested there).
  test("a lock is inherited from an ancestor; document bounds union the selection", () => {
    const s = twoLayers();
    const [limited, circle] = roots(s);
    expect(selectionBounds(s.state, s.store, [limited!, circle!])!.width).toBe(256);
    const layer = s.state.nodesById.get(circle!);
    const child = isContainer(layer) ? layer.orderedChildIds[0]! : circle!;
    expect(isLocked(s.state, child)).toBe(false);
    s.dispatch({ type: "setLocked", ids: [circle!], locked: true });
    expect(isLocked(s.state, child)).toBe(true);
  });
});

describe("fill targets", () => {
  test("a layer or group fills its unlocked descendant paths; locks are skipped", () => {
    const s = fixtureSession(["adjacent_colors-limited"]);
    const layer = roots(s)[0]!;
    const all = fillTargets(s.state, [layer]);
    expect(all).toHaveLength(5);
    s.dispatch({ type: "setLocked", ids: [all[0]!], locked: true });
    expect(fillTargets(s.state, [layer])).toEqual(all.slice(1));
    s.dispatch({
      type: "setFill",
      ids: fillTargets(s.state, [layer]),
      fill: { color: 0x112233ff },
    });
    expect(
      s.state.stylesById.get((s.state.nodesById.get(all[1]!) as { styleRef: string }).styleRef)!
        .fill,
    ).toBe(0x112233ff);
    s.dispatch({ type: "setLocked", ids: [layer], locked: true });
    expect(fillTargets(s.state, [layer])).toEqual([]);
  });
});
