// TD-PERF-007: the prototype incremental validator against the full validateState (oracle).
// Acceptance bar (decision register §9): ≥ 10,000 randomized validator-reached transactions,
// valid and invalid, with zero disagreements, from a recorded seed.
import { describe, expect, test } from "vite-plus/test";
import { runDifferential } from "./testing/incremental-differential.ts";

const DIFFERENTIAL_SEED = 20_261_125;

const sources = import.meta.glob<string>(["/src/document/**/*.ts", "/src/persistence/**/*.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("TD-PERF-007 incremental validator (prototype, not wired)", () => {
  test(`differential vs validateState, seed ${DIFFERENTIAL_SEED}`, () => {
    const s = runDifferential({ seed: DIFFERENTIAL_SEED, transactions: 16_000 });
    expect(s.disagreements).toEqual([]);
    expect(s.compared).toBeGreaterThanOrEqual(10_000);
    expect(s.decided).toBeGreaterThanOrEqual(5_000); // fast-accepted and checked, not fallbacks
    expect(s.fullRejected).toBeGreaterThanOrEqual(2_000); // invalid states reach both validators
    expect(s.commandRejected).toBeGreaterThan(0); // reparent cycles, dangling ids, bad palette refs
    for (const label of ["cycle", "second-parent", "orphan", "dangling-child", "bad-palette-ref"])
      expect(s.byLabel[`forged:${label}`]?.fullRejected, label).toBeGreaterThan(0);
    expect(s.fullErrorCodes.invalid_transform).toBeGreaterThan(0);
    expect(s.fullErrorCodes.clip_transform_unsupported).toBeGreaterThan(0);
  }, 120_000);

  test("the session, and therefore loadContainer, never use it", () => {
    for (const [path, text] of Object.entries(sources))
      if (
        !path.endsWith(".test.ts") &&
        !path.includes("/testing/") &&
        !path.endsWith("incremental-validate.ts")
      )
        expect(text.includes("incremental-validate"), path).toBe(false);
    expect(sources["/src/persistence/container.ts"]).toContain("new DocumentSession(");
    expect(sources["/src/document/session.ts"]).toContain(
      "validateState(o.state, store, this.limits)",
    );
  });
});
