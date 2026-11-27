// G-DOC-R stage B review C1 and gap 9: a faulty command's malformed result goes through the
// integrated dispatch in production (`incremental`) mode and must never be published.
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { DocState } from "./model.ts";
import { ValidationDisagreement } from "./session.ts";
import { fixtureSession } from "./testing/helpers.ts";

const fault = vi.hoisted(() => ({
  on: false,
  map: "nodesById" as keyof DocState,
  /** Stage D: drop these keys from the transaction's write log after each command. */
  dropFromLog: [] as string[],
  /** Stage D: the state whose parent index is corrupted, and the corruption. */
  corruptState: null as unknown,
  corruptParent: null as [string, string] | null,
}));
vi.mock("./commands.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("./commands.ts")>();
  return {
    ...real,
    parents: (s: DocState) => {
      const p = real.parents(s);
      return fault.corruptParent && s === fault.corruptState
        ? p.with(new Map([fault.corruptParent]))
        : p;
    },
    applyCommand: (...a: Parameters<typeof real.applyCommand>) => {
      const out = real.applyCommand(...a);
      for (const k of fault.dropFromLog) a[2].log?.keys.delete(k);
      if (!fault.on) return out;
      // A key holding `undefined`, as a buggy `map.set(id, lookup.get(missing))` would leave.
      const m = new Map(out[fault.map] as ReadonlyMap<string, unknown>).set(
        "pth_900000",
        undefined,
      );
      return { ...out, [fault.map]: m } as DocState;
    },
  };
});
afterEach(() => {
  fault.on = false;
  fault.dropFromLog = [];
  fault.corruptState = null;
  fault.corruptParent = null;
});

describe("a faulty command in incremental mode", () => {
  test.each(["nodesById", "stylesById", "paletteById", "sourceAssetsById"] as const)(
    "an undefined entry in %s is rejected by the full pass; nothing is published",
    (map) => {
      const s = fixtureSession(["adjacent_colors-color"], { validation: "incremental" });
      const before = { snap: s.getSnapshot(), nextId: s.nextId, chunks: s.store.chunkIds() };
      fault.on = true;
      fault.map = map;
      expect(() => s.dispatch({ type: "setVisible", ids: ["pth_13"], visible: false })).toThrow(
        TypeError,
      );
      expect(s.getSnapshot()).toBe(before.snap);
      expect(s.nextId).toBe(before.nextId);
      expect(s.store.chunkIds()).toEqual(before.chunks);
      expect(s.validations.full).toBe(0); // no accepted transaction took the full path either
    },
  );
});

describe("stage D: a misleading write log and a corrupted parent index", () => {
  test("compare mode catches a write log that misses a changed node", () => {
    const s = fixtureSession(["adjacent_colors-color"], { validation: "compare" });
    const before = s.getSnapshot();
    fault.dropFromLog = ["pth_13"];
    expect(() => s.dispatch({ type: "setVisible", ids: ["pth_13"], visible: false })).toThrow(
      ValidationDisagreement,
    );
    expect(s.getSnapshot()).toBe(before);
  });

  test("production mode: the size check catches a log that misses an added or removed node", () => {
    const s = fixtureSession(["adjacent_colors-color"], { validation: "incremental" });
    const full = s.validations.full;
    fault.dropFromLog = [`pth_${s.nextId}`]; // the duplicate's new key
    s.dispatch({ type: "duplicate", ids: ["pth_13"] });
    expect(s.validations.full).toBe(full + 1); // undecided → the full pass decided
    expect(s.state.nodesById.has(`pth_${s.nextId - 1}`)).toBe(true);
  });

  test("compare mode catches a false acceptance caused by a corrupted parent index", () => {
    const s = fixtureSession(["adjacent_colors-color"], { validation: "compare" });
    // A 34-deep chain of 1e9 scales over pth_13, then the layer at ×100: the path's composed
    // transform is 1e308. A further ×10 on the path overflows; the proof would only see that
    // through the path's real ancestors.
    let inner = "pth_13";
    for (let i = 0; i < 34; i++) {
      const g = `grp_${s.nextId}`;
      s.dispatch({ type: "group", ids: [inner] });
      s.dispatch({ type: "setTransform", id: g, matrix: [1e9, 0, 0, 1e9, 0, 0] });
      inner = g;
    }
    s.dispatch({ type: "applyTransform", ids: ["lay_1"], matrix: [100, 0, 0, 100, 0, 0] });
    const before = s.getSnapshot();
    fault.corruptState = s.state; // the predecessor's index claims pth_13 is a child of the layer
    fault.corruptParent = ["pth_13", "lay_1"];
    expect(() =>
      s.dispatch({ type: "applyTransform", ids: ["pth_13"], matrix: [10, 0, 0, 10, 0, 0] }),
    ).toThrow(ValidationDisagreement);
    expect(s.getSnapshot()).toBe(before);
    // With a correct index the same transaction is rejected by the full pass, as it must be.
    fault.corruptParent = null;
    expect(() =>
      s.dispatch({ type: "applyTransform", ids: ["pth_13"], matrix: [10, 0, 0, 10, 0, 0] }),
    ).toThrow(/composed transform|not finite/);
  });
});

describe("stage D review C4: compare mode checks on the full-pass fallback too", () => {
  test("an undecided transaction with a misleading write log is caught", () => {
    const s = fixtureSession(["adjacent_colors-color"], { validation: "compare" });
    const before = s.getSnapshot();
    // The predecessor's index lacks pth_13's entry: the proof answers "no parent" (undecided)
    // and the full pass accepts; the log also misses pth_13. Before the fix the fallback path
    // skipped the compare-mode checks.
    fault.corruptState = s.state;
    fault.corruptParent = ["pth_13", "pth_999999999"];
    fault.dropFromLog = ["pth_13"];
    expect(() =>
      s.dispatch({ type: "applyTransform", ids: ["pth_13"], matrix: [1, 0, 0, 1, 2, 2] }),
    ).toThrow(ValidationDisagreement);
    expect(s.getSnapshot()).toBe(before);
  });
});
