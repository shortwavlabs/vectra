// G-DOC-R stage D (AM-2 ownership transitions): no predecessor retention. Evicted and
// discarded states, and every state of a dropped session (replaced or closed document), must
// be collectable: no cache, write log, parent index or accounting record may keep them alive.
// Also run outside the test runner: `node --expose-gc scripts/check-retention.mjs`.
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { expect, test } from "vite-plus/test";
import type { DocState } from "../../src/document/model.ts";
import type { DocumentSession } from "../../src/document/session.ts";
import { fixtureSession } from "../../src/document/testing/helpers.ts";

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;
const collect = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 0));
    gc();
  }
};

// Helpers keep every local that holds a state inside a returned-from function.
function build(refs: WeakRef<DocState>[]): DocumentSession {
  const s = fixtureSession(["adjacent_colors-color"], {
    history: { maxEntries: 2, maxBytes: 128 * 2 ** 20 },
  });
  for (let i = 0; i < 6; i++) {
    refs.push(new WeakRef(s.state));
    s.dispatch({ type: "setVisible", ids: ["pth_13"], visible: i % 2 === 0 });
    s.dispatch({ type: "duplicate", ids: ["pth_14"] });
  }
  s.undo();
  refs.push(new WeakRef(s.historyStates().future[0]!));
  s.dispatch({ type: "rename", id: "pth_15", name: "q" }); // discards the redo state
  return s;
}
const strays = (s: DocumentSession, refs: WeakRef<DocState>[]) => {
  const retained = new Set([...s.historyStates().past, s.state]);
  return refs.filter((w) => {
    const st = w.deref();
    return st !== undefined && !retained.has(st);
  }).length;
};
const lastRef = (s: DocumentSession) => new WeakRef(s.state);

test("evicted and discarded states, and a dropped session, are collectable", async () => {
  const refs: WeakRef<DocState>[] = [];
  let s: DocumentSession | null = build(refs);
  await collect();
  expect(strays(s, refs)).toBe(0);
  const last = lastRef(s);
  s = null; // the document is closed or replaced
  await collect();
  expect(last.deref()).toBeUndefined();
  expect(refs.filter((w) => w.deref() !== undefined).length).toBe(0);
});
