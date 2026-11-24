#!/usr/bin/env node
// Prints markdown tables from tests/output/native-bench/*.jsonl (native-benchmark.spec.ts).
// Usage: node scripts/summarize-native-bench.mjs [dir]
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "tests/output/native-bench");
const ms = (v) => (v === undefined || v === null ? "—" : Math.round(v).toLocaleString("en-US"));
const mib = (v) => (v ? (v / 1048576).toFixed(0) : "—");
const kb = (v) => (v ? (v / 1024 >= 1024 ? `${(v / 1048576).toFixed(1)} MB` : `${Math.round(v / 1024)} KB`) : "—");

for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort()) {
  const rows = readFileSync(join(dir, file), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  console.log(`\n### ${file.replace(".jsonl", "")}\n`);
  console.log("| Image | Mode | Decode | Pre-process | Segment | Fit (compose) | Optimize+validate | SVG | Transfer+parse | WASM call cold / warm | Preview paint | Import→visible | PDF | Anchors | Paths | SVG / PDF size | WASM mem MiB | Max frame gap proc / preview |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    if (r.error) {
      console.log(`| ${r.image} | ${r.mode} | ${r.error.replace(/\|/g, "/").replace(/^Error: /, "").slice(0, 140)} ||||||||||||||||`);
      continue;
    }
    const c = r.cold;
    const e = c.engine;
    console.log(
      `| ${r.image} | ${r.mode} | ${ms(c.decodeMs)} | ${ms(e.preprocess)} | ${ms(e.segment)} | ${ms(e.compose)} | ${ms(e.optimize + e.validate + e.scene)} | ${ms(c.svgMs)} | ${ms(c.transferAndOverheadMs)} | ${ms(c.wasmCallMs)} / ${ms(r.warm?.wasmCallMs)} | ${ms(c.previewMs)} | ${ms(c.importToVisibleMs)} | ${ms(c.pdfMs)} | ${c.stats.anchors.toLocaleString("en-US")} | ${c.stats.paths.toLocaleString("en-US")} | ${kb(c.svgBytes)} / ${kb(c.pdfBytes)} | ${mib(r.warm?.wasmMemoryBytes ?? c.wasmMemoryBytes)} | ${ms(c.processing.maxFrameGapMs)} / ${ms(c.preview?.maxFrameGapMs)} |`,
    );
  }
}
