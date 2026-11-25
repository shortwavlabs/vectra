// G-JOB performance (RFC-002 §17, C9) against the production build, headed:
//   GJOB_PERF=1 pnpm exec playwright test tests/browser/jobs-perf.spec.ts --headed
// Measures, per engine, the attributable main-thread blocking of job handling (the job copy and
// post, the commit transaction, the export snapshot, and the rAF/Long Tasks probes around each
// job) and cancellation acknowledgement, at the interactive target and at the 1M-anchor stress
// level, plus a 23.5 MP source copy. Workloads are hashed local files (tests/output, not in git):
// see tests/output/g-job-workloads and the G-JOB report for how they were made.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { waitForState, writeOutput } from "./helpers.ts";
import {
  api,
  diag,
  jobId,
  openWorkbench,
  outcome,
  type Summary,
  waitForStage,
} from "./jobs-helpers.ts";

const W = resolve(import.meta.dirname, "../output/g-job-workloads");
const WORKLOADS = [
  { name: "interactive", file: "bark-1224.png", mode: "color", reps: 5, maxPixels: 12_000_000 },
  { name: "stress-1M", file: "bark-2350.png", mode: "color", reps: 3, maxPixels: 12_000_000 },
  {
    name: "source-23.5MP",
    file: "portrait-large-q90.jpg",
    mode: "bw",
    reps: 3,
    maxPixels: 50_000_000,
  },
] as const;

test.skip(!process.env.GJOB_PERF, "set GJOB_PERF=1 (needs the local workloads; run headed)");
test.setTimeout(30 * 60_000);

const machine = () => ({
  loadavg: loadavg().map((x) => +x.toFixed(2)),
  ngspice: Number(
    execFileSync("sh", ["-c", "ps -Ao comm | grep -c ngspice || true"]).toString().trim(),
  ),
});

async function startProbe(page: Page) {
  await page.evaluate(() => {
    const p = { maxFrameGapMs: 0, frames: 0, longTasks: 0, longestTaskMs: 0 };
    let last = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      p.maxFrameGapMs = Math.max(p.maxFrameGapMs, t - last);
      p.frames++;
      last = t;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    let obs: PerformanceObserver | null = null;
    if (PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
      obs = new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          p.longTasks++;
          p.longestTaskMs = Math.max(p.longestTaskMs, e.duration);
        }
      });
      obs.observe({ type: "longtask" });
    }
    (window as unknown as { __probe: () => typeof p }).__probe = () => {
      cancelAnimationFrame(raf);
      obs?.disconnect();
      return p;
    };
  });
}
const stopProbe = (page: Page) =>
  page.evaluate(() => (window as unknown as { __probe: () => Record<string, number> }).__probe());

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const max = (xs: number[]) => Math.max(...xs);

test("job handling: main-thread blocking and cancel acknowledgement", async ({
  page,
  context,
  browserName,
}) => {
  const report: Record<string, unknown> = {
    browser: `${browserName} ${context.browser()?.version()}`,
    viewport: page.viewportSize(),
    dpr: await page.evaluate(() => devicePixelRatio),
    machineStart: machine(),
    workloads: {},
  };
  await openWorkbench(page, context, false);
  // Any navigation or renderer crash after this point invalidates the run: record it.
  const events: string[] = [];
  page.on(
    "framenavigated",
    (f) => f === page.mainFrame() && events.push(`navigated ${f.url()} at ${Date.now()}`),
  );
  page.on("crash", () => events.push(`renderer crashed at ${Date.now()}`));
  page.on("console", (m) => m.type() === "error" && events.push(`console error: ${m.text()}`));
  page.on("pageerror", (e) => events.push(`page error: ${e.message}`));
  report.events = events;
  for (const w of WORKLOADS) {
    const path = join(W, w.file);
    expect(existsSync(path), path).toBe(true);
    const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
    await page.getByTestId("max-pixels").selectOption(String(w.maxPixels));
    await page.getByTestId("mode").selectOption(w.mode); // the workbench preview traces the same workload
    await page.getByTestId("file").setInputFiles(path);
    await waitForState(page, "done", 300_000); // the workbench's own preview (trace + SVG)
    const preview = await page.evaluate(
      () => (window as unknown as { __vectra: { last: unknown } }).__vectra.last,
    );
    const runs: (Summary & { probe: Record<string, number> })[] = [];
    for (let r = 0; r < w.reps; r++) {
      expect(
        events.filter((e) => !e.startsWith("console")),
        events.join("\n"),
      ).toEqual([]);
      await startProbe(page);
      const s = await outcome(page, jobId(await api(page, "final", { mode: w.mode })));
      runs.push({ ...s, probe: await stopProbe(page) });
      expect(s.status, JSON.stringify(s)).toBe("committed");
      // Undo, so every repetition commits into the same document (one layer at most: the
      // document's 1M-anchor cap refuses a fourth interactive-size layer with `budget`). The
      // next commit drops the redo entry, so history does not accumulate geometry.
      if (r < w.reps - 1) expect(await api<boolean>(page, "undo")).toBe(true);
    }
    await startProbe(page);
    const exp = await outcome(page, jobId(await api(page, "exportDocument", "svg")));
    const exportProbe = await stopProbe(page);
    // Cancel during fitting (a running WASM call), acknowledged on the main thread.
    const c = jobId(await api(page, "final", { mode: w.mode }));
    await waitForStage(page, c, "fit");
    const ack = await api<{ ok: boolean; ackMs: number }>(page, "cancel", c);
    (report.workloads as Record<string, unknown>)[w.name] = {
      file: w.file,
      sha256,
      mode: w.mode,
      anchors: runs[0]!.anchors,
      preview,
      finals: runs,
      summary: {
        postMs: {
          median: median(runs.map((x) => x.postMs!)),
          max: max(runs.map((x) => x.postMs!)),
        },
        commitMs: {
          median: median(runs.map((x) => x.commitMs!)),
          max: max(runs.map((x) => x.commitMs!)),
        },
        workerMs: { median: median(runs.map((x) => x.workerMs!)) },
        maxFrameGapMs: {
          median: median(runs.map((x) => x.probe.maxFrameGapMs!)),
          max: max(runs.map((x) => x.probe.maxFrameGapMs!)),
        },
        longestTaskMs: max(runs.map((x) => x.probe.longestTaskMs!)),
      },
      export: { ...exp, probe: exportProbe },
      cancel: ack,
      machine: machine(),
    };
  }
  report.diag = await diag(page);
  report.machineEnd = machine();
  const label = process.env.GJOB_PERF_LABEL ? `${process.env.GJOB_PERF_LABEL}-` : "";
  writeOutput(`g-job/perf-${label}${browserName}.json`, JSON.stringify(report, null, 2));
});
