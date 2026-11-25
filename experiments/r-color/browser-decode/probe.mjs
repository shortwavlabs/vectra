// R-COLOR-03: decodes the decode_inputs files in Playwright Chromium, Firefox and WebKit using
// the exact production options (src/vectorization/intake.ts): createImageBitmap(file,
// { imageOrientation: "from-image", premultiplyAlpha: "none", colorSpaceConversion: "default" }),
// drawImage into an OffscreenCanvas 2D context with no colorSpace, getImageData. It also runs
// colorSpaceConversion "none", and a display-p3 canvas where supported, for comparison.
// Usage: node experiments/r-color/browser-decode/probe.mjs <decode-dir>  (repository root)
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { chromium, firefox, webkit } from "@playwright/test";

const dir = process.argv[2] ?? "experiments/r-color/out/decode";
const expected = JSON.parse(readFileSync(`${dir}/expected.json`, "utf8"));
const files = readdirSync(dir).filter((f) => /\.(png|jpe?g)$/.test(f));
const block = expected.block;
const n = expected.patches.length;

async function decode(page, name, b64, mime) {
  return page.evaluate(
    async ({ b64, mime, block, n }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: mime });
      const sample = (ctx, opts) => {
        const out = [];
        for (let i = 0; i < n; i++) {
          const d = ctx.getImageData(i * block + block / 2, block / 2, 1, 1, opts).data;
          out.push("#" + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join(""));
        }
        return out;
      };
      const run = async (conversion, canvasSpace) => {
        try {
          const bmp = await createImageBitmap(blob, {
            imageOrientation: "from-image",
            premultiplyAlpha: "none",
            colorSpaceConversion: conversion,
          });
          const c = new OffscreenCanvas(bmp.width, bmp.height);
          const ctx = canvasSpace
            ? c.getContext("2d", { willReadFrequently: true, colorSpace: canvasSpace })
            : c.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(bmp, 0, 0);
          bmp.close();
          const attrs = ctx.getContextAttributes?.() ?? {};
          return {
            canvasColorSpace: attrs.colorSpace ?? "(not reported)",
            pixels: sample(ctx, canvasSpace ? { colorSpace: canvasSpace } : undefined),
          };
        } catch (e) {
          return { error: String(e) };
        }
      };
      return {
        production: await run("default", null),
        none: await run("none", null),
        p3Canvas: await run("default", "display-p3"),
      };
    },
    { b64, mime, block, n },
  );
}

const report = { inputs: files, browsers: [] };
// Playwright's Firefox build sets pref("gfx.color_management.mode", 0) and
// pref("gfx.color_management.rendering_intent", 3) in playwright.cfg, turning colour management
// off. "firefox-cm2" restores both to Firefox's StaticPrefList defaults (mode 2 = tagged images
// only; rendering_intent 0) so the probe reflects a normal Firefox, not the automation override.
const runs = [
  ["chromium", chromium, {}],
  ["firefox-playwright-default", firefox, {}],
  ["firefox-cm2", firefox, {
      firefoxUserPrefs: {
        "gfx.color_management.mode": 2,
        "gfx.color_management.rendering_intent": 0,
      },
    }],
  ["webkit", webkit, {}],
];
for (const [label, type, options] of runs) {
  const browser = await type.launch(options);
  const page = await browser.newPage();
  await page.setContent("<!doctype html><title>decode probe</title>");
  const results = {};
  for (const f of files) {
    const mime = f.endsWith(".png") ? "image/png" : "image/jpeg";
    results[f] = await decode(page, f, readFileSync(`${dir}/${f}`).toString("base64"), mime);
  }
  report.browsers.push({ browser: label, version: browser.version(), results });
  await browser.close();
}
report.expected = expected;
writeFileSync(`${dir}/browser-decode.json`, JSON.stringify(report, null, 2) + "\n");
console.log(`wrote ${dir}/browser-decode.json`);
