// Usage: node run-rastercheck.mjs > out.json
import { chromium, firefox, webkit } from "@playwright/test";
const out = [];
for (const [engine, t] of [["chromium", chromium], ["firefox", firefox], ["webkit", webkit]]) {
  const b = await t.launch({ headless: false });
  const p = await b.newPage();
  await p.goto("http://127.0.0.1:4199/bench/rastercheck.html");
  const d = await p.waitForFunction(() => window.__done, null, { timeout: 600000 }).then((h) => h.jsonValue());
  out.push({ engine, version: b.version(), ...d });
  console.error(engine, JSON.stringify(d.results.map((r) => [r.name, +r.A_tenDrawsOneReadbackPerDrawMs.toFixed(1), +r.B_readbackEveryDrawMs.toFixed(1), +r.C_cpuCanvasPerDrawMs.toFixed(1)])));
  await b.close();
}
console.log(JSON.stringify(out));
