// G-DOC-R stage D: AM-2 accounting and eviction costs, profiled separately from dispatch.
//   node --expose-gc scripts/profile-accounting.mjs [--sizes 43000,330000] [--reps 20] [--out f.json]
// 1. structureDelta(prev, next) alone, per transaction type: with the exact change set (as a
//    complete write log gives) and without (structural chunk diff, as for a coalesced step).
// 2. historyStructureBytes() and historyBytes() with a full history (100 entries).
// 3. Eviction: the same 120 one-node edits with maxEntries 10 (every edit evicts) and 1000
//    (none does); the difference per edit is the eviction cost.
import { execFileSync } from "node:child_process";
import { cpus, loadavg } from "node:os";
import { writeFileSync } from "node:fs";
import { applyCommand, DraftLog } from "../src/document/commands.ts";
import { IdAllocator } from "../src/document/model.ts";
import { changedKeys } from "../src/document/node-map.ts";
import { structureDelta } from "../src/document/structure-accounting.ts";
import { buildWorkload } from "../src/document/testing/bench-workload.ts";

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const SIZES = arg("--sizes", "43000,330000").split(",").map(Number);
const REPS = Number(arg("--reps", "20"));
const OUT = arg("--out", null);
const gc = globalThis.gc ?? (() => {});
const med = (xs) => +[...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)].toFixed(3);
const time = (f) => {
  const t = performance.now();
  f();
  return performance.now() - t;
};

const result = {
  script: "scripts/profile-accounting.mjs",
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  node: process.version,
  cpu: cpus()[0]?.model,
  loadavgStart: loadavg(),
  sizes: [],
};
for (const paths of SIZES) {
  const doc = buildWorkload(paths, {
    history: { maxEntries: 1000, maxBytes: Number.MAX_SAFE_INTEGER },
  });
  const { session, store } = doc;
  const row = { paths, delta: {}, sums: {}, eviction: {} };
  for (const [name, make] of Object.entries(doc.cmds)) {
    const withLog = [];
    const structural = [];
    for (let r = 0; r < REPS + 2; r++) {
      const prev = session.state;
      const ctx = {
        store,
        ids: new IdAllocator(session.nextId),
        commit: (p) => store.commit(p),
        log: new DraftLog(),
      };
      const next = applyCommand(prev, make(), ctx);
      const d = session.derivedOf(prev);
      const keys = changedKeys(prev.nodesById, next.nodesById);
      gc();
      const a = time(() => structureDelta(prev, next, d, d, keys));
      const b = time(() => structureDelta(prev, next, d, d, null));
      store.settle();
      if (r >= 2) {
        withLog.push(a);
        structural.push(b);
      }
    }
    row.delta[name] = { withWriteLog: med(withLog), structuralDiff: med(structural) };
  }
  // A full history of 100 one-node edits, then the history sums.
  for (let i = 0; i < 100; i++) session.dispatch(doc.cmds[i % 2 ? "setVisible" : "rename"]());
  const sums = [];
  const totals = [];
  for (let r = 0; r < REPS; r++) {
    sums.push(time(() => session.historyStructureBytes()));
    totals.push(time(() => session.historyBytes()));
  }
  row.sums = {
    entries: session.historyStates().past.length,
    historyStructureBytes: med(sums),
    historyBytes: med(totals),
  };
  // Eviction: maxEntries 10 (every edit evicts once the history is full) against 1000.
  for (const maxEntries of [1000, 10]) {
    const w = buildWorkload(paths, { history: { maxEntries, maxBytes: Number.MAX_SAFE_INTEGER } });
    const xs = [];
    for (let i = 0; i < 120; i++) {
      const t = time(() => w.session.dispatch(w.cmds[i % 2 ? "setVisible" : "rename"]()));
      if (i >= 20) xs.push(t);
    }
    row.eviction[`maxEntries ${maxEntries}`] = {
      dispatchMedian: med(xs),
      truncated: w.session.getSnapshot().historyTruncated,
    };
  }
  row.eviction.costPerEdit = +(
    row.eviction["maxEntries 10"].dispatchMedian - row.eviction["maxEntries 1000"].dispatchMedian
  ).toFixed(3);
  result.sizes.push(row);
  console.error(JSON.stringify(row));
}
result.loadavgEnd = loadavg();
const json = JSON.stringify(result, null, 2);
if (OUT) writeFileSync(OUT, json + "\n");
else console.log(json);
