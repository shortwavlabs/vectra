// G-DOC-R integrated dispatch benchmark (Node, main thread; diagnostic, not part of `vp test`).
//   node --expose-gc scripts/bench-g-doc-r.mjs [--reps 30] [--sizes 43000,250000]
//        [--modes incremental,full] [--only setVisible,group] [--out file.json]
// Same workload as scripts/bench-td-perf-007.mjs (src/document/testing/bench-workload.ts).
// Per size, mode and transaction type, each repetition: an untimed `setArtboard` dispatch
// gives a fresh state S (cold per-state caches); `session.dispatch(cmd)` on S is timed end to
// end; then undo and redo are timed and an untimed undo returns to S (fixed document size).
// `gc()` (with --expose-gc) runs between repetitions, outside the timed sections.
import { execFileSync } from "node:child_process";
import { cpus, loadavg, totalmem } from "node:os";
import { writeFileSync } from "node:fs";
import { buildWorkload } from "../src/document/testing/bench-workload.ts";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const REPS = Number(arg("--reps", "30"));
const WARMUP = 2;
const SIZES = arg("--sizes", "43000,250000").split(",").map(Number);
const MODES = arg("--modes", "incremental,full").split(",");
const ONLY = arg("--only", null)?.split(",");
const OUT = arg("--out", null);
const gc = globalThis.gc ?? (() => {});
const now = () => performance.now();
const load = () => loadavg().map((x) => +x.toFixed(2));
/** Machine conditions (shared machine): top CPU consumers and the ngspice process count. */
const conditions = () => {
  const ps = execFileSync("ps", ["-Ao", "pcpu,comm", "-r"], { encoding: "utf8" })
    .trim()
    .split("\n");
  return {
    loadavg: load(),
    top: ps.slice(1, 6).map((l) => l.trim().replace(/^(\S+)\s+.*\/(.*)$/, "$1 $2")),
    ngspice: ps.filter((l) => /ngspice/.test(l)).length,
  };
};
const q = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
};
const stats = (xs) => ({
  p50: +q(xs, 0.5).toFixed(3),
  p95: +q(xs, 0.95).toFixed(3),
  max: +Math.max(...xs).toFixed(3),
});
const time = (f) => {
  const t = now();
  f();
  return now() - t;
};

function measure(doc, name) {
  const { session } = doc;
  const make = doc.cmds[name];
  const rows = { dispatch: [], undo: [], redo: [], persist: [] };
  const v0 = session.validations;
  for (let r = 0; r < WARMUP + REPS; r++) {
    session.dispatch({ type: "setArtboard", width: 1000 + ((r + 1) % 2), height: 1000 });
    const S = session.state;
    gc();
    const dispatch = time(() => session.dispatch(make()));
    if (session.state === S) throw new Error(`${name}: dispatch was a no-op`);
    // G-PRJ-0: persistability accounting inside that dispatch (absent before G-PRJ-0).
    if (typeof session.lastPersistMs === "number" && r >= WARMUP)
      rows.persist.push(session.lastPersistMs);
    const undo = time(() => session.undo());
    const redo = time(() => session.redo());
    session.undo();
    if (session.state !== S) throw new Error("undo did not restore S");
    if (r < WARMUP) continue;
    rows.dispatch.push(dispatch);
    rows.undo.push(undo);
    rows.redo.push(redo);
  }
  const v1 = session.validations;
  // Each repetition validates two transactions: setArtboard (always decided) and the command.
  const decided = v1.incremental - v0.incremental - (WARMUP + REPS);
  return {
    dispatch: stats(rows.dispatch),
    ...(rows.persist.length ? { persist: stats(rows.persist) } : {}),
    undo: stats(rows.undo),
    redo: stats(rows.redo),
    incrementalDecided: session.validation === "full" ? 0 : +(decided / (WARMUP + REPS)).toFixed(3),
  };
}

const result = {
  script: "scripts/bench-g-doc-r.mjs",
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  trackedChanges:
    execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }) !==
    "",
  argv: process.argv.slice(2),
  node: process.version,
  cpu: cpus()[0]?.model,
  cpus: cpus().length,
  totalMemGiB: +(totalmem() / 2 ** 30).toFixed(1),
  gcBetweenRepetitions: typeof globalThis.gc === "function",
  reps: REPS,
  warmup: WARMUP,
  loadavgStart: load(),
  conditionsStart: conditions(),
  runs: [],
};
for (const paths of SIZES)
  for (const validation of MODES) {
    const doc = buildWorkload(paths, { validation });
    const run = { ...doc.info, validation, loadavgStart: load(), commands: {} };
    for (const name of Object.keys(doc.cmds)) {
      if (ONLY && !ONLY.includes(name)) continue;
      const c = (run.commands[name] = measure(doc, name));
      console.error(
        `${paths} ${validation} ${name}: dispatch p50 ${c.dispatch.p50} p95 ${c.dispatch.p95} ms ` +
          `(decided ${c.incrementalDecided}); undo ${c.undo.p50}, redo ${c.redo.p50}` +
          (c.persist ? `; persist p50 ${c.persist.p50} p95 ${c.persist.p95}` : ""),
      );
    }
    run.loadavgEnd = load();
    result.runs.push(run);
  }
result.loadavgEnd = load();
result.conditionsEnd = conditions();
const json = JSON.stringify(result, null, 2);
if (OUT) writeFileSync(OUT, json + "\n");
else console.log(json);
