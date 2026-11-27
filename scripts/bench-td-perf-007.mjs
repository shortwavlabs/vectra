// TD-PERF-007 stage profile (Node, main thread; diagnostic, not part of `vp test`).
//   node --expose-gc scripts/bench-td-perf-007.mjs [--reps 30] [--sizes 1000,16000,43000,250000]
//        [--only setVisible,rename] [--out file.json] [--no-sharing]
//
// Per document size and transaction type, each repetition:
//   1. an untimed `setArtboard` dispatch gives a fresh state object S (cold per-state caches);
//   2. `session.dispatch(cmd)` on S, timed (the real end-to-end cost);
//   3. `undo()` and `redo()` timed, then an untimed `undo()` back to S (document size fixed);
//   4. shadow stages on C = a shallow clone of S (new identity, so `parents()` is cold again):
//        copy        `new SealedMap(nodesById)` + root-list copy (exactly Draft's constructor)
//        copy+publish applyCommand(C, setArtboard with unchanged values): Draft + finish only
//        apply cold  applyCommand(C, cmd)                      apply warm  the same, again on C
//        validate    validateState(next)                       incremental checkIncremental(...)
//   Derived per rep (never by subtracting medians):
//        publish = copy+publish − copy; command (cold/warm) = apply − copy+publish;
//        history+publish residual = dispatch − apply cold − validate.
// `gc()` (with --expose-gc) runs between phases, outside timed sections.
import { execFileSync } from "node:child_process";
import { cpus, loadavg, totalmem } from "node:os";
import { writeFileSync } from "node:fs";
import { applyCommand, parents } from "../src/document/commands.ts";
import { checkIncremental } from "../src/document/incremental-validate.ts";
import { validateState } from "../src/document/invariants.ts";
import { IdAllocator, isContainer, SealedMap } from "../src/document/model.ts";
import { buildWorkload } from "../src/document/testing/bench-workload.ts";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const REPS = Number(arg("--reps", "30"));
const WARMUP = 2;
const SIZES = arg("--sizes", "1000,16000,43000,250000").split(",").map(Number);
const ONLY = arg("--only", null)?.split(",");
const OUT = arg("--out", null);
const gc = globalThis.gc ?? (() => {});
const now = () => performance.now();

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
  const v = f();
  return [now() - t, v];
};

/** Replica of the unexported `documentOrder` in commands.ts (setFill, topLevel), for timing. */
function documentOrder(s) {
  const order = new Map();
  const walk = (id) => {
    order.set(id, order.size);
    const n = s.nodesById.get(id);
    if (isContainer(n)) n.orderedChildIds.forEach(walk);
  };
  s.orderedRootIds.forEach(walk);
  return order;
}

// The workload is shared with scripts/bench-g-doc-r.mjs. This profile keeps the pre-G-DOC-R
// meaning: the session runs the full pass in dispatch (validation "full"), so the residual
// formula below still holds.
const buildDocument = (paths) => buildWorkload(paths, { validation: "full" });

function profile(doc, name) {
  const { session, store } = doc;
  const make = doc.cmds[name];
  const rows = [];
  for (let r = 0; r < WARMUP + REPS; r++) {
    // 1. fresh state object
    session.dispatch({ type: "setArtboard", width: 1000 + ((r + 1) % 2), height: 1000 });
    const S = session.state;
    const SDerived = session.derivedOf(S);
    gc();
    // 2. real dispatch on the cold state
    const [dispatch] = time(() => session.dispatch(make()));
    if (session.state === S) throw new Error(`${name}: dispatch was a no-op`);
    // 3. undo / redo
    const [undo] = time(() => session.undo());
    const [redo] = time(() => session.redo());
    session.undo();
    if (session.state !== S) throw new Error("undo did not restore S");
    gc();
    // 4. shadow stages on a cold clone
    const C = Object.freeze({ ...S });
    const ctx = () => {
      const ids = new IdAllocator(session.nextId);
      return { store, ids, commit: (p) => store.commit(p) };
    };
    const same = { type: "setArtboard", width: C.artboard.width, height: C.artboard.height };
    // Untimed warm-up (run 2 onwards): the first large allocation after gc() was slower, which
    // made the probe exceed one-node applies (negative command medians in run 1).
    applyCommand(C, same, ctx()); // setArtboard never calls parents(): C stays cold
    const [copy] = time(() => {
      new SealedMap(C.nodesById);
      return [...C.orderedRootIds];
    });
    const [copyPublish] = time(() => applyCommand(C, same, ctx()));
    const cmdCold = make();
    const ctxCold = ctx();
    const [applyCold, next] = time(() => applyCommand(C, cmdCold, ctxCold));
    const storeCommit = name === "commitTrace" ? { ...store.lastCommitTiming } : null;
    gc();
    const [validate, derived] = time(() => validateState(next, store, session.limits));
    gc();
    const [incremental, inc] = time(() =>
      checkIncremental(C, SDerived, next, store, session.limits),
    );
    if (inc.derived) {
      const a = inc.derived;
      const sameChunks =
        a.chunks.size === derived.chunks.size &&
        [...a.chunks].every(([k, v]) => derived.chunks.get(k) === v);
      if (!sameChunks || a.anchors !== derived.anchors || a.maxIdNumber !== derived.maxIdNumber)
        throw new Error(`${name}: incremental derived data disagrees with validateState`);
    }
    gc();
    const cmdWarm = make();
    const [applyWarm] = time(() => applyCommand(C, cmdWarm, ctx()));
    store.settle(); // frees the shadow commitTrace chunks (validated above, before settling)
    const [parentsCold] = time(() => parents(Object.freeze({ ...S })));
    const [docOrder] = time(() => documentOrder(S));
    if (r < WARMUP) continue;
    rows.push({
      dispatch,
      undo,
      redo,
      copy,
      publish: copyPublish - copy,
      copyPublish,
      applyCold,
      applyWarm,
      commandCold: applyCold - copyPublish,
      commandWarm: applyWarm - copyPublish,
      validate,
      historyPublishResidual: dispatch - applyCold - validate,
      incremental,
      incrementalDecided: inc.derived ? 1 : 0,
      incrementalReason: inc.derived ? null : inc.reason,
      incDiff: inc.timing?.diffMs ?? null,
      incParents: inc.timing?.parentsMs ?? null,
      incChecks: inc.timing?.checksMs ?? null,
      parentsCold,
      documentOrder: docOrder,
      storeCommit,
    });
  }
  const out = {};
  for (const k of Object.keys(rows[0])) {
    const xs = rows.map((x) => x[k]);
    if (k === "incrementalReason") out[k] = [...new Set(xs)];
    else if (k === "storeCommit")
      out[k] = xs[0]
        ? Object.fromEntries(Object.keys(xs[0]).map((f) => [f, stats(xs.map((x) => x[f]))]))
        : null;
    else if (k === "incrementalDecided") out[k] = xs.reduce((a, b) => a + b, 0) / xs.length;
    else if (xs.every((x) => typeof x === "number")) out[k] = stats(xs);
    else out[k] = null;
  }
  out.validateShareP50 = +(out.validate.p50 / out.dispatch.p50).toFixed(3);
  out.copyPublishShareP50 = +(out.copyPublish.p50 / out.dispatch.p50).toFixed(3);
  out.commandColdShareP50 = +(out.commandCold.p50 / out.dispatch.p50).toFixed(3);
  out.historyShareP50 = +(out.historyPublishResidual.p50 / out.dispatch.p50).toFixed(3);
  return out;
}

// --- structural-sharing candidates (standalone micro-benchmark) ----------------------------------
// A two-level copy-on-write map: a directory of B native Maps, bucket = id number mod B. A
// draft copies the directory (B slots) and, on first write to a bucket, that bucket only.
class ChunkedMap {
  constructor(dir, B) {
    this.dir = dir;
    this.B = B;
    this.owned = null;
  }
  static from(m, B) {
    const dir = Array.from({ length: B }, () => new Map());
    for (const [k, v] of m) dir[Number(k.slice(4)) % B].set(k, v);
    return new ChunkedMap(dir, B);
  }
  draft() {
    const d = new ChunkedMap(this.dir.slice(), this.B);
    d.owned = new Set();
    return d;
  }
  get(k) {
    return this.dir[Number(k.slice(4)) % this.B].get(k);
  }
  set(k, v) {
    const b = Number(k.slice(4)) % this.B;
    if (!this.owned.has(b)) {
      this.dir[b] = new Map(this.dir[b]);
      this.owned.add(b);
    }
    this.dir[b].set(k, v);
  }
  *[Symbol.iterator]() {
    for (const m of this.dir) yield* m;
  }
}

function sharing(nodes) {
  const keys = [...nodes.keys()];
  const probe = Array.from({ length: 100_000 }, (_, i) => keys[(i * 7919) % keys.length]);
  const heapOf = (build) => {
    gc();
    const before = process.memoryUsage().heapUsed;
    const keep = build();
    gc();
    const bytes = process.memoryUsage().heapUsed - before;
    return [bytes, keep];
  };
  const k0 = keys[keys.length >> 1];
  const v0 = nodes.get(k0);
  const result = { nodes: nodes.size, candidates: {} };
  const native = {
    copy1Set: () => new Map(nodes).set(k0, { ...v0 }),
    get: (m) => {
      let x = 0;
      for (const k of probe) if (m.get(k)) x++;
      return x;
    },
    iterate: (m) => {
      let x = 0;
      for (const _ of m) x++;
      return x;
    },
  };
  const reps = 15;
  const run = (label, base, copy1Set, history) => {
    const copies = [];
    const gets = [];
    const its = [];
    for (let r = 0; r < reps; r++) {
      copies.push(time(copy1Set)[0]);
      gets.push(time(() => native.get(base))[0]);
      its.push(time(() => native.iterate(base))[0]);
    }
    const [bytes] = heapOf(history);
    result.candidates[label] = {
      copyOneWriteMs: stats(copies),
      get100kMs: stats(gets),
      iterateMs: stats(its),
      heapPerOneChangeStateMiB: +(bytes / 20 / 2 ** 20).toFixed(3),
    };
  };
  run("native Map (current)", nodes, native.copy1Set, () =>
    Array.from({ length: 20 }, () => new Map(nodes).set(k0, { ...v0 })),
  );
  for (const B of [256, 1024, 4096]) {
    const cm = ChunkedMap.from(nodes, B);
    const one = () => {
      const d = cm.draft();
      d.set(k0, { ...v0 });
      return d;
    };
    run(`chunked COW map, ${B} buckets`, cm, one, () => Array.from({ length: 20 }, one));
  }
  return result;
}

// --- differential record (the same harness the unit test asserts) ------------------------------
if (process.argv.includes("--differential")) {
  const { runDifferential } = await import("../src/document/testing/incremental-differential.ts");
  const seeds = arg("--seeds", "20261125").split(",").map(Number);
  const transactions = Number(arg("--transactions", "16000"));
  const runs = seeds.map((seed) => {
    const t = now();
    const s = runDifferential({ seed, transactions });
    console.error(
      `seed ${seed}: compared ${s.compared}, decided ${s.decided}, full rejected ${s.fullRejected}, ` +
        `command-rejected ${s.commandRejected}, disagreements ${s.disagreements.length}`,
    );
    // Combinations (multi-command transactions, two forgeries) are pooled to keep the record small.
    const byLabel = {};
    for (const [k, v] of Object.entries(s.byLabel)) {
      const key = !k.includes("+")
        ? k
        : k.startsWith("command:")
          ? "command:(multi)"
          : "forged:(two)";
      const a = (byLabel[key] ??= { compared: 0, fullRejected: 0, decided: 0 });
      for (const f of Object.keys(a)) a[f] += v[f];
    }
    return { ...s, byLabel, ms: +(now() - t).toFixed(1) };
  });
  const json = JSON.stringify(
    {
      script: "scripts/bench-td-perf-007.mjs --differential",
      commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      argv: process.argv.slice(2),
      node: process.version,
      runs,
    },
    null,
    2,
  );
  if (OUT) writeFileSync(OUT, json + "\n");
  else console.log(json);
  process.exit(0);
}

// --- run ----------------------------------------------------------------------------------------
const result = {
  script: "scripts/bench-td-perf-007.mjs",
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  trackedChanges:
    execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }) !==
    "",
  argv: process.argv.slice(2),
  node: process.version,
  cpu: cpus()[0]?.model,
  cpus: cpus().length,
  totalMemGiB: +(totalmem() / 2 ** 30).toFixed(1),
  gcBetweenPhases: typeof globalThis.gc === "function",
  reps: REPS,
  warmup: WARMUP,
  loadavgStart: loadavg().map((x) => +x.toFixed(2)),
  sizes: [],
};
for (const paths of SIZES) {
  const doc = buildDocument(paths);
  const entry = { ...doc.info, loadavgStart: loadavg().map((x) => +x.toFixed(2)), commands: {} };
  for (const name of Object.keys(doc.cmds)) {
    if (ONLY && !ONLY.includes(name)) continue;
    entry.commands[name] = profile(doc, name);
    const c = entry.commands[name];
    console.error(
      `${paths} ${name}: dispatch ${c.dispatch.p50} ms (validate ${c.validate.p50}, ` +
        `copy+publish ${c.copyPublish.p50}, command ${c.commandCold.p50}, ` +
        `history ${c.historyPublishResidual.p50}; incremental ${c.incremental.p50}, decided ${c.incrementalDecided})`,
    );
  }
  if (!process.argv.includes("--no-sharing")) entry.sharing = sharing(doc.session.state.nodesById);
  entry.loadavgEnd = loadavg().map((x) => +x.toFixed(2));
  result.sizes.push(entry);
}
result.loadavgEnd = loadavg().map((x) => +x.toFixed(2));
const json = JSON.stringify(result, null, 2);
if (OUT) writeFileSync(OUT, json + "\n");
else console.log(json);
