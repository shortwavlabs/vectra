// G-DOC-R stage B: transaction validation inside the integrated DocumentSession.
// Every mode must publish the same states and reject the same transactions with the full
// pass's error, leaving the document, revision, nextId, history and store unchanged.
import { describe, expect, test } from "vite-plus/test";
import type { Command } from "./commands.ts";
import { GeometryStore } from "./geometry-store.ts";
import { DEFAULT_DOC_LIMITS, validateState } from "./invariants.ts";
import { type ContainerNode, type DocState, DocumentError, type Matrix } from "./model.ts";
import {
  DEFAULT_VALIDATION_MODE,
  DocumentSession,
  sameDerived,
  type ValidationMode,
} from "./session.ts";
import { fixturePacket } from "./testing/fixtures.ts";
import { fixtureProvenance, fixtureSession, TEST_PROVENANCE } from "./testing/helpers.ts";
import { syntheticPacket } from "./testing/synthetic.ts";
import { saveContainer } from "../persistence/container.ts";
import { NodeMap } from "./node-map.ts";
import { sha256Hex } from "./session.ts";

const MODES: readonly ValidationMode[] = ["incremental", "compare", "full"];
const ROT45: Matrix = [Math.SQRT1_2, Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2, 0, 0];
const kids = (s: DocState, id: string) => (s.nodesById.get(id) as ContainerNode).orderedChildIds;

/** Everything a rejected transaction must leave unchanged. */
function observe(session: DocumentSession) {
  const { past, future } = session.historyStates();
  return {
    snapshot: session.getSnapshot(),
    nextId: session.nextId,
    past,
    future,
    chunks: session.store.chunkIds(),
    bytes: session.store.bytes(),
    owners: session.store.chunkIds().map((id) => session.store.ownerCounts(id)),
  };
}

type Step =
  | { do: Command | readonly Command[] }
  | { undo: true }
  | { redo: true }
  | { reject: Command | readonly Command[]; code: string };

/** lay_1 (adjacent_colors-color: grp_12 > pth_13..17), then a nested_rings-bw layer. A
 *  function: packets are consumed by commit. */
const script = (): Step[] => [
  { do: { type: "setVisible", ids: ["pth_13"], visible: false } },
  { do: { type: "rename", id: "lay_1", name: "L" } },
  { do: { type: "applyTransform", ids: ["pth_14"], matrix: [1, 0, 0, 1, 3, 4] } },
  { do: { type: "applyTransform", ids: ["lay_1"], matrix: [2, 0, 0, 2, 0, 0] } },
  {
    reject: { type: "setTransform", id: "pth_15", matrix: [Number.NaN, 0, 0, 1, 0, 0] },
    code: "invalid_transform",
  },
  { reject: { type: "rename", id: "pth_15", name: "bad\uD800" }, code: "invariant" },
  { do: { type: "group", ids: ["pth_13", "pth_14"], name: "pair" } },
  { undo: true },
  { redo: true },
  { do: { type: "setClip", id: "grp_12", rect: { x: 0, y: 0, width: 10, height: 10 } } },
  {
    reject: { type: "applyTransform", ids: ["lay_1"], matrix: ROT45 },
    code: "clip_transform_unsupported",
  },
  { do: { type: "applyTransform", ids: ["lay_1"], matrix: [1, 0, 0, -1, 0, 50] } },
  { do: { type: "duplicate", ids: ["grp_12"] } },
  { do: { type: "delete", ids: ["pth_15"] } },
  { do: { type: "setFill", ids: ["pth_16"], fill: { color: 0x336699ff } } },
  { do: { type: "reorder", id: "pth_16", index: 0 } },
  { undo: true },
  { undo: true },
  { do: { type: "setPaletteColor", paletteRef: "pal_2", color: 0x112233ff } },
  { do: { type: "setArtboard", width: 300, height: 200 } },
  {
    do: {
      type: "commitTrace",
      packet: fixturePacket("nested_rings-bw"),
      provenance: fixtureProvenance("nested_rings-bw"),
      name: "rings",
    },
  },
  {
    do: {
      type: "bake",
      packet: syntheticPacket({ paths: 1, anchorsPerPath: 4, seed: 3 }),
      targetIds: ["pth_17"],
    },
  },
  // A failed transaction frees the chunk its first command committed.
  {
    reject: [
      {
        type: "commitTrace",
        packet: syntheticPacket({ paths: 3, anchorsPerPath: 4, seed: 9 }),
        provenance: TEST_PROVENANCE,
      },
      { type: "setTransform", id: "pth_17", matrix: [Number.POSITIVE_INFINITY, 0, 0, 1, 0, 0] },
    ],
    code: "invalid_transform",
  },
  { reject: { type: "ungroup", id: "grp_12" }, code: "invalid_argument" }, // clipped
  { do: { type: "releaseClip", id: "grp_12" } },
  { do: { type: "ungroup", id: "grp_12" } },
  { reject: { type: "releaseClip", id: "pth_999" }, code: "invalid_argument" }, // no such node
  { do: { type: "releaseClip", id: "lay_1" } }, // no clip: a no-op, not a transaction
  { undo: true },
  {
    reject: { type: "reparent", ids: ["grp_12"], parentId: null, index: 0 },
    code: "invalid_argument",
  },
];

function run(mode: ValidationMode, script: readonly Step[]) {
  const session = fixtureSession(["adjacent_colors-color"], { validation: mode });
  const log: unknown[] = [];
  for (const step of script) {
    if ("undo" in step) log.push(["undo", session.undo()]);
    else if ("redo" in step) log.push(["redo", session.redo()]);
    else {
      const before = observe(session);
      const cmds = "do" in step ? step.do : step.reject;
      try {
        log.push(["rev", session.dispatch(cmds)]);
      } catch (e) {
        const err = e as DocumentError;
        log.push(["error", err.code, err.message]);
        expect(observe(session), `${mode}: rollback after ${err.code}`).toEqual(before);
        expect(session.getSnapshot()).toBe(before.snapshot);
      }
    }
    const d = session.derivedOf(session.state)!;
    expect(sameDerived(d, validateState(session.state, session.store, session.limits))).toBe(true);
  }
  return { session, log };
}

describe("G-DOC-R stage B: validation modes in dispatch", () => {
  test("the default is compare under test (development) builds", () => {
    expect(DEFAULT_VALIDATION_MODE).toBe("compare");
    expect(fixtureSession(["circle-bw"]).validation).toBe("compare");
  });

  test("every mode publishes the same states and rejects with the full pass's error, atomically", () => {
    const runs = MODES.map((m) => run(m, script()));
    const [inc, cmp, full] = runs;
    expect(cmp!.log).toEqual(inc!.log);
    expect(full!.log).toEqual(inc!.log);
    // The scripted rejections happened (codes from the full pass), and so did the no-op.
    const codes = inc!.log
      .filter((x) => (x as unknown[])[0] === "error")
      .map((x) => (x as unknown[])[1]);
    expect(codes).toEqual(script().flatMap((step) => ("reject" in step ? [step.code] : [])));
    // Same documents, node by node, and same history.
    const strip = (s: DocumentSession) => ({
      state: JSON.stringify(s.state, (_, v) =>
        v instanceof Map || v instanceof NodeMap ? [...v] : v,
      ),
      past: s.historyStates().past.length,
      future: s.historyStates().future.length,
      nextId: s.nextId,
      bytes: s.store.bytes(),
    });
    expect(strip(cmp!.session)).toEqual(strip(inc!.session));
    expect(strip(full!.session)).toEqual(strip(inc!.session));
    // The incremental proof decided most transactions; `full` mode never ran it.
    expect(inc!.session.validations.incremental).toBeGreaterThan(10);
    expect(cmp!.session.validations).toEqual(inc!.session.validations);
    expect(full!.session.validations.incremental).toBe(0);
  });

  test("stable serialization: the scripted document saves to the frozen bytes in every mode", async () => {
    // Frozen on G-DOC-R stage B (8913cfb), before the command layer changes in stages C and D.
    const FROZEN = "e60fa32756cdcf1dd6ed42ffff9fc65fe4432492b58f727dc4132fff77538e36";
    for (const mode of MODES) {
      const { session } = run(mode, script());
      const bytes = await saveContainer(session, { codec: "none" });
      expect(await sha256Hex(bytes), mode).toBe(FROZEN);
    }
  });

  test("resource limits: anchors, nodes and depth are enforced identically in every mode", () => {
    for (const mode of MODES) {
      const base = fixtureSession(["adjacent_colors-color"], { validation: mode });
      const anchors = base.getSnapshot().anchors;
      const state = base.state;
      const reject = (limits: Partial<typeof DEFAULT_DOC_LIMITS>, cmd: Command, code: string) => {
        const s = fixtureSession(["adjacent_colors-color"], {
          validation: mode,
          limits: { ...DEFAULT_DOC_LIMITS, ...limits },
        });
        const before = observe(s);
        let got = "ok";
        try {
          s.dispatch(cmd);
        } catch (e) {
          got = (e as DocumentError).code;
        }
        expect(got, `${mode} ${cmd.type}`).toBe(code);
        expect(observe(s)).toEqual(before);
      };
      reject({ maxAnchors: anchors + 1 }, { type: "duplicate", ids: ["pth_13"] }, "budget");
      reject(
        { maxNodes: state.nodesById.size },
        { type: "duplicate", ids: ["pth_13"] },
        "invariant",
      );
      reject({ maxDepth: 3 }, { type: "group", ids: ["pth_13"] }, "invariant");
      // At the limit exactly: accepted.
      const ok = fixtureSession(["adjacent_colors-color"], {
        validation: mode,
        limits: { ...DEFAULT_DOC_LIMITS, maxDepth: 4 },
      });
      ok.dispatch({ type: "group", ids: ["pth_13"] });
      expect(kids(ok.state, "grp_12")).toContain("grp_18");
    }
  });

  test("an ancestor transform that overflows an existing descendant is rejected in every mode", () => {
    // Review gap 6: a committed 34-deep chain of 1e9 scales (composed 1e306 at the leaf), then
    // layer transforms: ×100 stays finite (1e308), ×10 more overflows (1e309).
    for (const mode of MODES) {
      const s = fixtureSession(["adjacent_colors-color"], { validation: mode });
      let inner = "pth_13";
      for (let i = 0; i < 34; i++) {
        const g = `grp_${s.nextId}`;
        s.dispatch({ type: "group", ids: [inner] });
        s.dispatch({ type: "setTransform", id: g, matrix: [1e9, 0, 0, 1e9, 0, 0] });
        inner = g;
      }
      s.dispatch({ type: "applyTransform", ids: ["lay_1"], matrix: [100, 0, 0, 100, 0, 0] });
      const before = observe(s);
      let code = "ok";
      try {
        s.dispatch({ type: "applyTransform", ids: ["lay_1"], matrix: [10, 0, 0, 10, 0, 0] });
      } catch (e) {
        code = (e as DocumentError).code;
      }
      expect(code, mode).toBe("invalid_transform");
      expect(observe(s)).toEqual(before);
    }
  });

  test("published states stay immutable and undo/redo restore them by reference", () => {
    const s = fixtureSession(["adjacent_colors-color"], { validation: "incremental" });
    const s0 = s.state;
    s.dispatch({ type: "setVisible", ids: ["pth_13"], visible: false });
    const s1 = s.state;
    expect(Object.isFrozen(s1)).toBe(true);
    expect(Object.isFrozen(s1.nodesById.get("pth_13"))).toBe(true);
    expect(() => (s1.nodesById as Map<string, unknown>).set("x", {})).toThrow(TypeError);
    expect(s0.nodesById.get("pth_13")!.visible).toBe(true);
    s.undo();
    expect(s.state).toBe(s0);
    s.redo();
    expect(s.state).toBe(s1);
    // A transaction from an undone state validates against that state's derived data.
    s.undo();
    const decided = s.validations.incremental;
    s.dispatch({ type: "rename", id: "pth_14", name: "n" });
    expect(s.validations.incremental).toBe(decided + 1);
    expect(s.historyStates().future).toEqual([]);
  });

  test("non-string node IDs are typed invalid_argument errors (review C2)", () => {
    for (const mode of MODES) {
      const s = fixtureSession(["adjacent_colors-color"], { validation: mode });
      const before = s.getSnapshot();
      for (const cmd of [
        { type: "rename", id: undefined, name: "x" },
        { type: "setVisible", ids: [5], visible: false },
        { type: "delete", ids: [null] },
      ] as unknown as Command[]) {
        let code = "ok";
        try {
          s.dispatch(cmd);
        } catch (e) {
          code = e instanceof DocumentError ? e.code : `untyped:${String(e)}`;
        }
        expect(code, `${mode} ${cmd.type}`).toBe("invalid_argument");
      }
      expect(s.getSnapshot()).toBe(before);
    }
  });

  test("untrusted documents: the constructor runs the full pass in every mode", () => {
    const good = fixtureSession(["adjacent_colors-color"]).state;
    const cyclic: DocState = {
      ...good,
      nodesById: new Map(good.nodesById).set("grp_12", {
        ...(good.nodesById.get("grp_12") as ContainerNode),
        orderedChildIds: [...kids(good, "grp_12"), "grp_12"],
      }),
    };
    for (const mode of MODES)
      expect(
        () => new DocumentSession(fixtureStore(), { state: cyclic, validation: mode }),
      ).toThrow(DocumentError);
  });
});

/** A store holding the adjacent_colors-color chunk as chk_1, as fixtureSession builds it. */
function fixtureStore(): GeometryStore {
  return fixtureSession(["adjacent_colors-color"]).store;
}
