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

describe("incremental validator (G-DOC-R stage B; TD-PERF-007)", () => {
  test(`differential vs validateState, seed ${DIFFERENTIAL_SEED}`, () => {
    const s = runDifferential({ seed: DIFFERENTIAL_SEED, transactions: 16_000 });
    expect(s.disagreements).toEqual([]);
    expect(s.compared).toBeGreaterThanOrEqual(10_000);
    expect(s.decided).toBeGreaterThanOrEqual(5_000); // fast-accepted and checked, not fallbacks
    expect(s.fullRejected).toBeGreaterThanOrEqual(2_000); // invalid states reach both validators
    expect(s.commandRejected).toBeGreaterThan(0); // reparent cycles, dangling ids, bad palette refs
    // Stage C: command transactions use their (verified complete) Draft write log; forgeries
    // have none and use the identity diff, so both paths are compared with the oracle.
    expect(s.writeLogged).toBeGreaterThanOrEqual(5_000);
    // Stage D (AM-2): single-defect verdicts are the same for a plain Map and a NodeMap; only
    // the duplicate-ID-number message may name the other of its two entries.
    expect(s.singleDefect.checked).toBeGreaterThanOrEqual(2_000);
    expect(Object.keys(s.singleDefect.messageDiffers).every((l) => l === "dup-number")).toBe(true);
    for (const label of [
      "cycle",
      "second-parent",
      "orphan",
      "dangling-child",
      "bad-palette-ref",
      "bad-entry",
      "budget",
    ])
      expect(s.byLabel[`forged:${label}`]?.fullRejected, label).toBeGreaterThan(0);
    for (const code of ["invalid_transform", "clip_transform_unsupported", "budget"])
      expect(s.fullErrorCodes[code], code).toBeGreaterThan(0);
  }, 120_000);

  test("only dispatch uses it: the constructor, and therefore loadContainer, run the full pass", () => {
    for (const [path, text] of Object.entries(sources))
      if (
        !path.endsWith(".test.ts") &&
        !path.includes("/testing/") &&
        !path.endsWith("incremental-validate.ts") &&
        !path.endsWith("/session.ts")
      )
        expect(/from "[^"]*incremental-validate/.test(text), path).toBe(false);
    const session = sources["/src/document/session.ts"]!;
    expect(sources["/src/persistence/container.ts"]).toContain("new DocumentSession(");
    const ctor = session.slice(session.indexOf("constructor("), session.indexOf("// --- external"));
    expect(ctor).toContain("validateState(o.state, store, this.limits)");
    expect(ctor).not.toContain("checkIncremental");
    expect(session.match(/checkIncremental\(/g)).toHaveLength(1); // in #validate only
  });
});
