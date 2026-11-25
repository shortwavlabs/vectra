// Drives transport.html in Chromium, Firefox and WebKit (headed). Usage:
//   node experiments/rfc-002-review/bench/run-transport.mjs [engines=chromium,firefox,webkit] > out.json
import { chromium, firefox, webkit } from "@playwright/test";
import { SCENES } from "./transport-node.mjs";

const engines = (process.argv[2] ?? "chromium,firefox,webkit").split(",");
const types = { chromium, firefox, webkit };
const out = [];
for (const engine of engines) {
  const browser = await types[engine].launch({ headless: false });
  for (const [kind, name] of SCENES) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(`http://127.0.0.1:4199/bench/transport.html?kind=${kind}&name=${name}&reps=6`);
    const done = await page.waitForFunction(() => window.__done, null, { timeout: 300_000 }).then((h) => h.jsonValue());
    out.push({ engine, version: browser.version(), kind, name, errors, ...done });
    console.error(engine, name, done.ok ? "ok" : done.error);
    await page.close();
  }
  await browser.close();
}
console.log(JSON.stringify(out));
