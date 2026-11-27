import { describe, expect, test } from "vite-plus/test";
import { TEST_PROVENANCE } from "./testing/helpers.ts";
import { IntakeError } from "../vectorization/intake.ts";
import type { Command } from "./commands.ts";
import { copyDiagnostics } from "./geometry-store.ts";
import { DEFAULT_DOC_LIMITS } from "./invariants.ts";
import {
  type ContainerNode,
  type DocState,
  IDENTITY,
  type Matrix,
  type PathNode,
  rotate90Matrix,
} from "./model.ts";
import { DocumentSession, sha256Hex } from "./session.ts";
import { COSTS } from "./structure-accounting.ts";
import { fixturePacket, FIXTURE_SCENES } from "./testing/fixtures.ts";
import { emptySession, errorCode, fixtureSession } from "./testing/helpers.ts";
import { parseColor, syntheticPacket } from "./testing/synthetic.ts";

const layerOf = (s: DocState, i = s.orderedRootIds.length - 1) =>
  s.nodesById.get(s.orderedRootIds[i]!) as ContainerNode;
const childrenOf = (s: DocState, id: string) =>
  (s.nodesById.get(id) as ContainerNode).orderedChildIds;
const firstGroup = (s: DocState) => childrenOf(s, layerOf(s).id)[0]!;
const firstPath = (s: DocState) => childrenOf(s, firstGroup(s))[0]!;
const ROT45: Matrix = [Math.SQRT1_2, Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2, 0, 0];

describe("commitTrace: C3.1 mapping", () => {
  test("one layer, one group per packet group, one PathObject per path, deterministic IDs", () => {
    const session = fixtureSession(["adjacent_colors-color"]);
    const s = session.state;
    const scene = FIXTURE_SCENES.get("adjacent_colors-color")!.scene;
    expect(s.orderedRootIds).toEqual(["lay_1"]);
    const layer = layerOf(s);
    expect(layer.localTransform).toEqual(IDENTITY);
    // layer, 5 palette entries, 5 styles, then group + paths in paint order
    expect([...s.paletteById.keys()]).toEqual(["pal_2", "pal_3", "pal_4", "pal_5", "pal_6"]);
    expect([...s.stylesById.keys()]).toEqual(["sty_7", "sty_8", "sty_9", "sty_10", "sty_11"]);
    expect(layer.orderedChildIds).toEqual(["grp_12"]);
    const group = s.nodesById.get("grp_12") as ContainerNode;
    expect(group.name).toBe("color");
    expect(group.clipRef).toBeUndefined();
    expect(group.orderedChildIds).toEqual(["pth_13", "pth_14", "pth_15", "pth_16", "pth_17"]);
    scene.groups[0]!.paths.forEach((sp, i) => {
      const p = s.nodesById.get(group.orderedChildIds[i]!) as PathNode;
      expect(p.geometry.pathIndex).toBe(i);
      expect(p.fillRule).toBe(sp.fillRule);
      const st = s.stylesById.get(p.styleRef)!;
      expect(st.fill).toBeNull();
      const pal = s.paletteById.get(st.paletteRef!)!;
      expect(pal.name).toBe(sp.fill!.paletteId);
      expect(pal.color).toBe(parseColor(sp.fill!.color));
    });
    expect(session.nextId).toBe(18);
  });

  test("packet clips become rect clipRefs; identical traces map identically", () => {
    const a = fixtureSession(["thin_strokes-halftone"]).state;
    const b = fixtureSession(["thin_strokes-halftone"]).state;
    const g = a.nodesById.get(firstGroup(a))!;
    expect(g.clipRef).toEqual(FIXTURE_SCENES.get("thin_strokes-halftone")!.scene.groups[0]!.clip);
    expect([...a.nodesById.entries()]).toEqual([...b.nodesById.entries()]);
  });

  test("explicit replace keeps the layer id and swaps its children; undo restores", () => {
    const session = fixtureSession(["circle-bw"]);
    const before = session.state;
    const layerId = layerOf(before).id;
    session.dispatch({
      type: "commitTrace",
      provenance: TEST_PROVENANCE,
      packet: fixturePacket("nested_rings-bw"),
      replaceLayerId: layerId,
    });
    const after = session.state;
    expect(after.orderedRootIds).toEqual([layerId]);
    expect(childrenOf(after, firstGroup(after))).toHaveLength(3);
    session.undo();
    expect(session.state).toBe(before);
  });

  test("palette ids with conflicting colours are rejected; the chunk is freed", () => {
    const session = emptySession();
    const p = syntheticPacket({ paths: 3, anchorsPerPath: 3, styles: 3 });
    p.manifest.styles[2]!.paletteId = "ink0"; // style 0 is ink0 with another fill
    const chunks = session.store.chunkIds();
    expect(
      errorCode(() =>
        session.dispatch({ type: "commitTrace", provenance: TEST_PROVENANCE, packet: p }),
      ),
    ).toBe("palette_conflict");
    expect(session.store.chunkIds()).toEqual(chunks);
  });
});

describe("transactions, revisions, undo/redo", () => {
  const structural = (s: DocState): Command[] => {
    const layer = layerOf(s).id;
    const group = firstGroup(s);
    const path = firstPath(s);
    const pal = [...s.paletteById.keys()][0]!;
    return [
      { type: "rename", id: path, name: "renamed" },
      { type: "setVisible", ids: [group], visible: false },
      { type: "setLocked", ids: [layer], locked: true },
      { type: "setTransform", id: path, matrix: [2, 0, 0, 2, 5, 5] },
      { type: "applyTransform", ids: [group], matrix: [1, 0, 0, 1, 10, -3] },
      { type: "rotate90", ids: [layer], turns: 1, pivot: { x: 128, y: 128 } },
      { type: "duplicate", ids: [path, group] },
      { type: "delete", ids: [path] },
      { type: "reorder", id: path, index: 0 },
      { type: "reparent", ids: [path], parentId: layer, index: 0 },
      { type: "setFill", ids: [path], fill: { color: 0xff0000ff } },
      { type: "setFill", ids: [path], fill: { paletteRef: pal } },
      { type: "setPaletteColor", paletteRef: pal, color: 0x00ff00ff },
      { type: "group", ids: [path], name: "g" },
      { type: "setClip", id: group, rect: { x: 0, y: 0, width: 100, height: 50 } },
      { type: "setArtboard", width: 300, height: 200, background: 0xffffffff },
    ];
  };

  test("every command is undoable and redoable by reference; revisions are monotonic", () => {
    const session = fixtureSession(["nested_rings-bw"]);
    for (const cmd of structural(session.state)) {
      const before = session.state;
      const r0 = session.getSnapshot().revision;
      session.dispatch(cmd);
      const after = session.state;
      expect(after, cmd.type).not.toBe(before);
      expect(session.getSnapshot().revision).toBe(r0 + 1);
      session.undo();
      expect(session.state).toBe(before);
      expect(session.getSnapshot().revision).toBe(r0 + 2);
      session.redo();
      expect(session.state).toBe(after);
      expect(session.getSnapshot().revision).toBe(r0 + 3);
      session.undo();
    }
  });

  test("ungroup and releaseClip are undoable", () => {
    const session = fixtureSession(["thin_strokes-halftone"]);
    const g = firstGroup(session.state);
    for (const cmd of [
      { type: "releaseClip", id: g },
      { type: "ungroup", id: g },
    ] as Command[]) {
      const before = session.state;
      session.dispatch(cmd);
      expect(session.state).not.toBe(before);
      session.undo();
      expect(session.state).toBe(before);
      session.redo();
    }
    expect(session.state.nodesById.has(g)).toBe(false);
  });

  test("a new edit clears redo", () => {
    const session = fixtureSession(["circle-bw"]);
    session.dispatch({ type: "rename", id: firstPath(session.state), name: "a" });
    session.undo();
    expect(session.getSnapshot().canRedo).toBe(true);
    session.dispatch({ type: "rename", id: firstPath(session.state), name: "b" });
    expect(session.getSnapshot().canRedo).toBe(false);
    expect(session.redo()).toBe(false);
  });

  test("a failed command leaves state, revision, nextId and store unchanged", () => {
    const session = fixtureSession(["circle-bw"]);
    const snap = session.getSnapshot();
    const nextId = session.nextId;
    const bytes = session.store.bytes();
    const path = firstPath(session.state);
    const bad: [Command, string][] = [
      [{ type: "rename", id: "pth_999", name: "x" }, "invalid_argument"],
      [{ type: "setTransform", id: path, matrix: [0, 0, 0, 0, 0, 0] }, "invalid_transform"],
      [{ type: "setTransform", id: path, matrix: [NaN, 0, 0, 1, 0, 0] }, "invalid_transform"],
      [{ type: "setTransform", id: path, matrix: [1e9, 0, 0, 1e-1, 0, 0] }, "invalid_transform"],
      [
        { type: "setClip", id: path, rect: { x: 0, y: 0, width: 1, height: 1 } },
        "clip_unsupported",
      ],
      [
        {
          type: "setClip",
          id: firstGroup(session.state),
          rect: { x: 0, y: 0, width: 0, height: 1 },
        },
        "invariant",
      ],
      [{ type: "reparent", ids: [path], parentId: null, index: 0 }, "invalid_argument"],
      [
        {
          type: "reparent",
          ids: [layerOf(session.state).id],
          parentId: firstGroup(session.state),
          index: 0,
        },
        "invalid_argument",
      ],
      [{ type: "setFill", ids: [layerOf(session.state).id], fill: null }, "invalid_argument"],
      [{ type: "setArtboard", width: 0, height: 10 }, "invariant"],
      [{ type: "rename", id: path, name: "\uD800" }, "invariant"], // unsaveable as canonical JSON
      [{ type: "setFill", ids: [path], fill: null }, "invariant"], // neither fill nor stroke
      [
        {
          type: "commitTrace",
          provenance: TEST_PROVENANCE,
          packet: fixturePacket("circle-bw"),
          replaceLayerId: path,
        },
        "invalid_argument",
      ],
      [{ type: "duplicate", ids: [firstGroup(session.state)] }, "ok"], // control: valid
    ];
    for (const [cmd, code] of bad) {
      if (code === "ok") continue;
      expect(
        errorCode(() => session.dispatch(cmd)),
        cmd.type,
      ).toBe(code);
      expect(session.getSnapshot()).toBe(snap);
      expect(session.nextId).toBe(nextId);
      expect(session.store.bytes()).toEqual(bytes);
    }
    // A batch whose second command fails publishes nothing, including the first.
    expect(
      errorCode(() =>
        session.dispatch([
          { type: "rename", id: path, name: "ok" },
          { type: "rename", id: "pth_404", name: "boom" },
        ]),
      ),
    ).toBe("invalid_argument");
    expect(session.getSnapshot()).toBe(snap);
  });

  test("subscribe/getSnapshot: stable snapshot between changes, one notification per commit", () => {
    const session = fixtureSession(["circle-bw"]);
    let calls = 0;
    const unsubscribe = session.subscribe(() => calls++);
    const a = session.getSnapshot();
    expect(session.getSnapshot()).toBe(a);
    session.dispatch({ type: "rename", id: firstPath(session.state), name: "x" });
    expect(calls).toBe(1);
    expect(session.getSnapshot()).not.toBe(a);
    unsubscribe();
    session.undo();
    expect(calls).toBe(1);
  });
});

describe("C2 rule 9: structural commands never touch geometry", () => {
  test("instrumented store sees zero commit/copyIncoming/jobCopy/renderCopy calls", () => {
    const session = fixtureSession(["nested_rings-bw", "thin_strokes-halftone"]);
    const stats = { ...session.store.stats };
    const copies = { ...copyDiagnostics };
    const s = session.state;
    const group = firstGroup(s);
    const cmds: Command[] = [
      { type: "rename", id: firstPath(s), name: "n" },
      { type: "setVisible", ids: [group], visible: false },
      { type: "setLocked", ids: [group], locked: true },
      { type: "applyTransform", ids: [group], matrix: [3, 0, 0, 3, 1, 1] },
      { type: "rotate90", ids: [group], turns: 2 },
      { type: "duplicate", ids: [layerOf(s).id] },
      { type: "reorder", id: layerOf(s).id, index: 0 },
      { type: "setFill", ids: [firstPath(s)], fill: { color: 0x123456ff } },
      { type: "group", ids: [firstPath(s)] },
      { type: "releaseClip", id: group },
      { type: "setClip", id: group, rect: { x: 1, y: 1, width: 10, height: 10 } },
      { type: "delete", ids: [layerOf(s, 0).id] },
    ];
    for (const c of cmds) session.dispatch(c);
    while (session.undo());
    while (session.redo());
    expect(session.store.stats).toEqual(stats);
    expect(copyDiagnostics).toEqual(copies);
  });
});

describe("per-reference anchor cap (C3.2)", () => {
  test("duplicate beyond the cap → budget, document unchanged", () => {
    const anchors = fixtureSession(["nested_rings-bw"]).getSnapshot().anchors;
    const session = fixtureSession(["nested_rings-bw"], {
      limits: { ...DEFAULT_DOC_LIMITS, maxAnchors: 2 * anchors },
    });
    const layer = layerOf(session.state).id;
    session.dispatch({ type: "duplicate", ids: [layer] }); // exactly at the cap: allowed
    expect(session.getSnapshot().anchors).toBe(2 * anchors);
    const snap = session.getSnapshot();
    const chunks = session.store.chunkIds();
    expect(
      errorCode(() => session.dispatch({ type: "duplicate", ids: [firstPath(session.state)] })),
    ).toBe("budget");
    expect(session.getSnapshot()).toBe(snap);
    expect(session.store.chunkIds()).toEqual(chunks);
    // A trace commit beyond the cap is rejected too, and its chunk is freed.
    expect(
      errorCode(() =>
        session.dispatch({
          type: "commitTrace",
          provenance: TEST_PROVENANCE,
          packet: fixturePacket("circle-bw"),
        }),
      ),
    ).toBe("budget");
    expect(session.store.chunkIds()).toEqual(chunks);
  });

  test("hidden objects count; history-only chunks do not", () => {
    const session = fixtureSession(["circle-bw"]);
    const a = session.getSnapshot().anchors;
    session.dispatch({ type: "setVisible", ids: [layerOf(session.state).id], visible: false });
    expect(session.getSnapshot().anchors).toBe(a);
    session.dispatch({ type: "delete", ids: [layerOf(session.state).id] });
    expect(session.getSnapshot().anchors).toBe(0);
  });
});

describe("state-identity dirty tracking (C7)", () => {
  test("edit then undo is clean; duplicate then undo is clean; save then edit is dirty", () => {
    const session = fixtureSession(["circle-bw"]);
    session.markSaved();
    expect(session.getSnapshot().dirty).toBe(false);
    session.dispatch({ type: "rename", id: firstPath(session.state), name: "x" });
    expect(session.getSnapshot().dirty).toBe(true);
    session.undo();
    expect(session.getSnapshot().dirty).toBe(false);
    const nextId = session.nextId;
    session.dispatch({ type: "duplicate", ids: [layerOf(session.state).id] });
    expect(session.getSnapshot().dirty).toBe(true);
    session.undo();
    expect(session.getSnapshot().dirty).toBe(false);
    expect(session.nextId).toBeGreaterThan(nextId); // high-water mark kept, not undoable state
    session.redo();
    session.markSaved();
    session.dispatch({ type: "rename", id: firstPath(session.state), name: "y" });
    expect(session.getSnapshot().dirty).toBe(true);
    session.undo();
    expect(session.getSnapshot().dirty).toBe(false);
  });

  test("an equal edit sequence is conservatively dirty; an evicted saved state stays dirty", () => {
    const session = fixtureSession(["circle-bw"], {
      history: { maxEntries: 2, maxBytes: 2 ** 30 },
    });
    session.markSaved();
    const path = firstPath(session.state);
    session.dispatch({ type: "rename", id: path, name: "x" });
    session.dispatch({ type: "rename", id: path, name: "" });
    expect(session.getSnapshot().dirty).toBe(true);
    session.dispatch({ type: "rename", id: path, name: "z" }); // evicts the saved state
    while (session.undo());
    expect(session.getSnapshot().dirty).toBe(true);
    expect(session.getSnapshot().historyTruncated).toBe(true);
  });
});

describe("history budget (RFC §7)", () => {
  test("100-transaction style cap: oldest evicted first, visible truncation", () => {
    const session = fixtureSession(["circle-bw"], {
      history: { maxEntries: 3, maxBytes: 2 ** 30 },
    });
    const path = firstPath(session.state);
    const states: DocState[] = [session.state];
    for (const name of ["1", "2", "3", "4", "5"]) {
      session.dispatch({ type: "rename", id: path, name });
      states.push(session.state);
    }
    expect(session.getSnapshot().historyTruncated).toBe(true);
    let undos = 0;
    while (session.undo()) undos++;
    expect(undos).toBe(3);
    expect(session.state).toBe(states[2]); // states[0] and [1] were evicted, oldest first
  });

  test("byte budget evicts the oldest history-only chunks; a change that cannot fit is rejected or confirmed", () => {
    const one = fixtureSession(["thin_strokes-halftone"]);
    const cost = one.store.cost(one.store.chunkIds()[0]!);
    // AM-2: a replace also makes the old layer's structure history-only (S bytes, measured on
    // an unbounded twin); the budget holds one replaced layer, not two.
    one.dispatch({
      type: "commitTrace",
      provenance: TEST_PROVENANCE,
      packet: fixturePacket("thin_strokes-halftone"),
      replaceLayerId: layerOf(one.state).id,
    });
    const S = one.historyStructureBytes();
    expect(S).toBeGreaterThan(0);
    const R = COSTS.chunkRecord; // the history-only chunk's store record (AM-2 closure)
    expect(one.historyBytes()).toBe(cost + R + S);
    const session = fixtureSession(["thin_strokes-halftone"], {
      history: { maxEntries: 100, maxBytes: Math.floor((cost + R + S) * 1.5) },
    });
    const layer = () => layerOf(session.state).id;
    const replace = () =>
      session.dispatch({
        type: "commitTrace",
        provenance: TEST_PROVENANCE,
        packet: fixturePacket("thin_strokes-halftone"),
        replaceLayerId: layer(),
      });
    replace(); // chunk 1 becomes history-only: within budget
    expect(session.historyBytes()).toBe(cost + R + S);
    expect(session.getSnapshot().historyTruncated).toBe(false);
    replace(); // chunk 2 becomes history-only too: over budget → oldest (chunk 1) evicted
    expect(session.historyBytes()).toBe(cost + R + session.historyStructureBytes());
    expect(session.historyStructureBytes()).toBeGreaterThan(0);
    expect(session.historyBytes()).toBeLessThanOrEqual(Math.floor((cost + R + S) * 1.5));
    expect(session.getSnapshot().historyTruncated).toBe(true);
    expect(session.store.has("chk_1")).toBe(false);
    expect(session.store.ownerCounts("chk_2").history).toBe(1);
    const b = session.store.bytes();
    expect(Object.values(b.byOwnerKind).reduce((x, y) => x + y)).toBe(b.total);

    const tight = fixtureSession(["thin_strokes-halftone"], {
      history: { maxEntries: 100, maxBytes: cost - 1 },
    });
    const snap = tight.getSnapshot();
    const replaceTight = (o = {}) =>
      tight.dispatch(
        {
          type: "commitTrace",
          provenance: TEST_PROVENANCE,
          packet: fixturePacket("thin_strokes-halftone"),
          replaceLayerId: layerOf(tight.state).id,
        },
        o,
      );
    expect(errorCode(() => replaceTight())).toBe("history_budget");
    expect(tight.getSnapshot()).toBe(snap);
    expect(tight.store.chunkIds()).toEqual(["chk_1"]);
    replaceTight({ withoutHistory: true });
    expect(tight.getSnapshot().canUndo).toBe(false);
    expect(tight.store.chunkIds()).toEqual(["chk_3"]);
  });

  test("AM-2 closure: a chunk's store record counts once, only while history is its top owner", () => {
    const session = fixtureSession(["circle-bw", "thin_strokes-halftone"]);
    expect(session.historyChunkRecordBytes()).toBe(0);
    session.dispatch({ type: "delete", ids: [session.state.orderedRootIds[1]!] });
    expect(session.historyChunkRecordBytes()).toBe(COSTS.chunkRecord);
    const snapshot = { kind: "snapshot" } as const;
    session.store.retain("chk_2", snapshot); // snapshot precedes history (C3.2)
    expect(session.historyChunkRecordBytes()).toBe(0);
    session.store.release("chk_2", snapshot);
    session.undo(); // the document owns it again
    expect(session.historyChunkRecordBytes()).toBe(0);
    session.redo();
    expect(session.historyChunkRecordBytes()).toBe(COSTS.chunkRecord);
    expect(session.historyBytes()).toBe(
      session.store.cost("chk_2") + COSTS.chunkRecord + session.historyStructureBytes(),
    );
  });
});

describe("keyboard coalescing (A13)", () => {
  test("same parameter within the window → one entry; window, focus change and other keys split", () => {
    let t = 0;
    const session = fixtureSession(["circle-bw"], { now: () => t, coalesceWindowMs: 500 });
    const path = firstPath(session.state);
    const start = session.state;
    const nudge = (x: number, key = "x") =>
      session.dispatch(
        { type: "setTransform", id: path, matrix: [1, 0, 0, 1, x, 0] },
        { coalesceKey: `${path}:${key}` },
      );
    for (let i = 1; i <= 5; i++) {
      t += 100;
      nudge(i);
    }
    session.undo();
    expect(session.state).toBe(start); // five key presses, one history entry
    session.redo();
    const afterFive = session.state;
    t += 1000; // window elapsed
    nudge(6);
    session.undo();
    expect(session.state).toBe(afterFive);
    session.redo();
    const afterSix = session.state;
    session.endCoalescing(); // focus change
    nudge(7);
    session.undo();
    expect(session.state).toBe(afterSix);
    session.redo();
    const afterSeven = session.state;
    nudge(8, "y"); // another parameter
    session.undo();
    expect(session.state).toBe(afterSeven);
  });
});

describe("clip rules (C8 rules 1–3) at command validation", () => {
  test("non-axis-preserving transforms of clipped nodes or ancestors → clip_transform_unsupported", () => {
    const session = fixtureSession(["thin_strokes-halftone"]);
    const layer = layerOf(session.state).id;
    const group = firstGroup(session.state);
    const snap = session.getSnapshot();
    expect(
      errorCode(() => session.dispatch({ type: "applyTransform", ids: [group], matrix: ROT45 })),
    ).toBe("clip_transform_unsupported");
    expect(
      errorCode(() => session.dispatch({ type: "applyTransform", ids: [layer], matrix: ROT45 })),
    ).toBe("clip_transform_unsupported");
    expect(
      errorCode(() =>
        session.dispatch({ type: "applyTransform", ids: [group], matrix: [1, 0.5, 0, 1, 0, 0] }),
      ),
    ).toBe("clip_transform_unsupported");
    expect(session.getSnapshot()).toBe(snap);
    // Translation, scale, reflection and exact quarter turns are allowed.
    session.dispatch({ type: "applyTransform", ids: [group], matrix: [-2, 0, 0, 0.5, 3, 4] });
    session.dispatch({ type: "rotate90", ids: [layer], turns: 1, pivot: { x: 10, y: 20 } });
    session.dispatch({ type: "rotate90", ids: [group], turns: 3 });
    const m = session.state.nodesById.get(layer)!.localTransform;
    expect(m.slice(0, 4)).toEqual([0, 1, -1, 0]);
    // Release clip, then the rotation is accepted; undo brings the clip back.
    session.dispatch({ type: "releaseClip", id: group });
    session.dispatch({ type: "applyTransform", ids: [group], matrix: ROT45 });
    session.undo();
    session.undo();
    expect(session.state.nodesById.get(group)!.clipRef).toBeDefined();
  });

  test("reparent under a rotated parent and setClip under a rotated ancestor are rejected", () => {
    const session = fixtureSession(["thin_strokes-halftone", "circle-bw"]);
    const clipped = firstGroup(session.state); // last layer = circle-bw (no clip)
    const halftone = layerOf(session.state, 0);
    const clippedGroup = halftone.orderedChildIds[0]!;
    const circleLayer = layerOf(session.state).id;
    session.dispatch({ type: "applyTransform", ids: [circleLayer], matrix: ROT45 });
    expect(
      errorCode(() =>
        session.dispatch({
          type: "reparent",
          ids: [clippedGroup],
          parentId: circleLayer,
          index: 0,
        }),
      ),
    ).toBe("clip_transform_unsupported");
    expect(
      errorCode(() =>
        session.dispatch({
          type: "setClip",
          id: clipped,
          rect: { x: 0, y: 0, width: 5, height: 5 },
        }),
      ),
    ).toBe("clip_transform_unsupported");
  });

  test("rotate90 composes exactly: four quarter turns are the identity linear part", () => {
    const session = fixtureSession(["thin_strokes-halftone"]);
    const group = firstGroup(session.state);
    for (let i = 0; i < 4; i++) session.dispatch({ type: "rotate90", ids: [group], turns: 1 });
    expect(session.state.nodesById.get(group)!.localTransform.slice(0, 4)).toEqual([1, 0, 0, 1]);
    expect(rotate90Matrix(2, 1, 1)).toEqual([-1, 0, 0, -1, 2, 2]);
  });
});

describe("group, ungroup, duplicate, delete, bake", () => {
  test("ungroup composes the group transform into children and preserves effective flags", () => {
    const session = emptySession();
    session.dispatch({
      type: "commitTrace",
      provenance: TEST_PROVENANCE,
      packet: syntheticPacket({ paths: 4, anchorsPerPath: 3, groups: 2 }),
    });
    const layer = layerOf(session.state).id;
    const [g0] = childrenOf(session.state, layer);
    session.dispatch([
      { type: "applyTransform", ids: [g0!], matrix: [2, 0, 0, 3, 7, 9] },
      { type: "setVisible", ids: [g0!], visible: false },
    ]);
    const kids = childrenOf(session.state, g0!);
    session.dispatch({ type: "ungroup", id: g0! });
    const s = session.state;
    expect(childrenOf(s, layer).slice(0, kids.length)).toEqual(kids);
    for (const k of kids) {
      expect(s.nodesById.get(k)!.localTransform).toEqual([2, 0, 0, 3, 7, 9]);
      expect(s.nodesById.get(k)!.visible).toBe(false);
    }
  });

  test("group requires one shared Layer/Group parent and keeps sibling order", () => {
    const session = emptySession();
    session.dispatch({
      type: "commitTrace",
      provenance: TEST_PROVENANCE,
      packet: syntheticPacket({ paths: 6, anchorsPerPath: 3, groups: 2 }),
    });
    const [g0, g1] = childrenOf(session.state, layerOf(session.state).id);
    const [a, b, c] = childrenOf(session.state, g0!);
    expect(
      errorCode(() =>
        session.dispatch({ type: "group", ids: [a!, childrenOf(session.state, g1!)[0]!] }),
      ),
    ).toBe("invalid_argument");
    session.dispatch({ type: "group", ids: [c!, a!] });
    const kids = childrenOf(session.state, g0!);
    expect(kids).toHaveLength(2);
    expect(kids[0]).toBe(b);
    expect(childrenOf(session.state, kids[1]!)).toEqual([a, c]);
  });

  test("duplicate references the same geometry under fresh IDs, right after the original", () => {
    const session = fixtureSession(["nested_rings-bw"]);
    const group = firstGroup(session.state);
    const layer = layerOf(session.state).id;
    const nextId = session.nextId;
    session.dispatch({ type: "duplicate", ids: [group] });
    const [orig, copy] = childrenOf(session.state, layer);
    expect(orig).toBe(group);
    expect(copy).toBe(`grp_${nextId}`);
    const o = childrenOf(session.state, orig!).map(
      (id) => session.state.nodesById.get(id) as PathNode,
    );
    const c = childrenOf(session.state, copy!).map(
      (id) => session.state.nodesById.get(id) as PathNode,
    );
    expect(c.map((p) => p.geometry)).toEqual(o.map((p) => p.geometry));
    expect(c.map((p) => p.id)).toEqual([
      `pth_${nextId + 1}`,
      `pth_${nextId + 2}`,
      `pth_${nextId + 3}`,
    ]);
    expect(session.store.ownerCounts(o[0]!.geometry.chunkId).document).toBe(1); // deduplicated storage
  });

  test("bake commits one chunk with only the targets' paths and repoints them", () => {
    const session = fixtureSession(["nested_rings-bw"]);
    const kids = childrenOf(session.state, firstGroup(session.state));
    const targets = [kids[2]!, kids[0]!];
    session.dispatch({ type: "applyTransform", ids: targets, matrix: [1, 0, 0, 1, 5, 5] });
    const before = session.state;
    const out = syntheticPacket({ paths: 2, anchorsPerPath: 4 });
    session.dispatch({ type: "bake", packet: out, targetIds: targets });
    const s = session.state;
    const newChunk = (s.nodesById.get(targets[0]!) as PathNode).geometry.chunkId;
    targets.forEach((id, i) => {
      const p = s.nodesById.get(id) as PathNode;
      expect(p.geometry).toEqual({ chunkId: newChunk, pathIndex: i });
      expect(p.localTransform).toEqual(IDENTITY);
      expect(p.styleRef).toBe((before.nodesById.get(id) as PathNode).styleRef);
    });
    expect((s.nodesById.get(kids[1]!) as PathNode).geometry.chunkId).not.toBe(newChunk);
    const chunks = session.store.chunkIds();
    expect(
      errorCode(() =>
        session.dispatch({
          type: "bake",
          packet: syntheticPacket({ paths: 3, anchorsPerPath: 2 }),
          targetIds: targets,
        }),
      ),
    ).toBe("invalid_argument");
    expect(session.store.chunkIds()).toEqual(chunks);
  });
});

describe("sources", () => {
  const png = (w: number, h: number) => {
    const b = new Uint8Array(64);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(b.buffer).setUint32(16, w);
    new DataView(b.buffer).setUint32(20, h);
    b.set([0, 0, 0, 0, 0x49, 0x44, 0x41, 0x54], 33);
    return b;
  };

  test("attach: signature sniffed, digest computed, locked; delete keeps bytes for undo", async () => {
    const session = emptySession();
    const bytes = png(256, 128);
    const id = await session.attachSource(bytes, { embedded: true });
    const node = session.state.nodesById.get(id)!;
    expect(node.kind).toBe("source");
    expect(node.locked).toBe(true);
    const asset = [...session.state.sourceAssetsById.values()][0]!;
    expect(asset).toMatchObject({ mime: "image/png", width: 256, height: 128, embedded: true });
    expect(asset.digest).toBe(await sha256Hex(bytes));
    expect(session.sourceByteCounts()).toEqual({ document: 64, history: 0 });
    session.dispatch({ type: "delete", ids: [id] });
    expect(session.state.sourceAssetsById.size).toBe(0);
    expect(session.sourceByteCounts()).toEqual({ document: 0, history: 64 });
    // AM-2: plus the deleted source node's accounted structure.
    expect(session.historyStructureBytes()).toBeGreaterThan(0);
    expect(session.historyBytes()).toBe(64 + session.historyStructureBytes());
    session.undo();
    expect(session.sourceBytes(asset.id)).toEqual(bytes);
  });

  test("a bad signature is refused before any transaction", async () => {
    const session = emptySession();
    const snap = session.getSnapshot();
    await expect(
      session.attachSource(new Uint8Array(64), { embedded: false }),
    ).rejects.toBeInstanceOf(IntakeError);
    expect(session.getSnapshot()).toBe(snap);
  });
});

describe("construction", () => {
  test("nextId below an existing ID is refused", () => {
    const session = fixtureSession(["circle-bw"]);
    expect(
      errorCode(() => new DocumentSession(session.store, { state: session.state, nextId: 3 })),
    ).toBe("invariant");
  });
});
