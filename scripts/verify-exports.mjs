#!/usr/bin/env node
// Independent inspection of exported PDFs (and their sibling SVGs) with third-party tools:
//   qpdf --check, qpdf --json (every object, incl. nested resources), pdfimages -list,
//   MediaBox vs expected size, pdftoppm (poppler) render vs resvg render of the SVG.
// Usage: node scripts/verify-exports.mjs <dir> [--width-mm 150] [--dpi 150] [--report out.tsv]
// Requires qpdf and poppler-utils on PATH, and `cargo build --release -p vector-engine --example render_compare`.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const args = process.argv.slice(2);
const dir = resolve(args[0] ?? "tests/output/native");
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const widthMm = Number(opt("--width-mm", "150"));
const dpi = Number(opt("--dpi", "150"));
const report = opt("--report", null);
const compareBin = resolve(import.meta.dirname, "../target/release/examples/render_compare");
const sh = (cmd, a) => execFileSync(cmd, a, { encoding: "utf8", maxBuffer: 1 << 30 });

const FORBIDDEN = [
  "/Image",
  "/XObject",
  "/Pattern",
  "/Shading",
  "/Font",
  "/JavaScript",
  "/JS",
  "/EmbeddedFile",
  "/URI",
];
const rows = [];
let failures = 0;
const tmp = mkdtempSync(join(tmpdir(), "vectra-verify-"));
for (const file of readdirSync(dir)
  .filter((f) => f.endsWith(".pdf"))
  .sort()) {
  const pdf = join(dir, file);
  const row = { file, problems: [] };
  try {
    sh("qpdf", ["--check", pdf]);
  } catch (e) {
    row.problems.push(`qpdf --check: ${String(e.stdout ?? e).split("\n")[0]}`);
  }
  const json = JSON.parse(sh("qpdf", ["--json=2", "--json-key=qpdf", "--decode-level=none", pdf]));
  const objects = json.qpdf[1];
  const text = JSON.stringify(objects);
  for (const f of FORBIDDEN)
    if (text.includes(`"${f}"`)) row.problems.push(`object scan found ${f}`);
  row.objects = Object.keys(objects).length;
  const images = spawnSync("pdfimages", ["-list", pdf], { encoding: "utf8" })
    .stdout.trim()
    .split("\n")
    .slice(2)
    .filter(Boolean).length;
  row.pdfimages = images;
  if (images !== 0) row.problems.push(`pdfimages lists ${images} images`);
  const pages = Object.values(objects).filter((o) => o.value?.["/Type"] === "/Page");
  if (pages.length !== 1) row.problems.push(`${pages.length} pages`);
  const box = pages[0]?.value?.["/MediaBox"] ?? [];
  const expectedW = (widthMm * 72) / 25.4;
  row.mediaBox = box.map((v) => Number(v).toFixed(2)).join(" ");
  if (Math.abs(Number(box[2]) - expectedW) > 0.1)
    row.problems.push(`MediaBox width ${box[2]} != ${expectedW.toFixed(2)}`);
  // Content-stream operators (decompressed by qpdf).
  const qdf = join(tmp, "qdf.pdf");
  sh("qpdf", ["--qdf", "--object-streams=disable", pdf, qdf]);
  const ops = new Set(
    readFileSync(qdf, "latin1")
      .split(/stream\r?\n/)
      .slice(1)
      .map((s) => s.split(/endstream/)[0])
      .join(" ")
      .split(/\s+/)
      .filter((t) => /^[A-Za-z*]+$/.test(t)),
  );
  row.operators = [...ops].sort().join(",");
  // Render comparison against the SVG sibling.
  const svg = pdf.replace(/\.pdf$/, ".svg");
  if (existsSync(svg) && existsSync(compareBin)) {
    const stem = join(tmp, basename(file, ".pdf"));
    sh("pdftoppm", ["-r", String(dpi), "-singlefile", pdf, stem]);
    const [mean, max, pctOver, block32] = sh(compareBin, [svg, `${stem}.ppm`])
      .trim()
      .split(" ");
    Object.assign(row, {
      meanAbsDiff: mean,
      maxDiff: max,
      pctPxOver32: pctOver,
      block32MeanAbsDiff: block32,
    });
    // Geometry/tone check on 32×32 block averages (per-pixel AA differs between renderers).
    if (Number(block32) > 2) row.problems.push(`block-averaged render diff ${block32}`);
  }
  row.bytes = readFileSync(pdf).length;
  if (row.problems.length) failures++;
  rows.push(row);
}
rmSync(tmp, { recursive: true, force: true });

const cols = [
  "file",
  "bytes",
  "objects",
  "pdfimages",
  "mediaBox",
  "meanAbsDiff",
  "maxDiff",
  "pctPxOver32",
  "block32MeanAbsDiff",
  "operators",
  "problems",
];
const tsv =
  [
    cols.join("\t"),
    ...rows.map((r) =>
      cols.map((c) => (Array.isArray(r[c]) ? r[c].join("; ") : (r[c] ?? ""))).join("\t"),
    ),
  ].join("\n") + "\n";
if (report) writeFileSync(report, tsv);
process.stdout.write(tsv);
const poppler =
  spawnSync("pdftoppm", ["-v"], { encoding: "utf8" }).stderr.match(/\d+\.\d+\.\d+/)?.[0] ?? "?";
console.error(
  `${rows.length} PDFs checked in ${dir}; ${failures} with problems. ${sh("qpdf", ["--version"]).split("\n")[0]}; poppler ${poppler}`,
);
process.exit(failures ? 1 : 0);
