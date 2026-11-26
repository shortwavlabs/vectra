// G-DOC-R stage C: the Draft write log, shared unchanged maps, and document order without a
// whole-tree walk. The log must cover every key whose entry differs (the incremental validator
// trusts it instead of diffing the whole node map).
import { describe, expect, test } from "vite-plus/test";
import { applyCommand, type Command, DraftLog } from "./commands.ts";
import { type ContainerNode, type DocState, IdAllocator, type NodeId } from "./model.ts";
import type { DocumentSession } from "./session.ts";
import { fixturePacket } from "./testing/fixtures.ts";
import { fixtureProvenance, fixtureSession } from "./testing/helpers.ts";
import { syntheticPacket } from "./testing/synthetic.ts";

const kids = (s: DocState, id: string) => (s.nodesById.get(id) as ContainerNode).orderedChildIds;
const changedKeys = (a: DocState, b: DocState) => {
  const out = new Set<NodeId>();
  for (const [k, v] of b.nodesById) if (a.nodesById.get(k) !== v) out.add(k);
  for (const k of a.nodesById.keys()) if (!b.nodesById.has(k)) out.add(k);
  return out;
};
function apply(session: DocumentSession, cmds: readonly Command[]) {
  const log = new DraftLog();
  const { store } = session;
  const ctx = {
    store,
    ids: new IdAllocator(session.nextId),
    commit: store.commit.bind(store),
    log,
  };
  let s = session.state;
  for (const c of cmds) {
    const out = applyCommand(s, c, ctx);
    log.step(s, out);
    s = out;
  }
  store.settle();
  return { prev: session.state, next: s, log };
}

/** Two layers: lay_1 (adjacent_colors-color: grp_12 > pth_13..17) and thin_strokes-halftone. */
const session = () => fixtureSession(["adjacent_colors-color", "thin_strokes-halftone"]);
const COMMANDS: Record<string, () => Command> = {
  setVisible: () => ({ type: "setVisible", ids: ["pth_13", "pth_14"], visible: false }),
  setLocked: () => ({ type: "setLocked", ids: ["grp_12"], locked: true }),
  rename: () => ({ type: "rename", id: "lay_1", name: "x" }),
  setTransform: () => ({ type: "setTransform", id: "pth_15", matrix: [1, 0, 0, 1, 2, 3] }),
  applyTransform: () => ({
    type: "applyTransform",
    ids: ["lay_1", "pth_13"],
    matrix: [2, 0, 0, 2, 0, 0],
  }),
  rotate90: () => ({ type: "rotate90", ids: ["grp_12"], turns: 1 }),
  setFill: () => ({ type: "setFill", ids: ["pth_16", "pth_13"], fill: { color: 0xff0000ff } }),
  setPaletteColor: () => ({ type: "setPaletteColor", paletteRef: "pal_2", color: 0x00ff00ff }),
  group: () => ({ type: "group", ids: ["pth_15", "pth_13"] }),
  ungroup: () => ({ type: "ungroup", id: "grp_12" }),
  delete: () => ({ type: "delete", ids: ["pth_14", "grp_12"] }),
  duplicate: () => ({ type: "duplicate", ids: ["pth_17", "pth_13"] }),
  reorder: () => ({ type: "reorder", id: "pth_17", index: 0 }),
  reparent: () => ({ type: "reparent", ids: ["pth_13"], parentId: "lay_1", index: 0 }),
  setClip: () => ({ type: "setClip", id: "grp_12", rect: { x: 0, y: 0, width: 5, height: 5 } }),
  setArtboard: () => ({ type: "setArtboard", width: 10, height: 10 }),
  attachSource: () => ({
    type: "attachSource",
    asset: {
      digest: "ab".repeat(32),
      mime: "image/png",
      width: 4,
      height: 4,
      embedded: false,
      decodePolicy: "browser-canvas-v1",
    },
  }),
  commitTrace: () => ({
    type: "commitTrace",
    packet: fixturePacket("circle-bw"),
    provenance: fixtureProvenance("circle-bw"),
  }),
  replaceTrace: () => ({
    type: "commitTrace",
    packet: fixturePacket("circle-bw"),
    provenance: fixtureProvenance("circle-bw"),
    replaceLayerId: "lay_1",
  }),
  releaseClip: () => ({ type: "releaseClip", id: "grp_12" }), // clipped first, below
  bake: () => ({
    type: "bake",
    packet: syntheticPacket({ paths: 2, anchorsPerPath: 4, seed: 1 }),
    targetIds: ["pth_13", "pth_14"],
  }),
};

describe("G-DOC-R stage C: Draft write log", () => {
  test.each(Object.keys(COMMANDS))(
    "%s: the log is complete and covers every changed key",
    (name) => {
      const s = session();
      if (name === "releaseClip") s.dispatch(COMMANDS.setClip!());
      const { prev, next, log } = apply(s, [COMMANDS[name]!()]);
      expect(next).not.toBe(prev);
      expect(log.complete).toBe(true);
      const changed = changedKeys(prev, next);
      for (const k of changed) expect(log.keys.has(k), `${name}: ${k}`).toBe(true);
      if (
        name.startsWith("set") &&
        name !== "setFill" &&
        name !== "setPaletteColor" &&
        name !== "setArtboard"
      )
        expect([...log.keys].sort()).toEqual([...changed].sort()); // patches write only their targets
    },
  );

  test("a published state's map does not retain the Draft's written keys", () => {
    const s = session();
    s.dispatch(COMMANDS.commitTrace!());
    s.dispatch(COMMANDS.duplicate!());
    for (const st of [s.state, ...s.historyStates().past])
      expect((st.nodesById as { written?: unknown }).written).toBeUndefined();
  });

  test("multi-command transactions: the log is the union over the chain", () => {
    const s = session();
    const { prev, next, log } = apply(s, [
      COMMANDS.group!(),
      COMMANDS.duplicate!(),
      COMMANDS.delete!(),
    ]);
    expect(log.complete).toBe(true);
    for (const k of changedKeys(prev, next)) expect(log.keys.has(k)).toBe(true);
  });

  test("a result not produced by the last Draft on its input marks the log incomplete", () => {
    const s = session();
    const log = new DraftLog();
    const forged: DocState = { ...s.state, orderedRootIds: [...s.state.orderedRootIds].reverse() };
    log.step(s.state, s.state); // a no-op keeps it complete
    expect(log.complete).toBe(true);
    log.step(s.state, forged);
    expect(log.complete).toBe(false);
  });

  test("unchanged sealed maps are shared with the predecessor; changed ones are not", () => {
    const s = session();
    const a = s.state;
    s.dispatch(COMMANDS.setVisible!());
    const b = s.state;
    expect(b.stylesById).toBe(a.stylesById);
    expect(b.paletteById).toBe(a.paletteById);
    expect(b.sourceAssetsById).toBe(a.sourceAssetsById);
    expect(b.nodesById).not.toBe(a.nodesById);
    s.dispatch(COMMANDS.setFill!());
    expect(s.state.stylesById).not.toBe(b.stylesById);
    expect(s.state.paletteById).toBe(a.paletteById);
    expect(() => (s.state.stylesById as Map<string, unknown>).set("x", {})).toThrow(TypeError);
  });

  test("document order: target order in the command does not matter", () => {
    const run = (cmd: Command) => {
      const s = session();
      s.dispatch(cmd);
      return JSON.stringify(s.state, (_, v) => (v instanceof Map ? [...v] : v));
    };
    const ids = ["pth_16", "pth_13", "pth_15"];
    const rev = [...ids].reverse();
    expect(run({ type: "setFill", ids, fill: { color: 1 } })).toBe(
      run({ type: "setFill", ids: rev, fill: { color: 1 } }),
    );
    expect(run({ type: "duplicate", ids })).toBe(run({ type: "duplicate", ids: rev }));
    expect(run({ type: "group", ids })).toBe(run({ type: "group", ids: rev }));
    expect(run({ type: "delete", ids })).toBe(run({ type: "delete", ids: rev }));
    // setFill allocates one style per original style in document order: pth_13 first.
    const s = session();
    const before = s.nextId;
    s.dispatch({ type: "setFill", ids, fill: { color: 1 } });
    expect(s.state.nodesById.get("pth_13")!).toMatchObject({ styleRef: `sty_${before}` });
    // Across containers and layers: duplicate keeps each copy next to its original.
    const t = session();
    const g2 = kids(t.state, t.state.orderedRootIds[1]!)[0]!;
    const p2 = kids(t.state, g2)[0]!;
    t.dispatch({ type: "duplicate", ids: [p2, "pth_13"] });
    expect(kids(t.state, "grp_12").slice(0, 2)).toEqual(["pth_13", `pth_${before}`]);
    expect(kids(t.state, g2)[1]).toBe(`pth_${before + 1}`);
  });

  test("no-op transactions: an empty transaction and a no-op command change nothing", () => {
    const s = session();
    const snap = s.getSnapshot();
    expect(s.dispatch([])).toBe(snap.revision);
    expect(s.dispatch({ type: "releaseClip", id: "pth_13" })).toBe(snap.revision);
    expect(s.getSnapshot()).toBe(snap);
    // An edit to the same value is still a transaction (unchanged semantics: new revision).
    const r = s.dispatch({ type: "setVisible", ids: ["pth_13"], visible: true });
    expect(r).toBe(snap.revision + 1);
    expect(s.getSnapshot().canUndo).toBe(true);
  });
});
