#!/usr/bin/env node
// C3 r2 (AM-1 AR-3) corpus proof: for every `<case>.scene.json` in a `packet_regression`
// output directory, the native Rust block (`<case>.packet.bin`, written by the example), the
// built WASM `sceneToPacket` block and the TypeScript `packetFromScene` block must be equal.
// Usage: node scripts/packet-determinism.mjs <packet_regression-output-dir>
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dir = process.argv[2];
const w = await import(join(root, "packages/vector-engine-wasm/pkg/vector_engine_wasm.js"));
w.initSync({
  module: readFileSync(join(root, "packages/vector-engine-wasm/pkg/vector_engine_wasm_bg.wasm")),
});
const { encodeBlock } = await import(join(root, "src/geometry/packet/codec.ts"));
const { packetFromScene } = await import(join(root, "src/geometry/packet/scene.ts"));

let same = 0;
const differ = [];
const cases = readdirSync(dir)
  .filter((f) => f.endsWith(".scene.json"))
  .sort();
for (const f of cases) {
  const c = f.slice(0, -".scene.json".length);
  const json = readFileSync(join(dir, f), "utf8");
  const native = readFileSync(join(dir, `${c}.packet.bin`));
  const ts = Buffer.from(encodeBlock(packetFromScene(JSON.parse(json))));
  const p = w.sceneToPacket(json);
  const wasm = Buffer.from(p.blockBytes());
  p.free();
  if (native.equals(ts) && native.equals(wasm)) same++;
  else differ.push(`${c}: ts ${native.equals(ts)}, wasm ${native.equals(wasm)}`);
}
console.log(
  `packet determinism: ${same}/${cases.length} scenes give identical native, WASM and TS blocks`,
);
for (const d of differ) console.log(`  differ: ${d}`);
process.exitCode = differ.length ? 1 : 0;
