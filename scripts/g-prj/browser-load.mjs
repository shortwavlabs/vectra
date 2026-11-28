// G-PRJ-R: `.vectra` restore in the production build, per engine, separately from rendering.
//   node scripts/g-prj/browser-load.mjs [--out f.json]
// Serves dist/ with `vp preview`, loads each container written by persistence-limits.mjs
// (tests/output/g-prj/containers) through the debug-only qualification hook `loadContainerUrl`
// (the production loader), and records the hook's own load-and-validate time (taken before the
// session is shown, so rendering is excluded) and the longest main-thread frame gap until the
// hook returns (a requestAnimationFrame monitor, which works in every engine; Chromium also
// reports Long Tasks). Three repetitions, median.
import { execFileSync, spawn } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium, firefox, webkit } from "@playwright/test";

const PORT = 4183;
const BASE = `http://127.0.0.1:${PORT}`;
const arg = (n) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
// G-PRJ-0: `--dir tests/output/g-prj-0/containers` measures the v2 containers.
const DIR = arg("--dir") ?? "tests/output/g-prj/containers";
const ONLY = arg("--only")?.split(",");
const out = arg("--out");
const names = readdirSync(DIR)
  .filter((f) => f.endsWith(".vectra"))
  .map((f) => f.replace(/\.vectra$/, ""))
  .filter((n) => !ONLY || ONLY.includes(n));
const server = spawn(
  "pnpm",
  ["exec", "vp", "preview", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
  { stdio: "ignore" },
);
const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
try {
  for (
    let i = 0;
    i < 100 &&
    !(await fetch(BASE).then(
      (r) => r.ok,
      () => false,
    ));
    i++
  )
    await sleep(200);
  const sw = readFileSync("dist/sw.js", "utf8");
  const result = {
    script: "scripts/g-prj/browser-load.mjs",
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    buildId: /BUILD_ID = "([0-9a-f]+)"/.exec(sw)?.[1],
    engines: {},
  };
  for (const [engine, type] of [
    ["chromium", chromium],
    ["firefox", firefox],
    ["webkit", webkit],
  ]) {
    const browser = await type.launch();
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    await page.route("**/__g-prj/*.vectra", (r) =>
      r.fulfill({
        body: readFileSync(`${DIR}/${r.request().url().split("/").pop()}`),
        contentType: "application/octet-stream",
      }),
    );
    await page.goto(`${BASE}/workspace.html?debug=1`);
    await page.waitForFunction(() => "__vectra" in window);
    result.engines[engine] = { browserVersion: browser.version(), workloads: {} };
    for (const name of names) {
      const reps = [];
      for (let r = 0; r < 3; r++)
        reps.push(
          await page.evaluate(async (url) => {
            let last = performance.now();
            let maxGap = 0;
            let on = true;
            const tick = () => {
              const t = performance.now();
              maxGap = Math.max(maxGap, t - last);
              last = t;
              if (on) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
            let longest = null;
            let obs = null;
            if (PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
              longest = 0;
              obs = new PerformanceObserver((l) => {
                for (const e of l.getEntries()) longest = Math.max(longest, e.duration);
              });
              obs.observe({ type: "longtask" });
            }
            await new Promise((res) => setTimeout(res, 50));
            // The hook fetches the same-origin routed URL (the CSP refuses blob: fetches) and
            // reports fetch and load-and-validate separately.
            const w = window.__vectra.workspace;
            const res = await w.loadContainerUrl(url).catch((e) => ({ error: String(e) }));
            const loadMs = res.loadValidateMs ?? NaN;
            on = false;
            obs?.disconnect();
            return { loadMs, maxFrameGapMs: maxGap, longestTaskMs: longest, error: res?.error };
          }, `${BASE}/__g-prj/${name}.vectra`),
        );
      const row = {
        loadMs: +med(reps.map((x) => x.loadMs)).toFixed(1),
        maxFrameGapMs: +med(reps.map((x) => x.maxFrameGapMs)).toFixed(1),
        longestTaskMs:
          reps[0].longestTaskMs === null ? null : +med(reps.map((x) => x.longestTaskMs)).toFixed(1),
        error: reps.find((x) => x.error)?.error,
      };
      result.engines[engine].workloads[name] = row;
      console.error(`${engine} ${name}: ${JSON.stringify(row)}`);
    }
    await browser.close();
  }
  const json = JSON.stringify(result, null, 2);
  if (out) writeFileSync(out, json + "\n");
  else console.log(json);
} finally {
  server.kill();
}
