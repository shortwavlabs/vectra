// G-DOC local performance benchmark (Node; main thread). Not part of `vp test`.
//   node docs/research/g-doc/bench/bench.mjs [--reps N] [--out path.json]
// Measures, at 1M anchors (C3.2 product cap):
//   1. GeometryStore.commit: move, validate+derive, publish (C9 "Store commit"), plus
//      copyIncoming separately. NOTE: validation uses the TEST-ONLY adapter's validator;
//      re-measure at P1-A integration with G-ENG's production validator.
//   2. Structural undo/redo (and, for information, the command dispatch itself).
//   3. Opening a 1M-anchor container (loadContainer), codecs deflate-raw and none.
// Records node version and load averages; the caller records `uptime` and the ngspice count.
import { TEST_PROVENANCE } from "../../../../src/document/testing/provenance.ts";
import { createHash } from "node:crypto";
import { encodeRecord } from "../../../../src/document/packet-port.ts";
import { writeFileSync } from "node:fs";
import { loadavg, cpus, totalmem } from "node:os";
import { copyIncoming, GeometryStore } from "../../../../src/document/geometry-store.ts";
import { createDocument } from "../../../../src/document/model.ts";
import { DocumentSession } from "../../../../src/document/session.ts";
import { syntheticPacket } from "../../../../src/document/testing/synthetic.ts";
import { loadContainer, saveContainer } from "../../../../src/persistence/container.ts";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const REPS = Number(arg("--reps", "7"));
const OUT = arg("--out", null);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(0.95 * xs.length) - 1)];
const stats = (xs) => ({
  n: xs.length,
  median: +median(xs).toFixed(3),
  p95: +p95(xs).toFixed(3),
  min: +Math.min(...xs).toFixed(3),
  max: +Math.max(...xs).toFixed(3),
});
const now = () => performance.now();

const ALL_CONFIGS = [
  { name: "A", paths: 50_000, anchorsPerPath: 20, groups: 8 },
  { name: "B", paths: 250_000, anchorsPerPath: 4, groups: 8 },
  // The interactive target (RFC §8.8): ~250k anchors and ~40k paths.
  { name: "I", paths: 41_666, anchorsPerPath: 6, groups: 8 },
];
const only = arg("--configs", "A,B,I").split(",");
const CONFIGS = ALL_CONFIGS.filter((c) => only.includes(c.name));

const result = {
  node: process.version,
  cpu: cpus()[0]?.model,
  cpus: cpus().length,
  totalMemGiB: +(totalmem() / 2 ** 30).toFixed(1),
  loadavgStart: loadavg().map((x) => +x.toFixed(2)),
  reps: REPS,
  validator: "production (src/geometry/packet via src/document/packet-port.ts)",
  configs: [],
};

for (const cfg of CONFIGS) {
  const make = () => syntheticPacket({ ...cfg, seed: 42 });
  const probe = make();
  const m = probe.manifest;
  const out = {
    config: cfg.name,
    P: m.pathCount,
    V: m.verbCount,
    C: m.coordCount,
    anchors: cfg.paths * cfg.anchorsPerPath,
    packetBytes: m.verbCount + 8 * m.coordCount + 16 * m.pathCount + 8,
    // Workload hash: SHA-256 of the packet's C3.0 geometry record (seeded generator).
    workloadSha256: createHash("sha256").update(encodeRecord(probe.manifest, probe)).digest("hex"),
  };

  // 1. commit (fresh packet per rep; generation not timed)
  const move = [];
  const validate = [];
  const publish = [];
  const total = [];
  const copy = [];
  for (let r = 0; r < REPS + 1; r++) {
    const store = new GeometryStore();
    const p = make();
    const t0 = now();
    store.commit(p);
    const t1 = now();
    const c0 = now();
    copyIncoming(probe);
    const c1 = now();
    if (r === 0) continue; // warm-up
    const t = store.lastCommitTiming;
    move.push(t.moveMs);
    validate.push(t.validateMs);
    publish.push(t.publishMs);
    total.push(t1 - t0);
    copy.push(c1 - c0);
  }
  out.commit = {
    moveMs: stats(move),
    validateAndDeriveMs: stats(validate),
    publishMs: stats(publish),
    totalMs: stats(total),
    copyIncomingMs: stats(copy),
    budgetMs: 50,
  };

  // 2. structural undo/redo on a document holding the 1M-anchor trace
  const store = new GeometryStore();
  const session = new DocumentSession(store, {
    state: createDocument({ documentId: "bench", width: 1000, height: 1000 }),
  });
  const tc0 = now();
  session.dispatch({ type: "commitTrace", packet: make(), provenance: TEST_PROVENANCE });
  out.commitTraceDispatchMs = +(now() - tc0).toFixed(3);
  out.nodes = session.state.nodesById.size;
  const layer = session.state.orderedRootIds[0];
  const group = session.state.nodesById.get(layer).orderedChildIds[0];
  const path = session.state.nodesById.get(group).orderedChildIds[0];
  const commands = {
    transformLayer: { type: "applyTransform", ids: [layer], matrix: [1, 0, 0, 1, 3, 4] },
    renamePath: { type: "rename", id: path, name: "p" },
    hideGroup: { type: "setVisible", ids: [group], visible: false },
    recolourPath: { type: "setFill", ids: [path], fill: { color: 0xff0000ff } },
    deleteGroup: { type: "delete", ids: [group] },
  };
  out.structural = {};
  for (const [name, cmd] of Object.entries(commands)) {
    const dispatch = [];
    const undo = [];
    const redo = [];
    for (let r = 0; r < REPS + 1; r++) {
      const d0 = now();
      session.dispatch(cmd);
      const d1 = now();
      session.undo();
      const d2 = now();
      session.redo();
      const d3 = now();
      session.undo();
      if (r === 0) continue;
      dispatch.push(d1 - d0);
      undo.push(d2 - d1);
      redo.push(d3 - d2);
    }
    out.structural[name] = {
      dispatchMs: stats(dispatch),
      undoMs: stats(undo),
      redoMs: stats(redo),
    };
  }
  out.structuralBudgetMs = 16;

  // 3. open a 1M-anchor container
  out.open = {};
  for (const codec of ["deflate-raw", "none"]) {
    const s0 = now();
    const bytes = await saveContainer(session, { codec });
    const saveMs = now() - s0;
    const open = [];
    for (let r = 0; r < Math.max(3, Math.ceil(REPS / 2)) + 1; r++) {
      const o0 = now();
      await loadContainer(bytes, {});
      if (r > 0) open.push(now() - o0);
    }
    out.open[codec] = {
      fileBytes: bytes.length,
      saveMs: +saveMs.toFixed(1),
      openMs: stats(open),
      budgetMs: 1000,
    };
  }
  result.configs.push(out);
  console.error(`config ${cfg.name} done`);
}
result.loadavgEnd = loadavg().map((x) => +x.toFixed(2));
const json = JSON.stringify(result, null, 2);
if (OUT) writeFileSync(OUT, json + "\n");
console.log(json);
