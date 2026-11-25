// Usage: node experiments/rfc-002-review/bench/run-path2d-scaling.mjs > out.json
import { chromium, firefox, webkit } from "@playwright/test";
const res = [];
for (const [n, t] of [["chromium", chromium], ["firefox", firefox], ["webkit", webkit]]) {
  const b = await t.launch({ headless: false });
  const p = await b.newPage();
  await p.goto("http://127.0.0.1:4199/bench/path2d-scaling.html");
  const d = await p.waitForFunction(() => window.__done, null, { timeout: 600000 }).then((h) => h.jsonValue());
  for (const r of d) console.error(n, JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, +v.toFixed(2)]))));
  res.push({ engine: n, version: b.version(), rows: d });
  await b.close();
}
console.log(JSON.stringify(res, null, 1));
