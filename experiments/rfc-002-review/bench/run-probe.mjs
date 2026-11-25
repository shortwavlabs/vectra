// Environment probe: UA, DPR, GL renderer and rAF cadence per engine, headless and headed.
// Usage: node experiments/rfc-002-review/bench/run-probe.mjs  (server must be running on 4199)
import { chromium, firefox, webkit } from "@playwright/test";

const out = [];
for (const [name, type] of [["chromium", chromium], ["firefox", firefox], ["webkit", webkit]]) {
  for (const headless of [true, false]) {
    const browser = await type.launch({ headless });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto("http://127.0.0.1:4199/bench/probe.html");
    await page.waitForFunction(() => window.__probe, null, { timeout: 10_000 });
    out.push({ engine: name, headless, version: browser.version(), ...(await page.evaluate(() => window.__probe)) });
    await browser.close();
  }
}
console.log(JSON.stringify(out, null, 2));
