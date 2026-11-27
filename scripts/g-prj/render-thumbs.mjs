// G-PRJ-R design material: renders licensed fixture traces to small project thumbnails for the
// mockups (raster UI assets derived from vector artwork; never part of any document or export).
//   node scripts/g-prj/render-thumbs.mjs
// Sources: public-domain Hokusai and Talbot traces (tests/fixtures/external/SOURCES.json) and
// procedural renderer fixtures. No concert-* material.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const ART = [
  ["great-wave", "tests/output/g-prj/art/hokusai-great-wave-640-limited.svg"],
  ["library", "tests/output/g-prj/art/talbot-scene-in-a-library-640-halftone.svg"],
  ["rings", "tests/output/renderer-fixtures/nested_rings-color.svg"],
  ["strokes", "tests/output/renderer-fixtures/thin_strokes-halftone.svg"],
  ["layers", "tests/output/renderer-fixtures/multi-layer.svg"],
  ["mosaic", "tests/output/renderer-fixtures/logo_transparent_hole-mosaic.svg"],
  ["ring", "tests/output/g-prj/art/transparent_ring-color.svg"],
];
const OUT = "docs/research/g-prj/mockups/thumbs";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 });
for (const [name, file] of ARTS()) {
  const svg = readFileSync(file, "utf8");
  await page.setContent(
    `<body style="margin:0;background:#eee8d8;display:grid;place-items:center;width:640px;height:480px">` +
      `<img style="max-width:600px;max-height:440px" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></body>`,
  );
  await page.waitForTimeout(300);
  const png = `tests/output/g-prj/art/${name}.png`;
  await page.screenshot({ path: png });
  execFileSync("cwebp", [
    "-quiet",
    "-q",
    "78",
    "-resize",
    "480",
    "0",
    png,
    "-o",
    `${OUT}/${name}.webp`,
  ]);
  console.error(name);
}
await browser.close();
function ARTS() {
  return ART;
}
