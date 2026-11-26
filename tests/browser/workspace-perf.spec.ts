// G-R1 performance qualification (RFC-002 §17, C9) in the integrated workspace, production build:
//   node tests/browser/renderer/make-workloads.ts     # the registered workloads, hash-checked
//   R1_PERF=1 R1_PERF_LABEL=run-a pnpm exec playwright test tests/browser/workspace-perf.spec.ts --headed
// Workloads (tests/output/g-r1/workloads/workloads.json): the interactive target
// synthetic-many-250k (250,000 anchors, 41,853 paths), bark-1224 and bark-2350 (G-JOB registered
// colour traces), and the 977,505-anchor architecture-street-halftone (one 195k-subpath path).
// Stages are reported separately: container load and validation (G-PRJ scope), document
// evaluation, snapshot construction, geometry copy, post, path construction (renderer), the
// progressive first frame, the complete exact frame (renderer message), and the VISIBLE
// presentation: the displayed canvas sampled every animation frame until it shows the final
// frame (a worker's exact-frame message is not evidence of presentation). Preview = validated
// document available → exact frame complete (RFC §17: ≤ 100 ms at ≤ 250k anchors / ~40k paths).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { writeOutput } from "./helpers.ts";

const W = resolve(import.meta.dirname, "../output/g-r1/workloads");
const NAMES = process.env.R1_WL?.split(",") ?? [
  "synthetic-many-250k",
  "bark-1224",
  "bark-2350",
  "architecture-street-halftone",
];
test.skip(!process.env.R1_PERF, "set R1_PERF=1 (needs the local workloads; run headed)");
// Workloads are served by a page route; a service worker would fetch them itself (and offline
// behaviour is qualified elsewhere), so service workers are blocked in these runs only.
test.use({ serviceWorkers: "block" });
test.setTimeout(40 * 60_000);

const machine = () => ({
  loadavg: loadavg().map((x) => +x.toFixed(2)),
  ngspice: Number(
    execFileSync("sh", ["-c", "ps -Ao comm | grep -c ngspice || true"]).toString().trim(),
  ),
});
type Any = Record<string, unknown>;
type Api = {
  canvas: Any & {
    diag(): Any & {
      state: { kind: string };
      renderRevision: number;
      lastExact: { renderRevision: number } | null;
      camera: { scale: number; tx: number; ty: number };
      client: Any;
    };
  };
  workspace: Any;
};
const call = <T>(page: Page, path: string, ...args: unknown[]) =>
  page.evaluate(
    ([p, a]) => {
      const [ns, fn] = (p as string).split(".");
      const api = (
        window as unknown as {
          __vectra: Record<string, Record<string, (...x: unknown[]) => unknown>>;
        }
      ).__vectra;
      return api[ns!]![fn!]!(...(a as unknown[]));
    },
    [path, args] as const,
  ) as Promise<T>;
const diag = (page: Page) => call<ReturnType<Api["canvas"]["diag"]>>(page, "canvas.diag");

/** Main-thread probe: rAF gaps and long tasks while installed. */
const installMainProbe = (page: Page) =>
  page.evaluate(() => {
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
    (window as unknown as { __main: () => unknown }).__main = () => {
      cancelAnimationFrame(raf);
      obs?.disconnect();
      const g = [...p.gaps].sort((a, b) => a - b);
      return {
        frames: g.length,
        maxGapMs: g.at(-1) ?? 0,
        p95: g[Math.floor(g.length * 0.95)] ?? 0,
        longTasks: p.longTasks,
        longestTaskMs: p.longestTaskMs,
      };
    };
  });
const stopMainProbe = (page: Page) =>
  page.evaluate(() => (window as unknown as { __main: () => Any }).__main());

/** Presentation probe: a 16×16 signature of the displayed canvas, every animation frame. */
const installPresentationProbe = (page: Page) =>
  page.evaluate(() => {
    const small = new OffscreenCanvas(16, 16).getContext("2d", { willReadFrequently: true })!;
    const samples: [number, number][] = [];
    let raf = 0;
    let supported: boolean | null = null;
    const sig = () => {
      const all = document.querySelectorAll<HTMLCanvasElement>('[data-testid="vector-canvas"]');
      const c = all[all.length - 1];
      if (!c) return 0;
      small.clearRect(0, 0, 16, 16);
      try {
        small.drawImage(c, 0, 0, c.width, c.height, 0, 0, 16, 16);
      } catch {
        supported = false;
        return 0;
      }
      const d = small.getImageData(0, 0, 16, 16).data;
      let h = 2166136261;
      for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i]!, 16777619);
      if (supported === null && d.some((v) => v !== 0)) supported = true;
      return h >>> 0;
    };
    const tick = (t: number) => {
      samples.push([t, sig()]);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    (window as unknown as { __present: () => unknown }).__present = () => {
      cancelAnimationFrame(raf);
      const final = sig();
      // The first sample from which the signature stays at its final value.
      let at: number | null = null;
      for (let i = samples.length - 1; i >= 0 && samples[i]![1] === final; i--) at = samples[i]![0];
      return { supported, presentedAt: at, samples: samples.length };
    };
  });
const stopPresentationProbe = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as {
        __present: () => { supported: boolean | null; presentedAt: number | null };
      }
    ).__present(),
  );

async function settled(page: Page) {
  await expect
    .poll(
      async () => {
        const d = await diag(page);
        // The exact frame of the current revision AND the current camera.
        return (
          d.state.kind === "ready" &&
          d.lastExact?.renderRevision === d.renderRevision &&
          JSON.stringify((d.lastExact as { camera?: unknown }).camera) === JSON.stringify(d.camera)
        );
      },
      { timeout: 300_000, intervals: [20] },
    )
    .toBe(true);
}

test("G-R1 workloads: stages, presentation, gestures, drags, hit index, recovery", async ({
  browser,
  browserName,
}) => {
  const manifest = JSON.parse(readFileSync(join(W, "workloads.json"), "utf8")) as Record<
    string,
    Any
  >;
  const report: Any = {
    browser: `${browserName} ${browser.version()}`,
    viewport: null,
    dpr: 0,
    machineStart: machine(),
    workloads: {},
  };
  for (const name of NAMES) {
    // A fresh context per workload (one document per session, as a user opens it): workloads
    // measured in one shared page interfered (a later drag start took ~1 s in Chromium).
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    report.viewport = page.viewportSize();
    const file = join(W, `${name}.vectra`);
    expect(existsSync(file), file).toBe(true);
    await page.route(`**/__workloads/${name}.vectra`, (r) =>
      r.fulfill({ body: readFileSync(file), contentType: "application/octet-stream" }),
    );
    await page.goto("/workspace.html?debug=1");
    await expect.poll(() => page.evaluate(() => "__vectra" in window)).toBe(true);
    report.dpr = await page.evaluate(() => devicePixelRatio);
    await installMainProbe(page);
    // The sampler reads the displayed canvas back every frame; R1_SAMPLER=0 runs without it
    // (to check that the probe itself does not change what is measured).
    const sampling = process.env.R1_SAMPLER !== "0";
    if (sampling) await installPresentationProbe(page);
    const load = await call<{ fetchMs: number; loadValidateMs: number; loadedAt: number }>(
      page,
      "workspace.loadContainerUrl",
      `/__workloads/${name}.vectra`,
    );
    // A click before the hit index is ready (once the canvas has the document): answered by the
    // complete index, after it is built.
    const art = manifest[name] as { width: number; height: number };
    await expect
      .poll(async () => (await diag(page)).snapshots as number, { intervals: [2] })
      .toBeGreaterThan(0);
    const readyBeforeClick = (await diag(page)).hitTestReadyMs !== null;
    const cold = await call<{ id: string | null; stale: boolean; ms: number }>(
      page,
      "canvas.hitAsync",
      art.width * 0.5,
      art.height * 0.5,
    );
    await settled(page);
    const present = sampling
      ? await stopPresentationProbe(page)
      : { supported: null, presentedAt: null };
    const loadMain = await stopMainProbe(page);
    await expect
      .poll(async () => (await diag(page)).hitTestReadyMs, { timeout: 60_000 })
      .not.toBeNull();
    const d = await diag(page);
    // Warm queries on the complete index.
    const warm = await page.evaluate(
      ({ w, h }) => {
        const c = (
          window as unknown as {
            __vectra: { canvas: { hitDocument(x: number, y: number): unknown } };
          }
        ).__vectra.canvas;
        let seed = 7;
        const r = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
        const per: number[] = [];
        for (let i = 0; i < 300; i++) {
          const x = r() * w;
          const y = r() * h;
          const t = performance.now();
          for (let k = 0; k < 20; k++) c.hitDocument(x, y);
          per.push((performance.now() - t) / 20);
        }
        per.sort((a, b) => a - b);
        return { p50: per[150], p95: per[285], max: per.at(-1) };
      },
      { w: art.width, h: art.height },
    );
    // Gestures: rAF-driven pan and zoom with the main thread probed; exact settle after each.
    const gesture = async (kind: "pan" | "zoom") => {
      const r = await page.evaluate(async (k) => {
        const c = (
          window as unknown as {
            __vectra: {
              canvas: {
                diag(): { camera: { scale: number; tx: number; ty: number } };
                setView(s: number, x: number, y: number): void;
                gesture(phase: "start" | "end"): void;
              };
            };
          }
        ).__vectra.canvas;
        const gaps: number[] = [];
        const cam = c.diag().camera;
        // As a pointer or wheel gesture does: gesture start, a camera per frame (the display
        // cache), gesture end (then the exact frame).
        c.gesture("start");
        await new Promise<void>((done) => {
          let n = 0;
          let last = performance.now();
          const tick = (t: number) => {
            gaps.push(t - last);
            last = t;
            const f = k === "zoom" ? (n < 30 ? 1.02 ** (n + 1) : 1.02 ** (60 - n)) : 1;
            c.setView(
              cam.scale * f,
              cam.tx + (k === "pan" ? 4 * n : 0),
              cam.ty + (k === "pan" ? 2 * n : 0),
            );
            if (++n < 60) requestAnimationFrame(tick);
            else done();
          };
          requestAnimationFrame(tick);
        });
        const t0 = performance.now();
        c.gesture("end");
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
    };
    const pan = await gesture("pan");
    const zoom = await gesture("zoom");
    // An object drag: a path from the middle of the paint order (the halftone: its only path).
    const tree = await call<{ id: string; kind: string; children?: unknown[] }[]>(
      page,
      "workspace.tree",
    );
    const flat = (
      t: { id: string; kind: string; children?: unknown[] }[],
    ): { id: string; kind: string }[] =>
      t.flatMap((n) => [
        n,
        ...flat((n.children ?? []) as { id: string; kind: string; children?: unknown[] }[]),
      ]);
    const paths = flat(tree).filter((n) => n.kind === "path");
    const target = paths[Math.floor(paths.length / 2)]!.id;
    await installMainProbe(page);
    const framesBefore = (await diag(page)).dragFrames as number;
    // Drag start: the layers are built in the renderer, then the first pose is presented.
    const s0 = await page.evaluate(() => performance.now());
    expect(await call<boolean>(page, "canvas.beginDrag", [target])).toBe(true);
    await expect
      .poll(async () => (await diag(page)).dragFrames as number, {
        timeout: 120_000,
        intervals: [5],
      })
      .toBeGreaterThan(framesBefore);
    const dragStartMs = (await page.evaluate(() => performance.now())) - s0;
    const framesAtStart = (await diag(page)).dragFrames as number;
    const drag = await page.evaluate(
      async (scale) => {
        const c = (window as unknown as { __vectra: { canvas: { dragTo(m: number[]): void } } })
          .__vectra.canvas;
        const gaps: number[] = [];
        await new Promise<void>((done) => {
          let n = 0;
          let last = performance.now();
          const tick = (t: number) => {
            gaps.push(t - last);
            last = t;
            c.dragTo([1, 0, 0, 1, (3 * n) / scale, (2 * n) / scale]);
            if (++n < 60) requestAnimationFrame(tick);
            else done();
          };
          requestAnimationFrame(tick);
        });
        gaps.shift();
        gaps.sort((a, b) => a - b);
        return {
          p50: gaps[Math.floor(gaps.length / 2)],
          p95: gaps[Math.floor(gaps.length * 0.95)],
          max: gaps.at(-1),
        };
      },
      d.camera.scale * (report.dpr as number),
    );
    const dragMain = await stopMainProbe(page);
    // Every pose is composed: wait for the last one, and how long after the loop it arrived.
    const l0 = await page.evaluate(() => performance.now());
    await expect
      .poll(async () => (await diag(page)).dragFrames as number, {
        timeout: 120_000,
        intervals: [5],
      })
      .toBeGreaterThanOrEqual(framesAtStart + 60);
    const lastPoseLagMs = (await page.evaluate(() => performance.now())) - l0;
    const afterDrag = await diag(page);
    const t0 = await page.evaluate(() => performance.now());
    await call(page, "canvas.endDrag", true);
    await settled(page);
    const dragSettleMs = await page.evaluate((t) => performance.now() - t, t0);
    // Render-worker recovery: crash → first exact frame on the new worker.
    await call(page, "canvas.crash");
    await expect
      .poll(
        async () => ((await diag(page)).client as { lastRecoveryMs: number | null }).lastRecoveryMs,
        { timeout: 120_000 },
      )
      .not.toBeNull();
    const recovered = await diag(page);
    (report.workloads as Any)[name] = {
      ...(manifest[name] as Any),
      stages: {
        fetchMs: load.fetchMs,
        loadValidateMs: load.loadValidateMs,
        evaluateMs: d.lastEvaluateMs,
        snapshotMs: d.lastSnapshotMs,
        copyMs: d.lastCopyMs,
        postMs: d.lastPostMs,
        bytesCopied: d.bytesCopied,
        pathBuildMs: d.lastPathBuildMs,
        firstFrameMs: d.lastFirstFrameMs,
        exactFrameMs: d.lastExactFrameMs,
        exactDrawRendererMs: d.lastExactDrawMs,
        previewMs: (d.lastExactAt as number) - load.loadedAt,
        presentation: {
          sampler: !sampling
            ? "off (R1_SAMPLER=0)"
            : present.supported
              ? "displayed canvas"
              : "unsupported in this engine",
          visibleAfterLoadMs:
            present.supported && present.presentedAt !== null
              ? present.presentedAt - load.loadedAt
              : null,
          visibleAfterExactMessageMs:
            present.supported && present.presentedAt !== null
              ? present.presentedAt - (d.lastExactAt as number)
              : null,
        },
      },
      loadMainThread: loadMain,
      hitIndex: {
        readyMs: d.hitTestReadyMs,
        buildMs: d.hitTestBuildMs,
        slices: d.hitTestSlices,
        maxSliceMs: d.hitTestMaxSliceMs,
        coldClick: { ...cold, indexReadyBeforeClick: readyBeforeClick },
        warm,
      },
      pan,
      zoom,
      drag: {
        target: "a path from the middle of the paint order",
        frames: (afterDrag.dragFrames as number) - framesBefore,
        startToFirstPoseMs: dragStartMs,
        lastPoseLagAfterLoopMs: lastPoseLagMs,
        mode: afterDrag.lastDragMode,
        lastComposeMs: afterDrag.lastDragMs,
        client: {
          crashes: (afterDrag.client as Any).crashes,
          stale: (afterDrag.client as Any).staleFrames,
          staleMessages: (afterDrag.client as Any).staleMessages,
        },
        renderRevision: afterDrag.renderRevision,
        layers: (afterDrag.client as Any).dragLayers,
        layerBytes: (afterDrag.client as Any).dragLayerBytes,
        rafIntervals: drag,
        mainThread: dragMain,
        exactSettleAfterReleaseMs: dragSettleMs,
      },
      recoveryMs: (recovered.client as Any).lastRecoveryMs,
      isolation: "fresh browser context",
      host: (recovered.lastExact as { host?: string } | null)?.host ?? null,
      machine: machine(),
    };
    await context.close();
  }
  report.machineEnd = machine();
  const label = process.env.R1_PERF_LABEL ? `${process.env.R1_PERF_LABEL}-` : "";
  writeOutput(`g-r1/perf-${label}${browserName}.json`, JSON.stringify(report, null, 2));
});
