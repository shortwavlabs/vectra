// R03 lifecycle scenarios 1–12: online, then offline (context.setOffline + reload served by the
// harness service worker). Usage: node run-lifecycle.mjs [engines] > out.json
import { chromium, firefox, webkit } from "@playwright/test";
const engines = (process.argv[2] ?? "chromium,firefox,webkit").split(",");
const types = { chromium, firefox, webkit };
const out = [];
for (const engine of engines) {
  const browser = await types[engine].launch({ headless: false });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const url = `http://127.0.0.1:4199/bench/lifecycle.html${process.env.QS ?? ""}`;
  const runOnce = async () => page.waitForFunction(() => window.__done, null, { timeout: 300_000 }).then((h) => h.jsonValue());
  await page.goto(url);
  const online = await runOnce();
  await ctx.setOffline(true);
  await page.reload();
  const offline = await runOnce();
  out.push({ engine, version: browser.version(), errors, online, offline });
  for (const [k, r] of [["online", online], ["offline", offline]]) {
    const fails = (r.log ?? []).filter((c) => !c.pass);
    console.error(engine, k, r.ok ? "ok" : r.error, `${(r.log ?? []).length - fails.length}/${(r.log ?? []).length} checks pass`, fails.map((f) => `${f.step}:${f.name}`));
  }
  await browser.close();
}
console.log(JSON.stringify(out));
