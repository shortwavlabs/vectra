// G-DOC-R stage B review C1 and gap 9: a faulty command's malformed result goes through the
// integrated dispatch in production (`incremental`) mode and must never be published.
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { DocState } from "./model.ts";
import { fixtureSession } from "./testing/helpers.ts";

const fault = vi.hoisted(() => ({ on: false, map: "nodesById" as keyof DocState }));
vi.mock("./commands.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("./commands.ts")>();
  return {
    ...real,
    applyCommand: (...a: Parameters<typeof real.applyCommand>) => {
      const out = real.applyCommand(...a);
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
