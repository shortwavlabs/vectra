#!/usr/bin/env node
// Real Safari qualification of G-R0 against the production build (`pnpm run build` first, and
// `node tests/browser/renderer/make-fixtures.ts`):
//   node tests/safari/gr0.mjs [scenario ...]
// Correctness compares the presented canvas (element screenshot) with resvg renders of the
// engine's SVG export of each fixture document: 0 geometry-error pixels. Results:
// tests/output/safari/gr0.json.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { compare, decodePng, resvgReference } from "../browser/renderer/compare.ts";
import { DIST, ROOT, serve } from "./support.mjs";
import { Safari } from "./webdriver.mjs";

const OUT = join(ROOT, "tests/output/safari");
const FIX = join(ROOT, "tests/output/renderer-fixtures");
const WORKLOADS = join(ROOT, "tests/output/g-job-workloads");
const assert = (cond, msg) => {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const manifest = JSON.parse(readFileSync(join(FIX, "fixtures.json"), "utf8"));

const diag = (s) => s.exec(() => window.__vectra.canvas.diag());
const canvasReady = (s) =>
  s.waitFor(() => Boolean(window.__vectra && window.__vectra.canvas && window.__vectra.ready), {
    label: "canvas API",
  });
const settled = (s) =>
  s.waitFor(
    () => {
      const d = window.__vectra.canvas.diag();
      return (
        d.lastExact !== null &&
        d.lastExact.renderRevision === d.renderRevision &&
        JSON.stringify(d.lastExact.camera) === JSON.stringify(d.camera)
      );
    },
    { timeout: 120_000, interval: 20, label: "exact frame for the current camera" },
  );

async function show(s, name, scale) {
  const sessions = (await diag(s)).sessions;
  const b64 = readFileSync(join(FIX, `${name}.vectra.b64`), "utf8");
  const t0 = Date.now();
  await s.execAsync((b) => window.__vectra.canvas.showContainer(b), b64);
  await s.waitFor((n) => window.__vectra.canvas.diag().sessions > n, {
    args: [sessions],
    label: "session shown",
  });
  await s.exec((k) => window.__vectra.canvas.setView(k, 0, 0), scale);
  await settled(s);
  return t0;
}

/** Element screenshot of the canvas host, cropped to the artboard; device pixels. */
async function artboardShot(s, w, h, scale) {
  const el = await s.cmd("POST", "/element", {
    using: "css selector",
    value: "[data-testid=canvas-host]",
  });
  const id = Object.values(el)[0];
  const png = Buffer.from(await s.cmd("GET", `/element/${id}/screenshot`), "base64");
  const img = decodePng(png);
  const cssWidth = await s.exec(
    () => document.querySelector("[data-testid=canvas-host]").getBoundingClientRect().width,
  );
  const k = img.w / cssWidth; // device pixels per CSS pixel in the capture
  const cw = Math.round(w * scale * k);
  const ch = Math.round(h * scale * k);
  const px = new Uint8Array(cw * ch * 3);
  for (let y = 0; y < ch; y++)
    px.set(img.px.subarray(y * img.w * 3, y * img.w * 3 + cw * 3), y * cw * 3);
  return { w: cw, h: ch, px, k };
}

/** Polls the presented canvas until it matches `name`'s reference; returns the wait. */
async function presented(s, name, scale, timeoutMs = 15_000) {
  const f = manifest[name];
  const t0 = Date.now();
  let c;
  while (Date.now() - t0 < timeoutMs) {
    const shot = await artboardShot(s, f.width, f.height, scale);
    c = compare(resvgReference(join(FIX, `${name}.svg`), shot.w, shot.h), shot);
    if (c.geometryErrors === 0) return { waitMs: Date.now() - t0, ...c, deviceScale: shot.k };
    await sleep(100);
  }
  throw new Error(`${name} not presented within ${timeoutMs} ms: ${JSON.stringify(c)}`);
}

async function loadWorkload(s, file) {
  await s.exec(() => {
    const sel = document.querySelector("[data-testid=mode]");
    sel.value = "color";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const t0 = Date.now();
  await s.execAsync(
    async (url, name) => {
      const blob = await (await fetch(url)).blob();
      const dt = new DataTransfer();
      dt.items.add(new File([blob], name, { type: "image/png" }));
      const input = document.querySelector("[data-testid=file]");
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    `./__workloads/${file}`,
    file,
  );
  await s.waitFor(() => document.querySelector("[data-testid=status]")?.dataset.state === "done", {
    timeout: 300_000,
    label: "workload traced",
  });
  await settled(s);
  return Date.now() - t0;
}

async function gesture(s, kind) {
  return s.execAsync(async (k) => {
    const c = window.__vectra.canvas;
    const gaps = [];
    c.gesture("start");
    await new Promise((done) => {
      let n = 0;
      let last = performance.now();
      const tick = (t) => {
        gaps.push(t - last);
        last = t;
        if (k === "pan") c.panBy(4, 2);
        else c.zoomBy(n < 30 ? 1.02 : 1 / 1.02);
        if (++n < 60) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    const t0 = performance.now();
    c.gesture("end");
    await new Promise((done) => {
      const poll = () => {
        const d = c.diag();
        if (
          d.lastExact &&
          d.lastExact.renderRevision === d.renderRevision &&
          JSON.stringify(d.lastExact.camera) === JSON.stringify(d.camera)
        )
          done();
        else setTimeout(poll, 10);
      };
      poll();
    });
    const settle = performance.now() - t0;
    gaps.shift();
    gaps.sort((a, b) => a - b);
    return {
      p50: gaps[Math.floor(gaps.length / 2)],
      p95: gaps[Math.floor(gaps.length * 0.95)],
      max: gaps.at(-1),
      exactSettleMs: settle,
    };
  }, kind);
}

const scenarios = {
  async "offscreen-canvas-support"(s, site) {
    await s.navigate(`${site.origin}/?debug=1`);
    await canvasReady(s);
    const f = await s.exec(() => ({
      offscreen: typeof OffscreenCanvas === "function",
      transfer: "transferControlToOffscreen" in HTMLCanvasElement.prototype,
      offscreen2d: (() => {
        try {
          return new OffscreenCanvas(1, 1).getContext("2d") !== null;
        } catch {
          return false;
        }
      })(),
    }));
    await show(s, "synthetic-correctness", 2);
    const d = await diag(s);
    assert(
      f.offscreen && f.transfer && f.offscreen2d,
      `OffscreenCanvas features ${JSON.stringify(f)}`,
    );
    assert(
      d.host === "worker" && d.client.workersCreated === 1,
      `render worker host: ${JSON.stringify(d.client)}`,
    );
    return { features: f, host: d.host };
  },

  async "correctness-worker"(s, site) {
    return correctness(s, site, "");
  },
  async "correctness-main-thread"(s, site) {
    return correctness(s, site, "&renderer=main");
  },

  async "first-frame-latency"(s, site) {
    await s.navigate(`${site.origin}/?debug=1`);
    await canvasReady(s);
    const out = {};
    for (const name of [
      "synthetic-correctness",
      "thin_strokes-halftone-transparent",
      "multi-layer",
    ]) {
      const t0 = await show(s, name, name === "synthetic-correctness" ? 2 : 1);
      const exactMs = Date.now() - t0;
      const p = await presented(s, name, name === "synthetic-correctness" ? 2 : 1);
      out[name] = {
        showToExactMs: exactMs,
        presentedAfterExactMs: p.waitMs,
        frame: (await diag(s)).lastExactFrameMs,
      };
    }
    return out;
  },

  async recovery(s, site) {
    await s.navigate(`${site.origin}/?debug=1`);
    await canvasReady(s);
    await show(s, "thin_strokes-halftone", 1);
    const first = await presented(s, "thin_strokes-halftone", 1);
    const d0 = await diag(s);
    assert(await s.exec(() => window.__vectra.canvas.crash()), "crash injected");
    await s.waitFor(() => window.__vectra.canvas.diag().client.lastRecoveryMs !== null, {
      label: "recovered",
    });
    await settled(s);
    const again = await presented(s, "thin_strokes-halftone", 1);
    const d1 = await diag(s);
    assert(
      d1.client.crashes === 1 && d1.client.workersCreated === d0.client.workersCreated + 1,
      "recreated",
    );
    assert(d1.client.canvasesCreated === d0.client.canvasesCreated + 1, "new canvas");
    assert(d1.documentRevision === d0.documentRevision, "document unchanged");
    site.down = true; // offline: the render worker script comes from the service worker cache
    assert(await s.exec(() => window.__vectra.canvas.crash()), "second crash");
    await s.waitFor(
      () =>
        window.__vectra.canvas.diag().client.lastRecoveryMs !== null &&
        window.__vectra.canvas.diag().client.crashes === 2,
      {
        label: "recovered offline",
      },
    );
    await settled(s);
    const offline = await presented(s, "thin_strokes-halftone", 1);
    return {
      recoveryMs: d1.client.lastRecoveryMs,
      firstWait: first.waitMs,
      recoveredWait: again.waitMs,
      offlineWait: offline.waitMs,
    };
  },

  async "pan-zoom-responsiveness"(s, site) {
    await s.navigate(`${site.origin}/?debug=1`);
    await canvasReady(s);
    const out = {};
    for (const [name, file] of [
      ["interactive", "bark-1224.png"],
      ["stress", "bark-2350.png"],
    ]) {
      const loadMs = await loadWorkload(s, file);
      const d = await diag(s);
      const pan = await gesture(s, "pan");
      const zoom = await gesture(s, "zoom");
      out[name] = {
        loadMs,
        firstFrameMs: d.lastFirstFrameMs,
        exactFrameMs: d.lastExactFrameMs,
        exactDrawWorkerMs: d.lastExactDrawMs,
        prepareMs: d.lastPrepareMs,
        copyMs: d.lastCopyMs,
        pan,
        zoom,
        host: d.host,
      };
    }
    return out;
  },

  async "main-thread-fallback"(s, site) {
    await s.navigate(`${site.origin}/?debug=1&renderer=main`);
    await canvasReady(s);
    await show(s, "synthetic-correctness", 2);
    const label = await s.exec(
      () => document.querySelector("[data-testid=canvas-state]").textContent,
    );
    assert(label === "Canvas: main-thread fallback", `disclosed: ${label}`);
    const p = await presented(s, "synthetic-correctness", 2);
    return { label, presentedWait: p.waitMs };
  },
};

async function correctness(s, site, query) {
  await s.navigate(`${site.origin}/?debug=1${query}`);
  await canvasReady(s);
  const results = [];
  for (const [name, f] of Object.entries(manifest)) {
    const scale = f.width <= 200 ? 2 : 1;
    await show(s, name, scale);
    const p = await presented(s, name, scale);
    results.push({ name, scale, ...p });
  }
  return { host: (await diag(s)).host, results };
}

// --- runner -----------------------------------------------------------------------------------
const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(scenarios);
mkdirSync(OUT, { recursive: true });
const report = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim(),
  started: new Date().toISOString(),
  loadavgStart: loadavg(),
  results: [],
};
for (const name of names) {
  const site = await serve(DIST);
  if (existsSync(WORKLOADS)) cpSync(WORKLOADS, join(site.root, "__workloads"), { recursive: true });
  let s;
  const t0 = Date.now();
  const r = { name };
  try {
    s = await Safari.open();
    await s.setWindowRect(1400, 1000);
    report.safari ??= {
      version: s.capabilities.browserVersion,
      platform: `${s.capabilities.platformName} ${s.capabilities["safari:platformVersion"]} (${s.capabilities["safari:platformBuildVersion"]})`,
    };
    r.details = await scenarios[name](s, site);
    r.pass = true;
  } catch (e) {
    r.pass = false;
    r.error = String(e.stack ?? e);
    try {
      writeFileSync(join(OUT, `gr0-${name}.png`), await s.screenshot());
    } catch {}
  } finally {
    r.ms = Date.now() - t0;
    await s?.quit().catch(() => {});
    site.close();
  }
  report.results.push(r);
  console.log(
    `${r.pass ? "PASS" : "FAIL"} ${name} (${r.ms} ms)${r.pass ? "" : `\n  ${r.error.split("\n")[0]}`}`,
  );
}
report.loadavgEnd = loadavg();
writeFileSync(join(OUT, "gr0.json"), JSON.stringify(report, null, 2));
const failed = report.results.filter((r) => !r.pass).length;
console.log(
  `${report.results.length - failed}/${report.results.length} passed (Safari ${report.safari?.version})`,
);
process.exitCode = failed ? 1 : 0;
