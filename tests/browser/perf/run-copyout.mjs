#!/usr/bin/env node
// Runs the worker copy-out benchmark in Chromium, Firefox and Playwright WebKit (not Safari)
// against the Vite dev server. Usage: node tests/browser/perf/run-copyout.mjs [reps=30]
import { spawn } from "node:child_process";
import { loadavg } from "node:os";
import { chromium, firefox, webkit } from "@playwright/test";

const reps = Number(process.argv[2] ?? 30);
const port = 4291;
const server = spawn(
  "pnpm",
  ["exec", "vp", "dev", "--port", String(port), "--strictPort", "--host", "127.0.0.1"],
  { stdio: "ignore" },
);
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 200));
}
const out = { loadavgStart: loadavg(), results: {} };
try {
  for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await type.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/tests/browser/perf/copyout.html?reps=${reps}`);
    await page
      .waitForFunction(() => window.__copyout !== undefined, null, { timeout: 300_000 })
      .catch((e) => {
        throw new Error(`${name}: ${e.message}; page errors: ${errors.join(" | ")}`);
      });
    out.results[name] = {
      version: browser.version(),
      ...(await page.evaluate(() => window.__copyout)),
    };
    await browser.close();
  }
} finally {
  server.kill();
}
out.loadavgEnd = loadavg();
console.log(JSON.stringify(out, null, 2));
