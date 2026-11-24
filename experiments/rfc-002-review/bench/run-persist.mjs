// Usage: node run-persist.mjs > out.json
import { chromium, firefox, webkit } from "@playwright/test";
const out = [];
for (const [engine, t] of [["chromium", chromium], ["firefox", firefox], ["webkit", webkit]]) {
  const b = await t.launch({ headless: false });
  const p = await b.newPage();
  await p.goto("http://127.0.0.1:4199/bench/persist.html");
  const d = await p.waitForFunction(() => window.__done, null, { timeout: 300000 }).then((h) => h.jsonValue());
  out.push({ engine, version: b.version(), ...d });
  await b.close();
}
console.log(JSON.stringify(out));
