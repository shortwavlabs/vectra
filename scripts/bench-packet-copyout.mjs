#!/usr/bin/env node
// Packet copy-out benchmark (G-ENG; C9-style, Node). A synthetic gradient halftone sized to
// just under 1,000,000 anchors (one compound path) is traced by the built WASM engine, then:
//   compute  — vectorizePacket (trace + Scene → packet inside WASM, incl. the pixel copy in)
//   copyOut  — the six take*() calls (one wasm-bindgen copy each into fresh JS buffers)
//   transfer — a worker_threads round trip that transfers the six buffers and back
//   validate — main-thread validation with the production TS validator (src/geometry/packet)
// Reports median and p95 over N reps and the workload hash (SHA-256 of the C3.0 block).
// Usage: node scripts/bench-packet-copyout.mjs [reps=30] [side=2320] [pitch=5.2]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join, resolve } from "node:path";
import { Worker } from "node:worker_threads";

const root = resolve(import.meta.dirname, "..");
const [reps, side, pitch] = [
  +(process.argv[2] ?? 30),
  +(process.argv[3] ?? 2320),
  +(process.argv[4] ?? 5.2),
];
const w = await import(join(root, "packages/vector-engine-wasm/pkg/vector_engine_wasm.js"));
w.initSync({
  module: readFileSync(join(root, "packages/vector-engine-wasm/pkg/vector_engine_wasm_bg.wasm")),
});
const { validatePacket } = await import(join(root, "src/geometry/packet/validate.ts"));

const rgba = new Uint8Array(side * side * 4);
for (let y = 0; y < side; y++)
  for (let x = 0; x < side; x++) {
    const i = 4 * (y * side + x);
    const v = Math.round(40 + 160 * ((x + y) / (2 * side)));
    rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
    rgba[i + 3] = 255;
  }
const req = JSON.stringify({
  presetVersion: 1,
  seed: 1,
  maxPixels: 50_000_000,
  maxAnchors: 1_000_000,
  settings: { mode: "halftone", pitch },
});
const echo = new Worker(
  "const { parentPort } = require('node:worker_threads');" +
    "parentPort.on('message', (m) => parentPort.postMessage(m, m.arrays.map((a) => a.buffer)));",
  { eval: true },
);
const roundTrip = (msg) =>
  new Promise((res) => {
    echo.once("message", res);
    echo.postMessage(
      msg,
      msg.arrays.map((a) => a.buffer),
    );
  });

const start = loadavg();
const rows = [];
let workload = null;
let anchors = 0;
let bytes = 0;
for (let r = 0; r < reps + 1; r++) {
  let t = performance.now();
  const p = w.vectorizePacket(rgba, side, side, req);
  const compute = performance.now() - t;
  const block = r === 0 ? p.blockBytes() : null;
  const manifest = JSON.parse(p.manifestJson);
  t = performance.now();
  const arrays = [
    p.takeVerbs(),
    p.takeCoords(),
    p.takeVerbOffsets(),
    p.takeCoordOffsets(),
    p.takeStyleIndex(),
    p.takeGroupIndex(),
  ];
  const copyOut = performance.now() - t;
  p.free();
  const arrayBytes = arrays.reduce((s, a) => s + a.byteLength, 0); // before the transfer detaches them
  t = performance.now();
  const back = await roundTrip({ manifest, arrays });
  const transfer = performance.now() - t;
  const [verbs, coords, verbOffsets, coordOffsets, styleIndex, groupIndex] = back.arrays;
  t = performance.now();
  const d = validatePacket({
    manifest: back.manifest,
    verbs,
    coords,
    verbOffsets,
    coordOffsets,
    styleIndex,
    groupIndex,
  });
  const validate = performance.now() - t;
  if (r === 0) {
    workload = createHash("sha256").update(block).digest("hex");
    anchors = d.anchors;
    bytes = arrayBytes;
    continue; // warm-up
  }
  rows.push({ compute, copyOut, transfer, validate });
}
await echo.terminate();
const stat = (k) => {
  const v = rows.map((x) => x[k]).sort((a, b) => a - b);
  return {
    median: +v[Math.floor(v.length / 2)].toFixed(3),
    p95: +v[Math.ceil(0.95 * v.length) - 1].toFixed(3),
    min: +v[0].toFixed(3),
    max: +v.at(-1).toFixed(3),
  };
};
console.log(
  JSON.stringify(
    {
      node: process.version,
      cpus: cpus().length,
      loadavgStart: start,
      loadavgEnd: loadavg(),
      reps,
      workload: { side, pitch, anchors, packetBytes: bytes, blockSha256: workload },
      ms: {
        compute: stat("compute"),
        copyOut: stat("copyOut"),
        transfer: stat("transfer"),
        validate: stat("validate"),
      },
    },
    null,
    2,
  ),
);
