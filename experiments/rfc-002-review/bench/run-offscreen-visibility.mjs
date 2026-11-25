// WebKit/Chromium/Firefox: is a worker-hosted (OffscreenCanvas) frame visible in a page
// screenshot at the bench's real backing size (DPR 2)? Counts non-white pixels.
// Usage: node run-offscreen-visibility.mjs > out.json
import { chromium, firefox, webkit } from "@playwright/test";
import { decodePng } from "./compare-renders.mjs";
const out = [];
for (const [engine, t] of [["chromium", chromium], ["firefox", firefox], ["webkit", webkit]]) {
  const b = await t.launch({ headless: false });
  for (const [zoom, dpr] of [[1, 1], [1, 2], [1.6, 1], [1.6, 2]]) {
    const ctx = await b.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: dpr });
    const p = await ctx.newPage();
    await p.goto(`http://127.0.0.1:4199/bench/offscreen.html?name=synthetic-correctness&mode=correctness&zoom=${zoom}&waitMs=1500`);
    const d = await p.waitForFunction(() => window.__done, null, { timeout: 120000 }).then((h) => h.jsonValue());
    const png = decodePng(await p.locator("#stage").screenshot());
    let nonWhite = 0;
    for (let i = 0; i < png.rgb.length; i += 3) if (png.rgb[i] < 250 || png.rgb[i + 1] < 250 || png.rgb[i + 2] < 250) nonWhite++;
    const row = { engine, version: b.version(), zoom, dpr, cssW: d.W, cssH: d.H, backingPx: Math.round(d.W * dpr) * Math.round(d.H * dpr), screenshotPx: png.w * png.h, nonWhitePx: nonWhite, nonWhiteFraction: +(nonWhite / (png.w * png.h)).toFixed(4) };
    out.push(row);
    console.error(JSON.stringify(row));
    await ctx.close();
  }
  await Promise.race([b.close(), new Promise((r) => setTimeout(r, 15000))]);
}
console.log(JSON.stringify(out, null, 1));
process.exit(0);
