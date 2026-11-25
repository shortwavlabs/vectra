// Drives render.html (headed browsers: headless Chromium uses SwiftShader, not the GPU).
//   bench:       node run-render.mjs bench <engines> <renderers> <kind:name,...> [reps] > out.json
//   correctness: node run-render.mjs correctness <engines> <renderers> <kind:name@zoom,...>
// Bench context: 1280×800 CSS viewport, deviceScaleFactor 2 (2560×1600 device px).
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, firefox, webkit } from "@playwright/test";

const [mode, engines, renderers, scenes, reps = "6"] = process.argv.slice(2);
const extra = process.env.QS ?? ""; // e.g. "&cache=1"
const types = { chromium, firefox, webkit };
const shotDir = new URL("../../../tests/output/rfc-002-review/correctness/", import.meta.url);
mkdirSync(shotDir, { recursive: true });
const CHECKS = {
  "synthetic-correctness": [[110, 120, 0], [310, 120, -1], [510, 120, -1], [570, 120, 2], [700, 120, 3], [700, 310, -1],
    [760, 310, 4], [140, 360, 7], [340, 330, 8], [340, 240, -1], [510, 330, 9]],
};
const out = [];
for (const engine of engines.split(",")) {
  const browser = await types[engine].launch({ headless: false });
  for (const spec of scenes.split(",")) {
    const [kn, z = "1"] = spec.split("@");
    const [kind, name] = kn.split(":");
    for (const renderer of renderers.split(",")) {
      const corr = mode === "correctness";
      const ctx = await browser.newContext(corr
        ? { viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 }
        : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      page.on("console", (m) => m.type() === "error" && !m.text().includes("favicon") && errors.push(m.text()));
      const checks = corr && CHECKS[name] ? `&checks=${encodeURIComponent(JSON.stringify(CHECKS[name]))}` : "";
      const url = `http://127.0.0.1:4199/bench/render.html?renderer=${renderer}&kind=${kind}&name=${name}&mode=${mode}&reps=${reps}&zoom=${z}${checks}${extra}`;
      const t0 = Date.now();
      let done;
      try {
        await page.goto(url);
        done = await page.waitForFunction(() => window.__done, null, { timeout: corr ? 120_000 : 900_000 }).then((h) => h.jsonValue());
      } catch (e) {
        done = { ok: false, error: `harness timeout/failure: ${String(e).split("\n")[0]}` };
      }
      if (corr && done.ok) {
        const file = `${engine}-${renderer}-${name}-z${z}.png`;
        await page.locator("#stage").screenshot({ path: new URL(file, shotDir).pathname });
        done.screenshot = file;
      }
      const row = { engine, version: browser.version(), renderer: renderer + (extra.includes("cache=1") ? "+cache" : ""), kind, name, zoom: Number(z), wallMs: Date.now() - t0, errors, ...done };
      out.push(row);
      if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(out)); // incremental
      console.error(engine, renderer, name, z, done.ok ? "ok" : done.error, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
      await ctx.close();
    }
  }
  // Headed Chromium can hang in close() after a page used WEBGL_lose_context: bound it.
  const closed = await Promise.race([browser.close().then(() => true), new Promise((r) => setTimeout(() => r(false), 15_000))]);
  if (!closed) {
    console.error(`${engine}: browser.close() timed out; killing the browser process`);
    browser.process?.()?.kill("SIGKILL");
  }
}
if (!process.env.OUT) console.log(JSON.stringify(out));
process.exit(0);
