// G-DOC-R stage B: `compare` mode detects a faulty incremental validator (fault injection)
// and keeps the transaction atomic. `incremental` mode would publish such a fault, which is
// why the differential harness, not this mode, is the acceptance evidence.
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { StateDerived } from "./invariants.ts";
import { ValidationDisagreement } from "./session.ts";
import { fixtureSession } from "./testing/helpers.ts";

const fault = vi.hoisted(() => ({ mode: "none" as "none" | "accept-all" | "anchors" }));
vi.mock("./incremental-validate.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("./incremental-validate.ts")>();
  return {
    ...real,
    checkIncremental: (...a: Parameters<typeof real.checkIncremental>) => {
      const r = real.checkIncremental(...a);
      const timing = r.timing;
      if (fault.mode === "accept-all") return { derived: a[1] as StateDerived, timing }; // accepts anything, prev's data
      if (fault.mode === "anchors" && r.derived)
        return { derived: { ...r.derived, anchors: r.derived.anchors + 1 }, timing };
      return r;
    },
  };
});
afterEach(() => {
  fault.mode = "none";
});

describe("compare mode: fault injection", () => {
  test.each(["accept-all", "anchors"] as const)("%s is caught; the document is unchanged", (m) => {
    const s = fixtureSession(["adjacent_colors-color"], { validation: "compare" });
    const before = { snap: s.getSnapshot(), nextId: s.nextId, chunks: s.store.chunkIds() };
    fault.mode = m;
    const bad =
      m === "accept-all"
        ? {
            type: "setTransform" as const,
            id: "pth_13",
            matrix: [Number.NaN, 0, 0, 1, 0, 0] as const,
          }
        : { type: "setVisible" as const, ids: ["pth_13"], visible: false };
    expect(() => s.dispatch(bad as never)).toThrow(ValidationDisagreement);
    expect(s.getSnapshot()).toBe(before.snap);
    expect(s.nextId).toBe(before.nextId);
    expect(s.store.chunkIds()).toEqual(before.chunks);
    fault.mode = "none";
    s.dispatch({ type: "setVisible", ids: ["pth_13"], visible: false });
    expect(s.state.nodesById.get("pth_13")!.visible).toBe(false);
  });

  test("full mode never consults the incremental validator", () => {
    const s = fixtureSession(["adjacent_colors-color"], { validation: "full" });
    fault.mode = "accept-all";
    expect(() =>
      s.dispatch({ type: "setTransform", id: "pth_13", matrix: [Number.NaN, 0, 0, 1, 0, 0] }),
    ).toThrow(/composed transform|not finite|transform/);
  });
});
