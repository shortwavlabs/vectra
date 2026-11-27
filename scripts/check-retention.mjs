// G-DOC-R stage D (AM-2 ownership transitions): no predecessor retention, outside any test
// runner (whose instrumentation can keep objects alive).
//   node --expose-gc scripts/check-retention.mjs
// Evicted and discarded states, and every state of a dropped session (a replaced or closed
// document), must be collectable: no cache, write log, parent index or accounting record may
// keep them alive. Exits 1 on any retention.
import { GeometryStore } from "../src/document/geometry-store.ts";
import { createDocument } from "../src/document/model.ts";
import { DocumentSession } from "../src/document/session.ts";
import { TEST_PROVENANCE } from "../src/document/testing/provenance.ts";
import { syntheticPacket } from "../src/document/testing/synthetic.ts";

if (typeof globalThis.gc !== "function") throw new Error("run with --expose-gc");
const collect = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 0));
    globalThis.gc();
  }
};
const fail = [];
let s = new DocumentSession(new GeometryStore(), {
  state: createDocument({ documentId: "retention", width: 100, height: 100 }),
  history: { maxEntries: 2, maxBytes: 128 * 2 ** 20 },
  validation: "compare",
});
s.dispatch({
  type: "commitTrace",
  provenance: TEST_PROVENANCE,
  packet: syntheticPacket({ paths: 3000, anchorsPerPath: 4, groups: 3, seed: 1 }),
});
const refs = [];
for (let i = 0; i < 8; i++) {
  refs.push(new WeakRef(s.state));
  s.dispatch({ type: "setVisible", ids: ["pth_10"], visible: i % 2 === 0 });
  s.dispatch({ type: "duplicate", ids: [`pth_${20 + i}`] }); // parent index, chunk splits
}
s.undo();
const discarded = new WeakRef(s.historyStates().future[0]);
s.dispatch({ type: "rename", id: "pth_11", name: "q" }); // discards the redo state
await collect();
// In a function, so its locals (which hold states) are gone before the next collection.
const checkEvicted = () => {
  const retained = new Set([...s.historyStates().past, s.state]);
  const alive = refs.map((w) => w.deref()).filter(Boolean);
  const stray = alive.filter((st) => !retained.has(st)).length;
  if (stray) fail.push(`${stray} evicted states alive`);
  if (discarded.deref()) fail.push("the discarded redo state is alive");
  console.log(
    `evicted/discarded: ${alive.length} of ${refs.length} alive, all retained by history`,
  );
};
checkEvicted();
const last = new WeakRef(s.state);
s = null; // the document is closed or replaced
await collect();
if (last.deref()) fail.push("the dropped session's current state is alive");
if (refs.some((w) => w.deref())) fail.push("states of the dropped session are alive");
console.log(fail.length ? `FAIL: ${fail.join("; ")}` : "PASS: no retention");
process.exit(fail.length ? 1 : 0);
