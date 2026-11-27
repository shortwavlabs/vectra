// G-PRJ-R design material: renders licensed fixture traces to project thumbnails for the mockups
// (raster UI assets derived from vector artwork; never part of any document or export).
//   EMBED_PROVENANCE_WITH=<path to impeccable> node scripts/g-prj/render-thumbs.mjs
// Each thumbnail is the artboard itself at its true aspect (the SVG's own width and height) on
// ivory #eee8d8, 960 px on the long edge (library 480), cwebp q78: no padding, so the UI draws the
// artboard edge.
// With EMBED_PROVENANCE_WITH set, each file's origin is embedded (`impeccable embed-prompt`).
// Sources: public-domain Hokusai and Talbot traces (tests/fixtures/external/SOURCES.json) and
// procedural renderer fixtures. No concert-* material.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

// 960 px for the hero's sharpness; the halftone library scan is only ever a tile, and its dots
// cost 280 KB at 960 (160 KB at 640), so it stays at 480.
const LONG = 960;
const LONG_EDGE = { library: 480 };
const GREAT_WAVE = "tests/output/g-prj/art/hokusai-great-wave-640-limited.svg";
/** @type {[name: string, file: string, origin: string, edit?: [string, string]][]} */
const ART = [
  ["great-wave", GREAT_WAVE, "Hokusai, public domain"],
  // Synthetic "recovered changes" for the recovery swap: ONE vector edit to the same trace, a
  // palette recolour (as Vectra's Recolor does): every fill #efe5ca (the cream of the sky and
  // background, 295 paths) becomes #f0cfa8 (a dusk peach). Nothing else changes.
  [
    "great-wave-recovered",
    GREAT_WAVE,
    "Hokusai, public domain; SYNTHETIC edit: palette fill #efe5ca replaced by #f0cfa8 in every path (recoloured sky)",
    ['fill="#efe5ca"', 'fill="#f0cfa8"'],
  ],
  ["library", "tests/output/g-prj/art/talbot-scene-in-a-library-640-halftone.svg", "Talbot, CC0"],
  ["rings", "tests/output/renderer-fixtures/nested_rings-color.svg", "procedural renderer fixture"],
  [
    "strokes",
    "tests/output/renderer-fixtures/thin_strokes-halftone.svg",
    "procedural renderer fixture",
  ],
  ["layers", "tests/output/renderer-fixtures/multi-layer.svg", "procedural renderer fixture"],
  [
    "mosaic",
    "tests/output/renderer-fixtures/logo_transparent_hole-mosaic.svg",
    "procedural renderer fixture",
  ],
  ["ring", "tests/output/g-prj/art/transparent_ring-color.svg", "procedural renderer fixture"],
];
const OUT = "docs/research/g-prj/mockups/thumbs";
const browser = await chromium.launch();
for (const [name, file, origin, edit] of ART) {
  let svg = readFileSync(file, "utf8");
  if (edit) {
    if (!svg.includes(edit[0])) throw new Error(`${name}: ${edit[0]} not found in ${file}`);
    svg = svg.replaceAll(edit[0], edit[1]);
  }
  const root = /<svg[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"/.exec(svg);
  if (!root) throw new Error(`${name}: no width/height on the <svg> root`);
  const [w, h] = [Number(root[1]), Number(root[2])];
  const scale = (LONG_EDGE[name] ?? LONG) / Math.max(w, h);
  const [vw, vh] = [Math.round(w * scale), Math.round(h * scale)];
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
  await page.setContent(
    `<body style="margin:0;background:#eee8d8">` +
      `<img style="display:block;width:${vw}px;height:${vh}px" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></body>`,
  );
  await page.waitForTimeout(400);
  const png = `tests/output/g-prj/art/${name}.png`;
  await page.screenshot({ path: png });
  await page.close();
  const webp = `${OUT}/${name}.webp`;
  execFileSync("cwebp", ["-quiet", "-q", "78", png, "-o", webp]);
  // Not IMPECCABLE_BIN: the impeccable launcher execs that variable itself.
  if (process.env.EMBED_PROVENANCE_WITH)
    execFileSync(
      process.env.EMBED_PROVENANCE_WITH,
      [
        "embed-prompt",
        webp,
        "--prompt",
        `Origin: not generated. Rendered by scripts/g-prj/render-thumbs.mjs (Playwright Chromium) from ${file} (${origin}): the artboard at its true aspect (${w} x ${h}) on ivory #eee8d8, ${vw} x ${vh} px, cwebp q78. Derived UI thumbnail for G-PRJ-R mockups only.`,
      ],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
  console.error(`${name}: ${vw} x ${vh}`);
}
await browser.close();
