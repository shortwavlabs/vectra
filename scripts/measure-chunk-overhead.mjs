// G-DOC-R accounting closure: the retained heap of a committed geometry chunk beyond its
// C3.2 ledger cost (payload + manifest JSON + derived payload), measured independently of
// the calibration scenarios.
//   node --expose-gc scripts/measure-chunk-overhead.mjs [--n 400] [--reps 5] [--out f.json]
// For each packet size: commit N freshly built chunks into a fresh GeometryStore, retain them
// as history, collect, and read heapUsed + arrayBuffers. (Δheap − Σ cost) / N is the per-chunk overhead.
// The sizes span 1 to 4,000 paths: an overhead that does not grow with the size is a fixed
// per-chunk term (object headers, views, closures), not a payload term.
import { execFileSync } from "node:child_process";
import { cpus, loadavg } from "node:os";
import { writeFileSync } from "node:fs";
import { GeometryStore } from "../src/document/geometry-store.ts";
import { syntheticPacket } from "../src/document/testing/synthetic.ts";

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : d;
};
const N = Number(arg("--n", "400"));
const REPS = Number(arg("--reps", "5"));
const OUT = arg("--out", null);
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
const sorted = (xs) => [...xs].sort((a, b) => a - b);
const median = (xs) => sorted(xs)[Math.floor(xs.length / 2)];

const SIZES = [
  { paths: 1, anchorsPerPath: 4 },
  { paths: 10, anchorsPerPath: 6 },
  { paths: 100, anchorsPerPath: 6 },
  { paths: 1000, anchorsPerPath: 6 },
  { paths: 4000, anchorsPerPath: 3 },
];
const HISTORY = { kind: "history" };

const result = {
  script: "scripts/measure-chunk-overhead.mjs",
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  node: process.version,
  cpu: cpus()[0]?.model,
  loadavgStart: loadavg(),
  chunksPerRep: N,
  sizes: [],
};
/** One repetition, in its own function so nothing from it is reachable afterwards. */
async function chunkRep(size, r) {
  // Each packet is built after the first reading and dropped after its commit: the store
  // moves (transfers) its buffers, so everything still alive at the second reading is held
  // by the store. Build-time garbage is collected before that reading.
  const store = new GeometryStore();
  await collect();
  const before = heap();
  let total = 0;
  for (let i = 0; i < N; i++) {
    const id = store.commit(syntheticPacket({ ...size, groups: 4, seed: 1000 * r + i + 1 }));
    store.retain(id, HISTORY);
    total += store.cost(id);
  }
  store.settle();
  await collect();
  const after = heap();
  if (store.chunkIds().length !== N) throw new Error("chunks were freed");
  return { overhead: (after - before - total) / N, cost: total / N };
}
/** Component: a chunk holds nine typed arrays, each over its own ArrayBuffer (six sections,
 *  moved into new views at commit, and three derived arrays). Their headers alone, per chunk:
 *  nine views over 8-byte buffers, minus the payload and the holding array's slots. */
async function headerRep() {
  await collect();
  const before = heap();
  const hold = new Array(9 * N);
  for (let i = 0; i < hold.length; i++) hold[i] = new Uint32Array(new ArrayBuffer(8));
  await collect();
  return (heap() - before - hold.length * (8 + 8)) / N;
}
const summary = (xs) => ({
  median: Math.round(median(xs)),
  min: Math.round(sorted(xs)[0]),
  max: Math.round(sorted(xs).at(-1)),
});

for (const size of SIZES) {
  const reps = [];
  for (let r = 0; r < REPS; r++) reps.push(await chunkRep(size, r));
  const row = {
    ...size,
    costPerChunk: Math.round(reps[0].cost),
    overheadPerChunk: summary(reps.map((x) => x.overhead)),
  };
  result.sizes.push(row);
  console.error(JSON.stringify(row));
}
{
  const per = [];
  for (let r = 0; r < REPS; r++) per.push(await headerRep());
  result.typedArrayHeadersPerChunk = summary(per);
  console.error(
    `nine typed-array headers per chunk: ${JSON.stringify(result.typedArrayHeadersPerChunk)}`,
  );
}
result.loadavgEnd = loadavg();
const json = JSON.stringify(result, null, 2);
if (OUT) writeFileSync(OUT, json + "\n");
else console.log(json);
