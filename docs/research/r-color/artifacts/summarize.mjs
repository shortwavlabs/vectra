// Prints the R-COLOR summary figures quoted in the reports from the committed artifacts, so every
// number in the tables can be traced back to a JSON file. Read-only; no network.
// Usage: node docs/research/r-color/artifacts/summarize.mjs
import { readFileSync } from "node:fs";

const dir = new URL(".", import.meta.url);
const load = (path) => JSON.parse(readFileSync(new URL(path, dir), "utf8"));

const cmm = load("cmm/cmm-comparison.json");
const tetra = load("cmm/cmm-comparison-tetrahedral.json");
console.log("sRGB -> CMYK, relative colorimetric, dE00 vs Little CMS float (mean / p95 / max):");
for (const [name, source] of [
  ["trilinear", cmm],
  ["tetrahedral", tetra],
]) {
  const engines = source.cmyk.find((c) => c.intent === "relative").engines;
  for (const [engine, v] of Object.entries(engines)) {
    const d = v.dE00VsLcmsFloat;
    console.log(
      `  ${name.padEnd(11)} ${engine.padEnd(18)} ${d.mean} / ${d.p95} / ${d.max}` +
        `  ink ${v.maxChannelDiffPercentInk}%  black ${v.watchCmykPercent.black.join("/")}`,
    );
  }
}
const g = cmm.gamutRelativeColorimetric;
console.log(
  `gamut: ${g.lcmsGamutAlarm}/${g.patches} Little CMS alarms; ${g.roundTripDE00Over2} over dE00 2; ` +
    `agreement ${g.alarmAndOver2Agree}/${g.patches}`,
);

const wasm = load("cmm/wasm-check.json");
console.log(
  `wasm: ${wasm.wasm.rawBytes} B raw, ${wasm.wasm.brotli11Bytes} B brotli; ` +
    `1 MP sRGB->CMYK ${wasm.throughput.ms} ms`,
);
for (const c of wasm.comparisons) {
  console.log(
    `  ${c.nativeSimd ? "neon  " : "scalar"} ${c.key.padEnd(22)} ${c.bitIdentical}/${c.values}`,
  );
}

const pdf = load("pdf/pdf-proto.json");
for (const v of pdf.variants) {
  console.log(
    `pdf ${v.variant.padEnd(20)} ${v.bytes} B  geometry-differing tokens: ${v.differingTokens ?? "-"}`,
  );
}
for (const o of pdf.translucentOverlaps) {
  console.log(
    `overlap ${o.overlap.padEnd(15)} CMYK composite vs sRGB preview dE00 ${o.dE00_cmykComposite_vs_srgbPreview}`,
  );
}

for (const r of load("fuzz/icc-fuzz.json")) {
  console.log(
    `fuzz ${r.base}: inspect rejected ${r.inspectIccRejected}/${r.cases}; moxcms panics ${r.moxcms.panicsCaught}; ` +
      `Little CMS parsed ${r.littleCms.parsed}`,
  );
}
