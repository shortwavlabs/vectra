// Chromium only: counts compositor DrawFrame events during a 120-frame pan (between user-timing
// marks) and compares them with rAF callbacks, to detect frames dropped behind a steady rAF.
// Usage: node run-framecheck.mjs <renderers> <kind:name,...> > out.json
import { chromium } from "@playwright/test";
const [renderers, scenes] = process.argv.slice(2);
const out = [];
const browser = await chromium.launch({ headless: false });
for (const spec of scenes.split(",")) {
  const [kind, name] = spec.split(":");
  for (const renderer of renderers.split(",")) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await browser.startTracing(page, { categories: ["devtools.timeline", "disabled-by-default-devtools.timeline.frame", "blink.user_timing", "viz", "benchmark"] });
    await page.goto(`http://127.0.0.1:4199/bench/render.html?renderer=${renderer}&kind=${kind}&name=${name}&mode=pan`);
    const done = await page.waitForFunction(() => window.__done, null, { timeout: 300000 }).then((h) => h.jsonValue());
    const trace = JSON.parse((await browser.stopTracing()).toString());
    const ev = trace.traceEvents ?? trace;
    const mark = (n) => ev.find((e) => e.name === n && (e.cat ?? "").includes("user_timing"))?.ts;
    const t0 = mark("pan-start"), t1 = mark("pan-end");
    const inWin = (e) => t0 && t1 && e.ts >= t0 && e.ts <= t1;
    const count = (n) => ev.filter((e) => e.name === n && inWin(e)).length;
    const row = { renderer, name, ok: done.ok, windowMs: t0 && t1 ? (t1 - t0) / 1000 : null, rafFrames: done.pan?.n,
      rafP50: done.pan?.p50, rafP95: done.pan?.p95, drawFrame: count("DrawFrame"), beginFrame: count("BeginFrame"),
      droppedFrame: count("DroppedFrame"), activateLayerTree: count("ActivateLayerTree") };
    out.push(row);
    console.error(JSON.stringify(row));
    await ctx.close();
  }
}
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 15000))]);
console.log(JSON.stringify(out));
process.exit(0);
