#!/usr/bin/env node
// P1-A end-to-end document export regression over the full corpus (local; photographic inputs
// are not committed). For every `<case>.scene.json` in a regression_corpus output directory:
// scene → packet → document commit → .vectra save (both codecs) → strict load → export draw
// list → Rust bake → scene JSON, SVG, PDF; each hash must equal a4cf172.sha256.
// Usage: node scripts/document-export-regression.mjs <regression_corpus-output-dir>
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dir = process.argv[2];
const wasm = await import(join(root, "packages/vector-engine-wasm/pkg/vector_engine_wasm.js"));
wasm.initSync({
  module: readFileSync(join(root, "packages/vector-engine-wasm/pkg/vector_engine_wasm_bg.wasm")),
});
const { documentFromScene, saveLoadExport, sha256 } = await import(
  join(root, "tests/unit/p1a-export-pipeline.ts")
);
const frozen = new Map(
  readFileSync(join(root, "docs/research/p0-r-geo/artifacts/regression/a4cf172.sha256"), "utf8")
    .trim()
    .split("\n")
    .map((l) => l.split(/\s+/).reverse()),
);
const cases = readdirSync(dir)
  .filter((f) => f.endsWith(".scene.json"))
  .map((f) => f.slice(0, -11))
  .sort();
let same = 0;
let checked = 0;
const differ = [];
const t0 = performance.now();
for (const c of cases) {
  const text = readFileSync(join(dir, `${c}.scene.json`), "utf8");
  for (const codec of ["none", "deflate-raw"]) {
    const out = await saveLoadExport(wasm, documentFromScene(wasm, text), codec);
    for (const [ext, bytes] of [
      ["scene.json", out.scene],
      ["svg", out.svg],
      ["pdf", out.pdf],
    ]) {
      checked++;
      if (sha256(bytes) === frozen.get(`${c}.${ext}`) && out.job.form === "original") same++;
      else differ.push(`${c}.${ext} (${codec})`);
    }
  }
}
const errors = [...frozen.keys()].filter((f) => f.endsWith(".error.txt")).length;
console.log(
  `document export regression: ${same}/${checked} hashes identical to a4cf172.sha256 ` +
    `(${cases.length} scenes x 3 files x 2 codecs; ${errors} over-budget error cases have no scene) in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
);
for (const d of differ) console.log(`  differ: ${d}`);
process.exitCode = differ.length ? 1 : 0;
