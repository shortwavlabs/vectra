// G-DOC-R stage D, AM-2: the incremental history structure accounting against the full
// traversal oracle, ownership transitions, and retention.
import { describe, expect, test } from "vite-plus/test";
import type { Command } from "./commands.ts";
import { DocumentError, type DocState } from "./model.ts";
import type { DocumentSession } from "./session.ts";
import { structureDelta } from "./structure-accounting.ts";
import { fixturePacket } from "./testing/fixtures.ts";
import { fixtureProvenance, fixtureSession, TEST_PROVENANCE } from "./testing/helpers.ts";
import { referenceHistoryBytes } from "./testing/structure-oracle.ts";
import { randomPacket, rng, type Rng, syntheticPacket } from "./testing/synthetic.ts";

/** The ledger equals the oracle for the session's current history. */
function agrees(s: DocumentSession, label: string) {
  const { past, future } = s.historyStates();
  const oracle = referenceHistoryBytes(s.state, [...past, ...future], (st) => s.derivedOf(st));
  expect(s.historyStructureBytes(), label).toBe(oracle);
}
const ids = (st: DocState, kind: string) =>
  [...st.nodesById.values()].filter((n) => n?.kind === kind).map((n) => n!.id);

function randomEdit(r: Rng, st: DocState): Command {
  const paths = ids(st, "path");
  const groups = ids(st, "group");
  const layers = ids(st, "layer");
  const any = [...paths, ...groups, ...layers];
  const pick = <T>(xs: T[]) => (xs.length ? r.pick(xs) : undefined);
  switch (r.int(11)) {
    case 0:
      return { type: "setVisible", ids: [pick(any) ?? "pth_1"], visible: r.bool() };
    case 1:
      return { type: "rename", id: pick(any) ?? "pth_1", name: r.pick(["a", "b", ""]) };
    case 2:
      return { type: "applyTransform", ids: [pick(any) ?? "pth_1"], matrix: [1, 0, 0, 1, 2, 3] };
    case 3:
      return { type: "duplicate", ids: [pick(any) ?? "pth_1"] };
    case 4:
      return { type: "delete", ids: [pick(paths) ?? pick(any) ?? "pth_1"] };
    case 5:
      return { type: "group", ids: paths.slice(0, 1 + r.int(3)) };
    case 6:
      return groups.length
        ? { type: "ungroup", id: r.pick(groups) }
        : { type: "setArtboard", width: 9, height: 9 };
    case 7:
      return { type: "setFill", ids: paths.slice(0, 2), fill: { color: r.int(2 ** 32) } };
    case 8:
      return layers.length
        ? {
            type: "commitTrace",
            provenance: TEST_PROVENANCE,
            packet: randomPacket(r),
            replaceLayerId: r.pick(layers),
          }
        : { type: "commitTrace", provenance: TEST_PROVENANCE, packet: randomPacket(r) };
    case 9:
      return { type: "commitTrace", provenance: TEST_PROVENANCE, packet: randomPacket(r) };
    default:
      return { type: "setArtboard", width: 10 + r.int(100), height: 10 };
  }
}

describe("AM-2 structure accounting", () => {
  test("the incremental ledger equals the full-traversal oracle under random histories", () => {
    let ops = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = rng(seed);
      const s = fixtureSession(["adjacent_colors-color"], {
        history: { maxEntries: 2 + r.int(12), maxBytes: r.pick([128 * 2 ** 20, 40_000, 200_000]) },
        now: () => ops * 10, // coalescing within 1000 "ms" when keys repeat
      });
      for (let i = 0; i < 160; i++, ops++) {
        const roll = r.next();
        if (roll < 0.15) s.undo();
        else if (roll < 0.25) s.redo();
        else {
          const o = r.bool(0.15)
            ? { coalesceKey: r.pick(["nudge", "slider"]) }
            : r.bool(0.03)
              ? { withoutHistory: true }
              : {};
          try {
            s.dispatch(randomEdit(r, s.state), o);
          } catch (e) {
            if (!(e instanceof DocumentError)) throw e;
          }
        }
        agrees(s, `seed ${seed} op ${i}`);
      }
    }
  }, 60_000);

  test("ownership transitions: edit, enter history, undo, redo, discarded redo, eviction, without history", () => {
    const s = fixtureSession(["adjacent_colors-color"], {
      history: { maxEntries: 3, maxBytes: 128 * 2 ** 20 },
    });
    agrees(s, "the fixture's trace commit"); // the fixture already has one entry
    const base = s.historyStructureBytes();
    const s0 = s.state;
    s.dispatch({ type: "setVisible", ids: ["pth_13"], visible: false }); // s0 enters history
    const s1 = s.state;
    const d01 = structureDelta(s0, s1, s.derivedOf(s0), s.derivedOf(s1));
    expect(s.historyStructureBytes()).toBe(base + d01.removed);
    expect(d01.removed).toBeGreaterThan(0);
    agrees(s, "edit");
    s.undo(); // s1 becomes redo-only: its additions are history-only
    expect(s.historyStructureBytes()).toBe(base + d01.added);
    agrees(s, "undo");
    s.redo();
    expect(s.historyStructureBytes()).toBe(base + d01.removed);
    agrees(s, "redo");
    s.undo();
    s.dispatch({ type: "rename", id: "pth_14", name: "x" }); // the redo branch is discarded
    expect(s.historyStates().future).toEqual([]);
    agrees(s, "discarded redo");
    for (let i = 0; i < 5; i++)
      s.dispatch({ type: "setVisible", ids: ["pth_15"], visible: i % 2 === 0 });
    expect(s.historyStates().past.length).toBe(3); // evicted down to maxEntries
    expect(s.getSnapshot().historyTruncated).toBe(true);
    agrees(s, "eviction");
    s.dispatch({ type: "setVisible", ids: ["pth_16"], visible: false }, { withoutHistory: true });
    expect(s.historyStructureBytes()).toBe(0);
    agrees(s, "without history");
  });

  test("deltas are exact, symmetric and checked; shared allocations count once", () => {
    const s = fixtureSession(["adjacent_colors-color", "nested_rings-bw"]);
    const a = s.state;
    expect(structureDelta(a, a)).toEqual({ removed: 0, added: 0 });
    s.dispatch({ type: "duplicate", ids: ["grp_12"] });
    const b = s.state;
    const ab = structureDelta(a, b, s.derivedOf(a), s.derivedOf(b));
    const ba = structureDelta(b, a, s.derivedOf(b), s.derivedOf(a));
    expect(ab).toEqual({ removed: ba.added, added: ba.removed });
    // Three history states sharing most chunks: the oracle (which dedupes by identity) agrees.
    s.dispatch({ type: "rename", id: "pth_13", name: "y" });
    s.dispatch({ type: "rename", id: "pth_14", name: "z" });
    agrees(s, "shared chunks");
  });

  test("a large replace counts the old layer's structure; budgets reject or evict, never undercount", () => {
    const s = fixtureSession(["thin_strokes-halftone"]);
    const layer = s.state.orderedRootIds[0]!;
    s.dispatch({
      type: "commitTrace",
      packet: fixturePacket("thin_strokes-halftone"),
      provenance: fixtureProvenance("thin_strokes-halftone"),
      replaceLayerId: layer,
    });
    const S = s.historyStructureBytes();
    agrees(s, "replace");
    // At least the replaced paths' node objects: a lower bound the model must exceed.
    const paths = ids(s.historyStates().past[0]!, "path").length;
    expect(S).toBeGreaterThan(paths * 40);
  });

  test("synthetic: per-step deltas for one-node edits are O(chunk), not O(document)", () => {
    const s = fixtureSession(["adjacent_colors-color"]);
    s.dispatch({
      type: "commitTrace",
      provenance: TEST_PROVENANCE,
      packet: syntheticPacket({ paths: 20_000, anchorsPerPath: 4, groups: 4, seed: 5 }),
    });
    const before = s.state;
    s.dispatch({ type: "setVisible", ids: ["pth_100"], visible: false });
    const d = structureDelta(before, s.state, s.derivedOf(before), s.derivedOf(s.state));
    expect(d.removed).toBeLessThan(40_000); // one chunk and the directories, not 20k nodes
    expect(d.added).toBeLessThan(40_000);
  });
});
