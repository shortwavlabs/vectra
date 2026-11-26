import { describe, expect, test } from "vite-plus/test";
import { fixtureSession } from "../document/testing/helpers.ts";
import { type DocState, isContainer } from "../document/model.ts";
import type { DocumentSession } from "../document/session.ts";
import {
  fillTargets,
  generatedLabel,
  isLocked,
  moveCommand,
  paletteLabels,
  pathFill,
  planDeletion,
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

describe("palette names on screen (display only)", () => {
  const names = (s: DocState) => {
    const l = paletteLabels(s);
    return [...s.paletteById.values()].map((e) => [e.name, l.get(e.id)]);
  };
  /** A copy of the state with palette entries renamed (no command renames them today). */
  const renamed = (s: DocState, to: Record<string, string>) =>
    ({
      ...s,
      paletteById: new Map(
        [...s.paletteById].map(([id, e]) => [id, to[e.name] ? { ...e, name: to[e.name]! } : e]),
      ),
    }) as DocState;

  test("the friendly form: Colour N+1 from the number in the name", () => {
    expect(["p0", "p7", "c0", "c12", "x3", "ink", "ink1"].map(generatedLabel)).toEqual([
      "Colour 1",
      "Colour 8",
      "Colour 1",
      "Colour 13",
      "Colour 4",
      "Colour 1",
      "Colour 2",
    ]);
    for (const other of ["Sky", "p", "p1a", "pink", "P2", "Colour 3", ""])
      expect(generatedLabel(other)).toBeNull();
  });

  test("real traces: provenance-backed, numbered by name, unique across traces", () => {
    const s = fixtureSession(["adjacent_colors-limited", "adjacent_colors-color", "circle-bw"]);
    const before = JSON.stringify([...s.state.paletteById.values()]);
    expect(names(s.state)).toEqual([
      // Limited Palette, in first-use order: the number is the name's, not the position.
      ["p2", "Colour 3"],
      ["p3", "Colour 4"],
      ["p0", "Colour 1"],
      ["p1", "Colour 2"],
      ["p4", "Colour 5"],
      // Full Colour: the same labels are taken, so this trace's read "(2)".
      ...[0, 1, 2, 3, 4].map((n) => [`c${n}`, `Colour ${n + 1} (2)`]),
      // Black & White: "ink" is its first colour.
      ["ink", "Colour 1 (3)"],
    ]);
    // Display only: IDs, names, colours and order are unchanged.
    expect(JSON.stringify([...s.state.paletteById.values()])).toBe(before);
  });

  test("two traces of one image: the second set reads (2); labels are stable across edits", () => {
    const s = fixtureSession(["adjacent_colors-limited", "adjacent_colors-limited"]);
    const shown = names(s.state).map(([, l]) => l);
    expect(new Set(shown).size).toBe(shown.length);
    expect(shown.slice(5)).toEqual(shown.slice(0, 5).map((l) => `${l} (2)`));
    s.dispatch({ type: "setVisible", ids: [roots(s)[0]!], visible: false });
    expect(names(s.state).map(([, l]) => l)).toEqual(shown);
  });

  test("custom names are never renamed, even when they match an engine pattern", () => {
    const s = fixtureSession(["adjacent_colors-limited", "adjacent_colors-color"]);
    // "p9" and "x1" match the patterns but no trace generated them; "c0" was generated, but by
    // the other trace, not by the one whose paths use this entry.
    const r = renamed(s.state, { p2: "p9", p3: "c0", p0: "x1" });
    expect(names(r).slice(0, 3)).toEqual([
      ["p9", "p9"],
      ["c0", "c0"],
      ["x1", "x1"],
    ]);
    // A custom name equal to a label keeps it; the generated entry gives way.
    const t = renamed(s.state, { p2: "Colour 2" });
    expect(names(t).slice(0, 4)).toEqual([
      ["Colour 2", "Colour 2"],
      ["p3", "Colour 4"],
      ["p0", "Colour 1"],
      ["p1", "Colour 2 (2)"],
    ]);
  });

  test("with no traced layer left, no provenance remains: entries show their stored names", () => {
    // The limit of the signal (reported, not worked around): deleting the only traced layer
    // leaves its palette entries in the document but removes the provenance that named them.
    const s = fixtureSession(["adjacent_colors-limited"]);
    s.dispatch({ type: "delete", ids: [roots(s)[0]!] });
    expect(s.state.paletteById.size).toBe(5);
    expect(names(s.state).every(([name, label]) => name === label)).toBe(true);
    s.undo();
    expect(names(s.state).every(([, label]) => /^Colour \d$/.test(label!))).toBe(true);
  });

  test("strict: an unused entry has no trace owner, so it keeps its stored name", () => {
    // Maintainer final acceptance: an entry no path uses is never relabelled from unrelated
    // traces; a raw engine name is preferred over relabelling a possibly user-defined name.
    const s = fixtureSession(["adjacent_colors-limited", "adjacent_colors-color"]);
    const layer = roots(s)[0]!;
    s.dispatch({
      type: "setFill",
      ids: fillTargets(s.state, [layer]),
      fill: { color: 0x2050a0ff },
    });
    // The Limited Palette entries are now unused: stored names, even "c0" (which the Full Colour
    // trace generated for one of its own entries).
    const r = renamed(s.state, { p2: "c0", p3: "Sky" });
    expect(names(r).slice(0, 5)).toEqual([
      ["c0", "c0"],
      ["Sky", "Sky"],
      ["p0", "p0"],
      ["p1", "p1"],
      ["p4", "p4"],
    ]);
    // The Full Colour trace's entries are still used: provenance-backed labels, and the stored
    // "c0" above takes nothing from them (labels and stored names never collide).
    const shown = names(r).slice(5);
    expect(shown.map(([, l]) => l)).toEqual([0, 1, 2, 3, 4].map((n) => `Colour ${n + 1}`));
  });

  test("an entry no path uses any more shows its stored name; undo restores the label", () => {
    const s = fixtureSession(["adjacent_colors-limited"]);
    const shown = names(s.state);
    const layer = roots(s)[0]!;
    s.dispatch({
      type: "setFill",
      ids: fillTargets(s.state, [layer]),
      fill: { color: 0x2050a0ff },
    });
    expect(names(s.state).every(([name, label]) => name === label)).toBe(true);
    s.undo();
    expect(names(s.state)).toEqual(shown);
  });

  test("labels are computed once per state, linear in nodes and entries", () => {
    // A guard for the quadratic form (an id set copied per entry): 20,000 entries used by
    // 20,000 paths of one traced layer must label in well under a second.
    const s = fixtureSession(["adjacent_colors-limited"]);
    const st = s.state;
    const layer = st.nodesById.get(roots(s)[0]!)! as unknown as {
      traceProvenance: { originalScene: { palette: { id: string; color: string }[] } };
    };
    const big = 20_000;
    const palette = new Map(st.paletteById);
    const styles = new Map(st.stylesById);
    const nodes = new Map(st.nodesById);
    const first = [...st.nodesById.values()].find((n) => n.kind === "path")! as {
      styleRef: string;
      id: string;
    };
    const proto = st.paletteById.values().next().value!;
    const ids: { id: string; color: string }[] = [];
    const kids: string[] = [];
    for (let i = 0; i < big; i++) {
      const pid = `pal_big_${i}`;
      palette.set(pid as never, { ...proto, id: pid as never, name: `c${i}` });
      styles.set(`sty_big_${i}` as never, {
        ...st.stylesById.get(first.styleRef as never)!,
        paletteRef: pid as never,
      });
      nodes.set(
        `pth_big_${i}` as never,
        { ...(first as object), id: `pth_big_${i}`, styleRef: `sty_big_${i}` } as never,
      );
      ids.push({ id: `c${i}`, color: "#000000" });
      kids.push(`pth_big_${i}`);
    }
    nodes.set(
      roots(s)[0]! as never,
      {
        ...(layer as object),
        orderedChildIds: kids,
        traceProvenance: {
          ...layer.traceProvenance,
          originalScene: { ...layer.traceProvenance.originalScene, palette: ids },
        },
      } as never,
    );
    const bigState = {
      ...st,
      paletteById: palette,
      stylesById: styles,
      nodesById: nodes,
    } as DocState;
    const t0 = performance.now();
    const l = paletteLabels(bigState);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(l.get("pal_big_19999" as never)).toBe("Colour 20000");
    expect(paletteLabels(bigState)).toBe(l); // cached per state
  });
});

describe("deletion and locks (maintainer review)", () => {
  const groupOf = (s: DocumentSession, layer = 0) =>
    (s.state.nodesById.get(roots(s)[layer]!)! as { orderedChildIds: readonly string[] })
      .orderedChildIds[0]!;

  test("a container holding a locked descendant: the whole deletion is refused, explained", () => {
    const s = twoLayers();
    const [a, b] = roots(s);
    s.dispatch({ type: "setLocked", ids: [firstPath(s, 0)], locked: true });
    const one = planDeletion(s.state, [a!]);
    expect(one).toEqual({
      refused: expect.stringMatching(
        /^Not deleted: ".+" contains 1 locked object\. Unlock it to delete\.$/,
      ),
    });
    // With an unlocked layer beside it: nothing is deleted (no partial deletion).
    expect("refused" in planDeletion(s.state, [a!, b!])).toBe(true);
    // A locked group and a locked path inside the same layer: both counted.
    s.dispatch({ type: "setLocked", ids: [groupOf(s, 0)], locked: true });
    expect(planDeletion(s.state, [a!])).toEqual({
      refused: expect.stringContaining("contains 2 locked objects. Unlock them"),
    });
  });

  test("directly locked items are kept; the rest is deleted; a locked ancestor protects", () => {
    const s = twoLayers();
    const [a, b] = roots(s);
    s.dispatch({ type: "setLocked", ids: [b!], locked: true });
    expect(planDeletion(s.state, [a!, b!])).toEqual({ ids: [a], kept: 1 });
    expect(planDeletion(s.state, [b!])).toEqual({ ids: [], kept: 1 });
    // A path under a locked layer is effectively locked: kept, not deleted.
    expect(planDeletion(s.state, [firstPath(s, 1)])).toEqual({ ids: [], kept: 1 });
  });

  test("after unlocking, the container deletes normally", () => {
    const s = twoLayers();
    const [a] = roots(s);
    const p = firstPath(s, 0);
    s.dispatch({ type: "setLocked", ids: [p], locked: true });
    expect("refused" in planDeletion(s.state, [a!])).toBe(true);
    s.dispatch({ type: "setLocked", ids: [p], locked: false });
    expect(planDeletion(s.state, [a!])).toEqual({ ids: [a], kept: 0 });
    expect(isLocked(s.state, p)).toBe(false);
  });
});

describe("palette edits and locks (maintainer review)", () => {
  test("a palette edit recolours a locked path that uses the entry; a direct fill skips it", () => {
    const s = twoLayers();
    const p = firstPath(s, 0);
    const ref = s.state.stylesById.get(
      (s.state.nodesById.get(p)! as { styleRef: string }).styleRef,
    )!.paletteRef!;
    expect(ref).not.toBeNull();
    s.dispatch({ type: "setLocked", ids: [p], locked: true });
    s.dispatch({ type: "setPaletteColor", paletteRef: ref, color: 0x2050a0ff });
    expect(pathFill(s.state, p).color).toBe(0x2050a0ff);
    // A direct fill on its layer reaches its unlocked siblings, never the locked path.
    expect(fillTargets(s.state, [roots(s)[0]!])).not.toContain(p);
  });
});
