// G-DOC-R stage D, AM-2: accounted history structure bytes against measured retained heap.
//   node --expose-gc scripts/calibrate-structure-accounting.mjs [--reps 3] [--out file.json]
//        [--only name,name]
// For each scenario: build a document, clear its history (withoutHistory), collect, read the
// heap (heapUsed + arrayBuffers: chunk arrays live in ArrayBuffers); run the scenario's
// history, collect, read again and record the session's accounted history-only structure
// bytes; then clear the history and collect once more. Measured history retention is the
// heap before clearing minus after. Chunk bytes retired into history (replace) are reported
// separately and subtracted (their own ledger term). Repetitions give min / median / max.
// Scenarios marked `set: "calibration"` chose the COSTS constants; the others validate them.
import { execFileSync } from "node:child_process";
import { cpus, loadavg, totalmem } from "node:os";
import { writeFileSync } from "node:fs";
import { COSTS } from "../src/document/structure-accounting.ts";
import { GeometryStore } from "../src/document/geometry-store.ts";
import { createDocument } from "../src/document/model.ts";
import { DocumentSession } from "../src/document/session.ts";
import { TEST_PROVENANCE } from "../src/document/testing/provenance.ts";
import { syntheticPacket } from "../src/document/testing/synthetic.ts";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const REPS = Number(arg("--reps", "3"));
const OUT = arg("--out", null);
const ONLY = arg("--only", null)?.split(",");
if (typeof globalThis.gc !== "function") throw new Error("run with --expose-gc");
const collect = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 0));
    globalThis.gc();
  }
};
const heap = () => {
  const m = process.memoryUsage();
  return m.heapUsed + m.arrayBuffers;
};
const HUGE = { maxEntries: 1000, maxBytes: Number.MAX_SAFE_INTEGER };

/** A provenance record with a large original palette (Full Colour traces: tens of thousands). */
const bigProvenance = (n) => ({
  ...TEST_PROVENANCE,
  originalScene: {
    ...TEST_PROVENANCE.originalScene,
    palette: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, color: (i * 2654435761) >>> 0 })),
  },
});

/**
 * The benchmark workload's shape (bench-workload.ts), built so that nothing but ID strings
 * outlives the build: the benchmark's command closures capture build-time states, which would
 * keep replaced nodes alive and hide their retention from the measurement.
 */
function buildWorkload(paths, options = {}) {
  const anchorsPerPath = paths >= 100_000 ? 3 : 6;
  const session = new DocumentSession(new GeometryStore(), {
    state: createDocument({ documentId: "calibration", width: 1000, height: 1000 }),
    ...options,
  });
  const ids = (() => {
    session.dispatch({
      type: "commitTrace",
      provenance: TEST_PROVENANCE,
      packet: syntheticPacket({ paths, anchorsPerPath, groups: 8, seed: 42 }),
    });
    session.dispatch({
      type: "commitTrace",
      provenance: TEST_PROVENANCE,
      packet: syntheticPacket({
        paths: Math.min(1000, Math.round(paths / 10)),
        anchorsPerPath: 6,
        seed: 7,
      }),
    });
    const st = session.state;
    const [main, replace] = st.orderedRootIds;
    const groups = [...st.nodesById.get(main).orderedChildIds];
    const kids = groups.map((g) => [...st.nodesById.get(g).orderedChildIds]);
    const all = kids.flat();
    const step = Math.max(1, Math.floor(all.length / 1000));
    return { main, replace, kids, many: all.filter((_, i) => i % step === 0).slice(0, 1000) };
  })();
  const pA = ids.kids[3][5];
  const pC = ids.kids[5][7];
  const replacePaths = Math.min(1000, Math.round(paths / 10));
  const cmds = {
    setVisible: () => ({ type: "setVisible", ids: [pA], visible: false }),
    rename: () => ({ type: "rename", id: pA, name: "renamed" }),
    setFillMany: () => ({ type: "setFill", ids: ids.many, fill: { color: 0x993366ff } }),
    applyTransformLayer: () => ({
      type: "applyTransform",
      ids: [ids.main],
      matrix: [1, 0, 0, 1, 3, 4],
    }),
    group: () => ({ type: "group", ids: ids.kids[1].slice(20, 30), name: "g" }),
    duplicate: () => ({ type: "duplicate", ids: [pC] }),
    commitTrace: () => ({
      type: "commitTrace",
      provenance: TEST_PROVENANCE,
      packet: syntheticPacket({ paths: replacePaths, anchorsPerPath: 6, seed: 7 }),
      replaceLayerId: ids.replace,
    }),
  };
  return { session, cmds };
}

const toggle = (doc, k) => {
  const ids = doc.cmds;
  for (let i = 0; i < k; i++) doc.session.dispatch(ids[i % 2 ? "setVisible" : "rename"]());
};
/** group, duplicate, delete the copy, then `last`: four structural edits. */
const structural = (doc, last) => {
  const s = doc.session;
  s.dispatch(doc.cmds.group());
  s.dispatch(doc.cmds.duplicate());
  s.dispatch({ type: "delete", ids: [`pth_${s.nextId - 1}`] });
  s.dispatch(doc.cmds[last]());
};
const scenarios = [
  // name, paths, set, run(doc) → history built
  { name: "43k: 1 small edit", paths: 43000, set: "calibration", run: (d) => toggle(d, 1) },
  { name: "43k: 10 small edits", paths: 43000, set: "calibration", run: (d) => toggle(d, 10) },
  { name: "43k: 50 small edits", paths: 43000, set: "calibration", run: (d) => toggle(d, 50) },
  { name: "43k: 100 small edits", paths: 43000, set: "calibration", run: (d) => toggle(d, 100) },
  {
    name: "43k: 20 structural edits",
    paths: 43000,
    set: "calibration",
    run: (d) => {
      for (let i = 0; i < 5; i++) structural(d, "applyTransformLayer");
    },
  },
  {
    name: "43k: replace the 1k-path layer ×10",
    paths: 43000,
    set: "calibration",
    run: (d) => {
      for (let i = 0; i < 10; i++) d.session.dispatch(d.cmds.commitTrace());
    },
  },
  { name: "250k: 100 small edits", paths: 250000, set: "validation", run: (d) => toggle(d, 100) },
  {
    name: "250k: 20 structural edits",
    paths: 250000,
    set: "validation",
    run: (d) => {
      for (let i = 0; i < 5; i++) structural(d, "setFillMany");
    },
  },
  {
    name: "330k (996k anchors): 50 small edits",
    paths: 330000,
    set: "validation",
    run: (d) => toggle(d, 50),
  },
  {
    name: "330k: delete the whole main layer",
    paths: 330000,
    set: "validation",
    run: (d) => d.session.dispatch({ type: "delete", ids: [d.session.state.orderedRootIds[0]] }),
  },
  {
    name: "43k: undo/redo and a branch",
    paths: 43000,
    set: "validation",
    run: (d) => {
      toggle(d, 20);
      for (let i = 0; i < 8; i++) d.session.undo();
      for (let i = 0; i < 3; i++) d.session.redo();
      d.session.dispatch(d.cmds.duplicate()); // discards the remaining redo branch
      toggle(d, 5);
    },
  },
  {
    name: "large palette and provenance: 20k styles, 30k palette entries, ×5 recolour",
    paths: 43000,
    set: "validation",
    build: () => {
      const doc = buildWorkload(1000, { history: HUGE });
      doc.session.dispatch({
        type: "commitTrace",
        provenance: bigProvenance(30_000),
        packet: syntheticPacket({
          paths: 20_000,
          anchorsPerPath: 4,
          groups: 4,
          styles: 20_000,
          seed: 3,
        }),
      });
      return doc;
    },
    run: (d) => {
      const layer = d.session.state.orderedRootIds.at(-1);
      const g = d.session.state.nodesById.get(layer).orderedChildIds[0];
      const p = d.session.state.nodesById.get(g).orderedChildIds.slice(0, 50);
      for (let i = 0; i < 5; i++)
        d.session.dispatch({ type: "setFill", ids: p, fill: { color: i } });
    },
  },
  {
    name: "large provenance: replace a traced layer ×3",
    paths: 43000,
    set: "validation",
    build: () => {
      const doc = buildWorkload(1000, { history: HUGE });
      doc.session.dispatch({
        type: "commitTrace",
        provenance: bigProvenance(30_000),
        packet: syntheticPacket({ paths: 2000, anchorsPerPath: 4, seed: 4 }),
      });
      return doc;
    },
    run: (d) => {
      const layer = d.session.state.orderedRootIds.at(-1);
      for (let i = 0; i < 3; i++)
        d.session.dispatch({
          type: "commitTrace",
          provenance: bigProvenance(30_000),
          packet: syntheticPacket({ paths: 2000, anchorsPerPath: 4, seed: 5 + i }),
          replaceLayerId: layer,
        });
    },
  },
];

async function measure(sc) {
  const doc = sc.build ? sc.build() : buildWorkload(sc.paths, { history: HUGE });
  const s = doc.session;
  s.dispatch({ type: "setArtboard", width: 999, height: 999 }, { withoutHistory: true });
  await collect();
  const h0 = heap();
  const t0 = performance.now();
  sc.run(doc);
  const runMs = performance.now() - t0;
  await collect();
  const h1 = heap();
  const accounted = s.historyStructureBytes();
  const chunkHistory = s.store.bytes().byOwnerKind.history;
  const entries = s.historyStates().past.length + s.historyStates().future.length;
  s.dispatch({ type: "setArtboard", width: 998, height: 998 }, { withoutHistory: true });
  await collect();
  const h2 = heap();
  const measured = h1 - h2 - chunkHistory;
  return { accounted, measured, chunkHistory, entries, growth: h1 - h0, runMs };
}

const q = (xs, p) =>
  [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];
const ps = execFileSync("ps", ["-Ao", "pcpu,comm", "-r"], { encoding: "utf8" }).trim().split("\n");
const result = {
  script: "scripts/calibrate-structure-accounting.mjs",
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  trackedChanges:
    execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }) !==
    "",
  node: process.version,
  cpu: cpus()[0]?.model,
  totalMemGiB: +(totalmem() / 2 ** 30).toFixed(1),
  reps: REPS,
  costs: COSTS,
  loadavgStart: loadavg(),
  topStart: ps.slice(1, 6).map((l) => l.trim()),
  scenarios: [],
};
for (const sc of scenarios) {
  if (ONLY && !ONLY.some((o) => sc.name.includes(o))) continue;
  const runs = [];
  for (let r = 0; r < REPS; r++) runs.push(await measure(sc));
  const m = runs.map((x) => x.measured);
  const a = runs.map((x) => x.accounted);
  const row = {
    name: sc.name,
    set: sc.set,
    entries: runs[0].entries,
    accounted: q(a, 0.5),
    measured: { min: Math.min(...m), median: q(m, 0.5), max: Math.max(...m) },
    ratio: +(q(a, 0.5) / q(m, 0.5)).toFixed(3),
    chunkHistory: runs[0].chunkHistory,
    runMs: +q(
      runs.map((x) => x.runMs),
      0.5,
    ).toFixed(1),
  };
  result.scenarios.push(row);
  console.error(
    `${row.set.padEnd(11)} ${row.name}: accounted ${(row.accounted / 2 ** 20).toFixed(3)} MiB, ` +
      `measured ${(row.measured.median / 2 ** 20).toFixed(3)} MiB ` +
      `[${(row.measured.min / 2 ** 20).toFixed(3)}, ${(row.measured.max / 2 ** 20).toFixed(3)}], ratio ${row.ratio}`,
  );
}
result.loadavgEnd = loadavg();
const json = JSON.stringify(result, null, 2);
if (OUT) writeFileSync(OUT, json + "\n");
else console.log(json);
