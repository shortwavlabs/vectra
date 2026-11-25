// G-R0 performance (RFC-002 §17, C9) against the production build, headed:
//   R0_PERF=1 R0_PERF_LABEL=run-a pnpm exec playwright test tests/browser/renderer-perf.spec.ts --headed
// The G-JOB registered workloads (tests/output/g-job-workloads, hashed): bark-1224 (colour,
// 269,996 anchors, 16,056 paths: interactive) and bark-2350 (colour, 812,003 anchors, 43,621
// paths: stress). Stages are reported separately: scheduler/trace (worker), document
// preparation (preview commit, evaluation + snapshot), geometry transfer (render copy + post),
// renderer preparation (Path2D construction) and drawing.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { writeOutput } from "./helpers.ts";

const W = resolve(import.meta.dirname, "../output/g-job-workloads");
const WORKLOADS = [
  { name: "interactive", file: "bark-1224.png" },
  { name: "stress", file: "bark-2350.png" },
] as const;

test.skip(!process.env.R0_PERF, "set R0_PERF=1 (needs the local workloads; run headed)");
test.setTimeout(30 * 60_000);

const machine = () => ({
  loadavg: loadavg().map((x) => +x.toFixed(2)),
  ngspice: Number(
    execFileSync("sh", ["-c", "ps -Ao comm | grep -c ngspice || true"]).toString().trim(),
  ),
});

type Diag = Record<string, unknown> & {
  renderRevision: number;
  camera: { scale: number; tx: number; ty: number };
  lastExact: { renderRevision: number; camera: { scale: number; tx: number; ty: number } } | null;
};
const diag = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __vectra: { canvas: { diag(): Diag } } }).__vectra.canvas.diag(),
  );

async function settled(page: Page) {
  await expect
    .poll(
      async () => {
        const d = await diag(page);
        return (
          d.lastExact !== null &&
          d.lastExact.renderRevision === d.renderRevision &&
          JSON.stringify(d.lastExact.camera) === JSON.stringify(d.camera)
        );
      },
      { timeout: 120_000, intervals: [20] },
    )
    .toBe(true);
}

/** rAF intervals and Long Tasks while `body` runs in the page. */
const probeScript = () => {
  const p = { gaps: [] as number[], longTasks: 0, longestTaskMs: 0 };
  let last = performance.now();
  let raf = 0;
  const tick = (t: number) => {
    p.gaps.push(t - last);
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
  (window as unknown as { __probe: () => unknown }).__probe = () => {
    cancelAnimationFrame(raf);
    obs?.disconnect();
    const g = [...p.gaps].sort((a, b) => a - b);
    return {
      frames: g.length,
      maxGapMs: g.at(-1) ?? 0,
      p50: g[Math.floor(g.length * 0.5)] ?? 0,
      p95: g[Math.floor(g.length * 0.95)] ?? 0,
      longTasks: p.longTasks,
      longestTaskMs: p.longestTaskMs,
    };
  };
};
const stopProbe = (page: Page) =>
  page.evaluate(() => (window as unknown as { __probe: () => Record<string, number> }).__probe());

/** A 60-frame camera gesture driven from rAF; returns frame intervals and the exact settle. */
async function gesture(page: Page, kind: "pan" | "zoom") {
  const r = await page.evaluate(async (k) => {
    const c = (
      window as unknown as {
        __vectra: { canvas: Record<string, (...a: number[] | string[]) => unknown> };
      }
    ).__vectra.canvas;
    const gaps: number[] = [];
    c.gesture!("start");
    await new Promise<void>((done) => {
      let n = 0;
      let last = performance.now();
      const tick = (t: number) => {
        gaps.push(t - last);
        last = t;
        if (k === "pan") c.panBy!(4, 2);
        else c.zoomBy!(n < 30 ? 1.02 : 1 / 1.02);
        if (++n < 60) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    const t0 = performance.now();
    c.gesture!("end");
    gaps.shift();
    gaps.sort((a, b) => a - b);
    return {
      t0,
      p50: gaps[Math.floor(gaps.length / 2)],
      p95: gaps[Math.floor(gaps.length * 0.95)],
      max: gaps.at(-1),
    };
  }, kind);
  await settled(page);
  const settleMs = await page.evaluate((t0) => performance.now() - t0, r.t0);
  return { p50: r.p50, p95: r.p95, max: r.max, exactSettleMs: settleMs };
}

test("renderer: first frame, gestures, hit testing, copies, recovery, path scaling", async ({
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
  await page.goto("/?debug=1");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          (window as unknown as { __vectra?: { canvas?: unknown; ready?: unknown } }).__vectra
            ?.ready,
        ),
      ),
    )
    .toBe(true);
  for (const w of WORKLOADS) {
    const path = join(W, w.file);
    expect(existsSync(path), path).toBe(true);
    const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
    await page.getByTestId("mode").selectOption("color");
    await page.evaluate(probeScript);
    await page.getByTestId("file").setInputFiles(path);
    await expect(page.getByTestId("status")).toHaveAttribute("data-state", "done", {
      timeout: 300_000,
    });
    await settled(page);
    const loadProbe = await stopProbe(page);
    const last = await page.evaluate(
      () => (window as unknown as { __vectra: { last: Record<string, unknown> } }).__vectra.last,
    );
    const load = await diag(page);
    // Gestures (display cache) and exact settles, with the main thread probed throughout.
    await page.evaluate(probeScript);
    const pan = await gesture(page, "pan");
    const zoom = await gesture(page, "zoom");
    const gestureProbe = await stopProbe(page);
    // Hit testing: cold (index build + first query) and warm per-query latency.
    const hits = await page.evaluate(() => {
      const c = (
        window as unknown as {
          __vectra: {
            canvas: {
              hitDocument(x: number, y: number): unknown;
              diag(): { hitTestBuildMs: number | null };
            };
          };
        }
      ).__vectra.canvas;
      let seed = 5;
      const r = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
      const pts = Array.from({ length: 300 }, () => [r() * 1224, r() * 816] as const);
      const t0 = performance.now();
      c.hitDocument(pts[0]![0], pts[0]![1]);
      const coldMs = performance.now() - t0;
      const per: number[] = [];
      for (const [x, y] of pts) {
        const t = performance.now();
        for (let k = 0; k < 20; k++) c.hitDocument(x, y);
        per.push((performance.now() - t) / 20);
      }
      per.sort((a, b) => a - b);
      return {
        coldMs,
        buildMs: c.diag().hitTestBuildMs,
        warmP50: per[150],
        warmP95: per[285],
        warmMax: per.at(-1),
      };
    });
    // Render-worker recovery latency (crash → first exact frame on the new worker).
    await page.evaluate(() =>
      (window as unknown as { __vectra: { canvas: { crash(): boolean } } }).__vectra.canvas.crash(),
    );
    await expect
      .poll(
        async () => ((await diag(page)).client as { lastRecoveryMs: number | null }).lastRecoveryMs,
        { timeout: 120_000 },
      )
      .not.toBeNull();
    const recovered = await diag(page);
    (report.workloads as Record<string, unknown>)[w.name] = {
      file: w.file,
      sha256,
      anchors: (last.metrics as { stats: { anchors: number; paths: number } }).stats.anchors,
      paths: (last.metrics as { stats: { anchors: number; paths: number } }).stats.paths,
      stages: {
        traceWorkerMs: (last.timings as { wasmCallMs: number }).wasmCallMs,
        tracePostMs: (last.handling as { tracePostMs: number }).tracePostMs,
        previewCommitMs: (last.handling as { previewCommitMs: number }).previewCommitMs,
        snapshotPrepareMs: load.lastPrepareMs,
        renderCopyMs: load.lastCopyMs,
        renderPostMs: load.lastPostMs,
        bytesCopied: load.bytesCopied,
        firstFrameMs: load.lastFirstFrameMs,
        exactFrameMs: load.lastExactFrameMs,
        exactDrawWorkerMs: load.lastExactDrawMs,
      },
      previewMs: last.previewMs,
      importToVisibleMs: last.importToVisibleMs,
      loadMainThread: loadProbe,
      pan,
      zoom,
      gestureMainThread: gestureProbe,
      hits,
      cache: {
        workerHeld: (load.client as { workerHeld: unknown }).workerHeld,
        backingStoreBytes: await page.evaluate(() => {
          const c = document.querySelector("[data-testid=vector-canvas]") as HTMLCanvasElement;
          const r = c.getBoundingClientRect();
          return (
            Math.round(r.width * devicePixelRatio) * Math.round(r.height * devicePixelRatio) * 4 * 2
          ); // canvas + display cache
        }),
      },
      recoveryMs: (recovered.client as { lastRecoveryMs: number }).lastRecoveryMs,
      host: recovered.host,
      machine: machine(),
    };
  }
  // Path construction scaling: one path of N anchors from path data (main thread).
  report.pathScaling = await page.evaluate(() =>
    [25_000, 125_000, 250_000].map((n) => {
      const parts = ["M0 0"];
      for (let i = 1; i < n; i++) parts.push(`L${i % 1000} ${Math.floor(i / 1000)}`);
      const d = parts.join("");
      const t = performance.now();
      const p = new Path2D(d);
      const ms = performance.now() - t;
      return { anchors: n, ms, ok: p instanceof Path2D };
    }),
  );
  report.machineEnd = machine();
  const label = process.env.R0_PERF_LABEL ? `${process.env.R0_PERF_LABEL}-` : "";
  writeOutput(`g-r0/perf-${label}${browserName}.json`, JSON.stringify(report, null, 2));
});

test("main-thread fallback: the same workloads, blocking disclosed", async ({
  page,
  browserName,
}) => {
  await page.goto("/?debug=1&renderer=main");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean((window as unknown as { __vectra?: { ready?: unknown } }).__vectra?.ready),
      ),
    )
    .toBe(true);
  const out: Record<string, unknown> = {};
  for (const w of WORKLOADS) {
    await page.getByTestId("mode").selectOption("color");
    await page.evaluate(probeScript);
    await page.getByTestId("file").setInputFiles(join(W, w.file));
    await expect(page.getByTestId("status")).toHaveAttribute("data-state", "done", {
      timeout: 300_000,
    });
    await settled(page);
    const load = await stopProbe(page);
    await page.evaluate(probeScript);
    const pan = await gesture(page, "pan");
    out[w.name] = {
      load,
      pan,
      gestureMainThread: await stopProbe(page),
      host: (await diag(page)).host,
    };
  }
  const label = process.env.R0_PERF_LABEL ? `${process.env.R0_PERF_LABEL}-` : "";
  writeOutput(
    `g-r0/perf-fallback-${label}${browserName}.json`,
    JSON.stringify({ machine: machine(), ...out }, null, 2),
  );
});
