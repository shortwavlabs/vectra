// Usage: node run-offscreen.mjs <engines> <name,...> > out.json
import { chromium, firefox, webkit } from "@playwright/test";
const [engines, names, mode = "bench"] = process.argv.slice(2);
const extra = process.env.QS ?? "";
import { mkdirSync } from "node:fs";
const shotDir = new URL("../../../tests/output/rfc-002-review/correctness/", import.meta.url);
mkdirSync(shotDir, { recursive: true });
const types = { chromium, firefox, webkit }, out = [];
for (const engine of engines.split(",")) {
  const b = await types[engine].launch({ headless: false });
  for (const spec of names.split(",")) {
    const [name, z = "1"] = spec.split("@");
    const corr = mode === "correctness";
    const ctx = await b.newContext(corr ? { viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(String(e)));
    await p.goto(`http://127.0.0.1:4199/bench/offscreen.html?name=${name}&reps=6&mode=${mode}&zoom=${z}${extra}`);
    const d = await p.waitForFunction(() => window.__done, null, { timeout: 600000 }).then((h) => h.jsonValue()).catch((e) => ({ ok: false, error: String(e) }));
    if (corr && d.ok) await p.locator("#stage").screenshot({ path: new URL(`${engine}-offscreen-${name}-z${z}.png`, shotDir).pathname });
    out.push({ engine, version: b.version(), name, errors, ...d });
    console.error(engine, name, d.ok ? "ok" : d.error?.slice(0, 200));
    await ctx.close();
  }
  await Promise.race([b.close(), new Promise((r) => setTimeout(r, 15000))]);
}
console.log(JSON.stringify(out));
process.exit(0);
