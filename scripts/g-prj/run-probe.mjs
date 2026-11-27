// G-PRJ-R: runs the storage capability probe (prototypes/g-prj/probe.html) in Playwright
// Chromium, Firefox and WebKit, and in real Safari with --safari (safaridriver; needs an
// unlocked screen). The probe page is served by the dev server only; it is never built.
//   node scripts/g-prj/run-probe.mjs [--safari] [--out f.json]
import { execFileSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium, firefox, webkit } from "@playwright/test";
import { Safari } from "../../tests/safari/webdriver.mjs";

const PORT = 5199;
const URL_ = `http://localhost:${PORT}/prototypes/g-prj/probe.html`;
const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
const server = spawn("pnpm", ["exec", "vp", "dev", "--port", String(PORT), "--strictPort"], {
  stdio: "ignore",
});
try {
  for (let i = 0; i < 100; i++) {
    const ok = await fetch(URL_).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) break;
    await sleep(200);
  }
  const result = {
    script: "scripts/g-prj/run-probe.mjs",
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    date: new Date().toISOString(),
    engines: {},
  };
  for (const [name, type] of [
    ["chromium", chromium],
    ["firefox", firefox],
    ["webkit", webkit],
  ]) {
    const browser = await type.launch();
    const page = await browser.newPage();
    await page.goto(URL_);
    await page.waitForFunction(() => "__probe" in window, null, { timeout: 120_000 });
    result.engines[name] = {
      browserVersion: browser.version(),
      ...(await page.evaluate(() => window.__probe)),
    };
    await browser.close();
    console.error(`${name}: done`);
  }
  if (process.argv.includes("--safari")) {
    const s = await Safari.open();
    try {
      await s.navigate(URL_);
      await s.waitFor(() => "__probe" in window, { timeout: 120_000, label: "probe" });
      result.engines.safari = await s.execAsync(() => window.__probe);
      result.engines.safari.browserVersion = s.capabilities?.browserVersion;
    } finally {
      await s.quit();
    }
    console.error("safari: done");
  }
  const json = JSON.stringify(result, null, 2);
  if (out) writeFileSync(out, json + "\n");
  else console.log(json);
} finally {
  server.kill();
}
