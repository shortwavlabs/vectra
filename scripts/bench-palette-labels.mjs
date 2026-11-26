// paletteLabels() cost on representative large documents (Node 24, type stripping):
//   node scripts/bench-palette-labels.mjs [--reps 30] [--only <document>] [--out file.json]
// The labels are cached per document state, so every edit (a new state) recomputes them; each
// repetition here uses a fresh state identity (same data) to measure that recomputation.
// Inputs: the registered G-R1 workloads (tests/output/g-r1/workloads, built by
// tests/browser/renderer/make-workloads.ts from hash-checked inputs; real traces carry their
// trace provenance) and a synthetic 250k-path document (no palette references: a lower bound
// for the per-path walk).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join, resolve } from "node:path";
import { GeometryStore } from "../src/document/geometry-store.ts";
import { createDocument } from "../src/document/model.ts";
import { DocumentSession } from "../src/document/session.ts";
import { TEST_PROVENANCE } from "../src/document/testing/provenance.ts";
import { syntheticPacket } from "../src/document/testing/synthetic.ts";
import { loadContainer } from "../src/persistence/container.ts";
import { paletteLabels } from "../src/shell/document.ts";

const ROOT = resolve(import.meta.dirname, "..");
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const REPS = Number(arg("--reps", "30"));
const WL = join(ROOT, "tests/output/g-r1/workloads");

// One document at a time (loaded, measured, released): together they exceed the default heap.
const builders = [
  ...["bark-1224", "bark-2350", "synthetic-many-250k", "architecture-street-halftone"].map(
    (name) => [
      name,
      async () => {
        const f = join(WL, `${name}.vectra`);
        if (!existsSync(f)) throw new Error(`missing registered workload ${f}`);
        return (await loadContainer(new Uint8Array(readFileSync(f)), {})).state;
      },
    ],
  ),
  [
    "synthetic-250k-paths (no palette refs)",
    async () => {
      const s = new DocumentSession(new GeometryStore(), {
        state: createDocument({ documentId: "bench-palette", width: 1000, height: 1000 }),
      });
      s.dispatch({
        type: "commitTrace",
        provenance: TEST_PROVENANCE,
        packet: syntheticPacket({ paths: 250_000, anchorsPerPath: 3, groups: 8, seed: 42 }),
        name: "synthetic",
      });
      return s.state;
    },
  ],
];
const results = [];
const only = arg("--only", null); // one document (a heap exhaustion ends the process)
for (const [name, build] of builders) {
  if (only && name !== only) continue;
  const state = await build();
  let paths = 0;
  let refs = 0;
  for (const n of state.nodesById.values())
    if (n.kind === "path") {
      paths++;
      if (state.stylesById.get(n.styleRef)?.paletteRef != null) refs++;
    }
  const run = () => {
    const fresh = { ...state }; // a new identity: the per-state cache misses, as after an edit
    const t0 = performance.now();
    const labels = paletteLabels(fresh);
    return [performance.now() - t0, labels];
  };
  for (let i = 0; i < 3; i++) run(); // warm-up
  const ms = [];
  let labels;
  for (let i = 0; i < REPS; i++) {
    const [t, l] = run();
    ms.push(t);
    labels = l;
  }
  ms.sort((a, b) => a - b);
  const r = {
    name,
    paths,
    pathsWithPaletteRef: refs,
    paletteEntries: state.paletteById.size,
    medianMs: +ms[Math.floor(ms.length / 2)].toFixed(3),
    p95Ms: +ms[Math.floor(ms.length * 0.95)].toFixed(3),
    maxMs: +ms[ms.length - 1].toFixed(3),
    labels: [...labels.values()],
  };
  results.push(r);
  console.log(
    `${name}: ${paths} paths (${refs} with a palette ref), ${r.paletteEntries} entries: median ${r.medianMs} ms, p95 ${r.p95Ms} ms`,
  );
}
const out = arg("--out", null);
const record = {
  node: process.version,
  cpu: cpus()[0]?.model,
  loadavg: loadavg(),
  reps: REPS,
  results,
};
if (out) writeFileSync(out, JSON.stringify(record, null, 2));
