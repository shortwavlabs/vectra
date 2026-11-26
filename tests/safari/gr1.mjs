#!/usr/bin/env node
// Real Safari qualification of G-R1 in the integrated workspace (production build and CSP):
//   pnpm run build && node tests/browser/renderer/make-fixtures.ts && \
//   node tests/browser/renderer/make-workloads.ts && node tests/safari/gr1.mjs [scenario ...]
// - render: the RFC interactive target (synthetic-many-250k) and the 977k halftone, through the
//   render worker; stage timings; presentation measured explicitly two ways: the displayed canvas
//   sampled every animation frame in the page, and screenshot-bounded (WebDriver), calibrated
//   against a DOM control whose change is timed the same way (captures lag the DOM in Safari).
// - drag: RFC §8.4 drag frames against exact frames (element screenshots, 0 geometry errors).
// - gestures: pan and zoom frame intervals (gesture start/end, display cache) and exact settle.
// - keyboard: path selection on the canvas with its announcements.
// - focus: the canvas keyboard focus ring, from screenshot pixels (Option-Tab; a click shows none).
// - fallback: repeated render-worker crashes fall back to the main thread, disclosed and settled.
// - offline: workspace offline reload, import and worker recovery from the cache.
// Results: tests/output/safari/gr1.json.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { compare, decodePng } from "../browser/renderer/compare.ts";
import { DIST, ROOT, serve } from "./support.mjs";
import { Safari } from "./webdriver.mjs";

const OUT = join(ROOT, "tests/output/safari");
const FIX = join(ROOT, "tests/output/renderer-fixtures");
const WL = join(ROOT, "tests/output/g-r1/workloads");
const PROCEDURAL = join(ROOT, "tests/fixtures/procedural");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (cond, msg) => {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
};

const report = {
  commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT }).toString().trim(),
  loadavgStart: loadavg(),
  scenarios: [],
};
const site = await serve(DIST);
mkdirSync(join(site.root, "__workloads"), { recursive: true });
for (const f of ["synthetic-many-250k.vectra", "architecture-street-halftone.vectra"])
  if (existsSync(join(WL, f))) cpSync(join(WL, f), join(site.root, "__workloads", f));
let s;

const diag = () => s.exec(() => window.__vectra.canvas.diag());
const settled = () =>
  s.waitFor(
    () => {
      const d = window.__vectra.canvas.diag();
      return (
        d.state.kind === "ready" &&
        d.lastExact !== null &&
        d.lastExact.renderRevision === d.renderRevision &&
        JSON.stringify(d.lastExact.camera) === JSON.stringify(d.camera)
      );
    },
    { timeout: 180_000, interval: 10, label: "exact frame for the current revision and camera" },
  );
async function open(query = "") {
  await s.navigate(`${site.origin}/workspace.html?debug=1${query}`);
  await s.waitFor(() => Boolean(window.__vectra && window.__vectra.canvas), { label: "debug API" });
}
async function loadB64(name) {
  const b64 = readFileSync(join(FIX, `${name}.vectra.b64`), "utf8");
  await s.execAsync((b) => window.__vectra.workspace.loadContainer(b), b64);
  await settled();
}
async function hostShot() {
  const el = await s.cmd("POST", "/element", {
    using: "css selector",
    value: "[data-testid=canvas-host]",
  });
  return Buffer.from(await s.cmd("GET", `/element/${Object.values(el)[0]}/screenshot`), "base64");
}
/** An element capture once two consecutive captures agree (presentation can lag). */
async function stableShot() {
  let prev = await hostShot();
  for (let i = 0; i < 25; i++) {
    await sleep(80);
    const next = await hostShot();
    if (next.equals(prev)) return decodePng(next);
    prev = next;
  }
  return decodePng(prev);
}

async function scenario(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    report.scenarios.push({ name, pass: true, ms: Date.now() - t0, detail });
    console.log(`PASS ${name}`);
  } catch (e) {
    report.scenarios.push({ name, pass: false, ms: Date.now() - t0, error: String(e.stack ?? e) });
    console.log(`FAIL ${name}: ${e.message}`);
  }
}
const only = process.argv.slice(2);
const want = (n) => only.length === 0 || only.includes(n);

/** Page-side samplers: the displayed canvas every animation frame, and a DOM control. */
const installSamplers = () =>
  s.exec(() => {
    const small = new OffscreenCanvas(16, 16).getContext("2d", { willReadFrequently: true });
    const samples = [];
    let supported = null;
    const sig = () => {
      const all = document.querySelectorAll('[data-testid="vector-canvas"]');
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
      for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 16777619);
      if (supported === null && d.some((v) => v !== 0)) supported = true;
      return h >>> 0;
    };
    let raf = 0;
    const tick = (t) => {
      samples.push([t, sig()]);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.__present = () => {
      cancelAnimationFrame(raf);
      const final = sig();
      let at = null;
      for (let i = samples.length - 1; i >= 0 && samples[i][1] === final; i--) at = samples[i][0];
      return { supported, presentedAt: at };
    };
  });

try {
  s = await Safari.open();
  report.safari = {
    version: s.capabilities.browserVersion,
    platform:
      `${s.capabilities.platformName} ${s.capabilities["safari:platformVersion"] ?? ""}`.trim(),
  };
  await s.setWindowRect(1440, 1000);
  // Timing needs a visible page: Safari runs no animation frames for a hidden (occluded or
  // off-Space) window, and throttles it. Functional checks do not depend on it.
  await s.navigate(`${site.origin}/workspace.html`);
  const vis = await s.execAsync(
    () =>
      new Promise((done) => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => {
          n++;
          if (performance.now() - t0 < 500) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        setTimeout(() => done({ visibility: document.visibilityState, rafsIn500ms: n }), 600);
      }),
  );
  report.page = vis;
  const visible = vis.visibility === "visible" && vis.rafsIn500ms > 5;
  const notRun = (name, why) => {
    report.scenarios.push({ name, pass: null, notRun: why });
    console.log(`NOT RUN ${name}: ${why}`);
  };
  const HIDDEN = `the Safari automation page is ${vis.visibility} with ${vis.rafsIn500ms} animation frames in 500 ms (window occluded or on another Space): timing is not measurable`;

  if (want("render"))
    await scenario(
      "render: interactive target and halftone through the worker; presentation",
      async () => {
        const out = {};
        for (const name of ["synthetic-many-250k", "architecture-street-halftone"]) {
          if (!existsSync(join(site.root, "__workloads", `${name}.vectra`))) {
            out[name] = "NOT RUN (workload not built)";
            continue;
          }
          await open();
          await installSamplers();
          // Screenshot-bounded presentation, calibrated: a DOM control (a coloured box appended
          // at a known time) timed by the same capture loop.
          const ctl0 = Date.now();
          await s.exec(() => {
            const b = document.createElement("div");
            b.id = "ctl";
            b.style.cssText =
              "position:fixed;left:0;top:0;width:40px;height:40px;background:#ff00ff;z-index:9";
            document.body.append(b);
          });
          let ctlMs = null;
          for (let i = 0; i < 60 && ctlMs === null; i++) {
            const img = decodePng(await s.screenshot());
            if (img.px[0] > 200 && img.px[1] < 60 && img.px[2] > 200) ctlMs = Date.now() - ctl0;
          }
          await s.exec(() => document.getElementById("ctl")?.remove());
          const t0 = Date.now();
          const load = await s.execAsync(
            (u) => window.__vectra.workspace.loadContainerUrl(u),
            `./__workloads/${name}.vectra`,
          );
          await settled();
          const settledWall = Date.now() - t0;
          // Screenshot-bounded: captures until two agree after the exact frame.
          const before = Date.now();
          await stableShot();
          const shotBoundMs = Date.now() - before;
          const present = await s.exec(() => window.__present());
          const d = await diag();
          out[name] = {
            host: d.lastExact.host,
            loadValidateMs: load.loadValidateMs,
            evaluateMs: d.lastEvaluateMs,
            snapshotMs: d.lastSnapshotMs,
            copyMs: d.lastCopyMs,
            postMs: d.lastPostMs,
            pathBuildMs: d.lastPathBuildMs,
            firstFrameMs: d.lastFirstFrameMs,
            exactFrameMs: d.lastExactFrameMs,
            exactDrawRendererMs: d.lastExactDrawMs,
            previewMs: d.lastExactAt - load.loadedAt,
            presentation: {
              sampler: present.supported ? "displayed canvas" : "unsupported",
              visibleAfterLoadMs:
                present.supported && present.presentedAt !== null
                  ? present.presentedAt - load.loadedAt
                  : null,
              visibleAfterExactMessageMs:
                present.supported && present.presentedAt !== null
                  ? present.presentedAt - d.lastExactAt
                  : null,
              screenshotStableAfterSettleMs: shotBoundMs,
              domControlCaptureMs: ctlMs,
              wallToSettledMs: settledWall,
            },
            hitIndex: {
              readyMs: d.hitTestReadyMs,
              slices: d.hitTestSlices,
              maxSliceMs: d.hitTestMaxSliceMs,
            },
            timingsValid: visible,
            ...(visible ? {} : { timingsNote: HIDDEN }),
          };
          assert(d.lastExact.host === "worker", `${name}: drawn by the worker`);
        }
        return out;
      },
    );

  if (want("drag"))
    await scenario("drag: drag frames equal exact frames (RFC §8.4 cases)", async () => {
      const results = [];
      const cases = [
        { name: "middle of paint order", pick: (sh) => [sh[4].id], k: [37, 23] },
        { name: "non-contiguous", pick: (sh) => [sh[1].id, sh[6].id], k: [41, -17] },
        { name: "translucent overlap", pick: (sh) => [sh[6].id], k: [18, -12] },
        {
          name: "clip owned outside",
          pick: (_sh, cl) => [cl.children.find((n) => n.kind === "path").id],
          k: [25, 19],
        },
        { name: "clip owned by the selection", pick: (_sh, cl) => [cl.id], k: [-27, -33] },
        {
          name: "scale (vectors redrawn)",
          pick: (sh) => [sh[3].id],
          m: [1.35, 0, 0, 1.35, -40, -30],
        },
      ];
      for (const c of cases) {
        await open();
        await loadB64("synthetic-correctness");
        const tree = await s.exec(() => window.__vectra.workspace.tree());
        const flat = (t) => t.flatMap((n) => [n, ...flat(n.children ?? [])]);
        const all = flat(tree);
        const shapes = all.find((n) => n.name === "shapes").children;
        const clipped = all.find((n) => n.name === "clipped");
        const ids = c.pick(shapes, clipped);
        const d0 = await diag();
        const dpr = await s.exec(() => devicePixelRatio);
        const m = c.m ?? [
          1,
          0,
          0,
          1,
          c.k[0] / (d0.camera.scale * dpr),
          c.k[1] / (d0.camera.scale * dpr),
        ];
        const frames = d0.dragFrames;
        assert(await s.exec((i) => window.__vectra.canvas.beginDrag(i), ids), "drag started");
        await s.exec((x) => window.__vectra.canvas.dragTo(x), m);
        await s.waitFor((n) => window.__vectra.canvas.diag().dragFrames > n, {
          args: [frames],
          label: "drag frame",
        });
        const drag = await stableShot();
        const mode = (await diag()).lastDragMode;
        await s.exec(() => window.__vectra.canvas.endDrag(true));
        await settled();
        const exact = await stableShot();
        const r = compare(exact, drag);
        results.push({
          case: c.name,
          mode,
          geometryErrors: r.geometryErrors,
          pctOver32: r.pctOver32,
          maxDiff: r.maxDiff,
        });
        assert(r.geometryErrors === 0, `${c.name}: ${JSON.stringify(r)}`);
      }
      return results;
    });

  if (want("gestures") && !visible)
    notRun("gestures: pan and zoom frame intervals with the display cache; exact settle", HIDDEN);
  else if (want("gestures"))
    await scenario(
      "gestures: pan and zoom frame intervals with the display cache; exact settle",
      async () => {
        await open();
        await loadB64("synthetic-correctness");
        const out = {};
        for (const kind of ["pan", "zoom"]) {
          const r = await s.execAsync(async (k) => {
            const c = window.__vectra.canvas;
            const cam = c.diag().camera;
            const gaps = [];
            c.gesture("start");
            await new Promise((done) => {
              let n = 0;
              let last = performance.now();
              const tick = (t) => {
                gaps.push(t - last);
                last = t;
                const f = k === "zoom" ? (n < 30 ? 1.02 ** (n + 1) : 1.02 ** (60 - n)) : 1;
                c.setView(
                  cam.scale * f,
                  cam.tx + (k === "pan" ? 3 * n : 0),
                  cam.ty + (k === "pan" ? 2 * n : 0),
                );
                if (++n < 60) requestAnimationFrame(tick);
                else done();
              };
              requestAnimationFrame(tick);
            });
            c.gesture("end");
            gaps.shift();
            gaps.sort((a, b) => a - b);
            return {
              p50: gaps[Math.floor(gaps.length / 2)],
              p95: gaps[Math.floor(gaps.length * 0.95)],
              max: gaps.at(-1),
            };
          }, kind);
          const t0 = Date.now();
          await settled();
          out[kind] = { ...r, exactSettleWallMs: Date.now() - t0 };
          assert(r.p95 <= 33.4, `${kind}: frame p95 ${r.p95} ms`);
        }
        return out;
      },
    );

  if (want("keyboard"))
    await scenario("keyboard: select a single path from the canvas; announcements", async () => {
      await open();
      await loadB64("synthetic-correctness");
      await s.exec(() => document.querySelector("[data-testid=canvas-host]").focus());
      const keys = async (...ks) =>
        s.cmd("POST", "/actions", {
          actions: [
            {
              type: "key",
              id: "kbd",
              actions: ks.flatMap((k) => [
                { type: "keyDown", value: k },
                { type: "keyUp", value: k },
              ]),
            },
          ],
        });
      const said = () =>
        s.exec(() => document.querySelector("[data-testid=canvas-announcer]").textContent);
      await keys(""); // ArrowDown: the top-most layer
      const layer = await said();
      await keys("", ""); // ArrowRight twice: into the layer, into the top-most group
      const path = await said();
      await keys(""); // Enter
      await s.waitFor(
        () =>
          /^Path \d+$/.test(
            document.querySelector("[data-testid=selection-name]")?.textContent ?? "",
          ),
        { label: "a single path selected" },
      );
      const selected = await said();
      await s.cmd("DELETE", "/actions");
      assert(/ of \d+/.test(layer), `layer announced: ${layer}`);
      assert(/^Path \d+/.test(path), `path announced: ${path}`);
      assert(/selected$/.test(selected), `selection announced: ${selected}`);
      return { layer, path, selected };
    });

  if (want("focus"))
    await scenario(
      "focus ring: drawn above every canvas layer on keyboard focus, not on a click",
      async () => {
        await open();
        await loadB64("synthetic-correctness");
        // Zoom on the artboard's centre (4× the canvas): canvas layers under every edge.
        const box = await s.exec(() => {
          const host = document.querySelector("[data-testid=canvas-host]").getBoundingClientRect();
          const art = document.querySelector("[data-testid=artboard]").getBoundingClientRect();
          const c = window.__vectra.canvas.diag().camera;
          const w = art.width / c.scale;
          const h = art.height / c.scale;
          const scale = (4 * Math.max(host.width, host.height)) / Math.max(w, h);
          window.__vectra.canvas.setView(
            scale,
            host.width / 2 - (w / 2) * scale,
            host.height / 2 - (h / 2) * scale,
          );
          return { x: host.x, y: host.y, width: host.width, height: host.height };
        });
        await settled();
        const colours = await s.exec(() => {
          const cs = getComputedStyle(document.querySelector("[data-testid=canvas-focus-ring]"));
          const d = document.createElement("div");
          d.style.color = cs.getPropertyValue("--vx-focus-halo").trim();
          document.body.append(d);
          const halo = getComputedStyle(d).color;
          d.remove();
          return { ring: cs.outlineColor, halo };
        });
        const rgb = (c) => c.match(/\d+/g).slice(0, 3).map(Number);
        const lime = rgb(colours.ring);
        const halo = rgb(colours.halo);
        const near = (a, b, tol = 24) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
        // Safari's element capture returned the whole viewport here, so capture the viewport and
        // address the host's rectangle in device pixels.
        const bands = async () => {
          const img = decodePng(await s.screenshot());
          const dpr = img.w / (await s.exec(() => window.innerWidth));
          const x0 = Math.round(box.x * dpr);
          const y0 = Math.round(box.y * dpr);
          const w = Math.round(box.width * dpr);
          const h = Math.round(box.height * dpr);
          const at = (x, y) => {
            const i = 3 * ((y0 + y) * img.w + x0 + x);
            return [img.px[i], img.px[i + 1], img.px[i + 2]];
          };
          const outer = [];
          const inner = [];
          for (let k = 1; k <= 16; k++) {
            const x = Math.round((w * (k + 1)) / 18);
            const y = Math.round((h * (k + 1)) / 18);
            for (const [band, css] of [
              [outer, 1],
              [inner, 3],
            ]) {
              const d = Math.round(css * dpr);
              band.push(at(x, d), at(x, h - 1 - d), at(d, y), at(w - 1 - d, y));
            }
          }
          const mid = Math.round(h / 2);
          const profile = Array.from({ length: 10 }, (_, d) => at(d, mid).join(",")).join(" | ");
          return { outer, inner, dpr, profile, size: `${w}x${h} of ${img.w}x${img.h}` };
        };
        const state = () =>
          s.exec(() => {
            const host = document.querySelector("[data-testid=canvas-host]");
            const ring = document.querySelector("[data-testid=canvas-focus-ring]");
            return {
              active: document.activeElement === host,
              focusVisible: host.matches(":focus-visible"),
              ringShown: getComputedStyle(ring).display !== "none",
            };
          });
        // Keyboard focus: Option-Tab from the tool rail (Safari's default Tab skips buttons).
        await s.exec(() =>
          [...document.querySelectorAll("button")]
            .find((b) => (b.getAttribute("aria-label") ?? b.textContent.trim()) === "Select")
            .focus(),
        );
        const tab = () =>
          s.cmd("POST", "/actions", {
            actions: [
              {
                type: "key",
                id: "kbd",
                actions: [
                  { type: "keyDown", value: "" },
                  { type: "keyDown", value: "" },
                  { type: "keyUp", value: "" },
                  { type: "keyUp", value: "" },
                ],
              },
            ],
          });
        let presses = 0;
        while (presses < 25 && !(await state()).active) {
          await tab();
          presses++;
        }
        await sleep(100);
        const keyboard = await state();
        assert(keyboard.active, `Option-Tab reached the canvas (${presses} presses)`);
        assert(
          keyboard.focusVisible && keyboard.ringShown,
          `ring shown: ${JSON.stringify(keyboard)}`,
        );
        const focused = await bands();
        const outerOff = focused.outer.filter((c) => !near(c, lime));
        const innerOff = focused.inner.filter((c) => !near(c, halo));
        assert(
          outerOff.length === 0,
          `outer band lime: ${JSON.stringify(outerOff.slice(0, 4))}; ${focused.size} dpr ${focused.dpr}; left edge ${focused.profile}`,
        );
        assert(innerOff.length === 0, `inner band dark: ${JSON.stringify(innerOff.slice(0, 4))}`);
        const atRing = await s.exec(
          (x, y) => document.elementFromPoint(x, y)?.getAttribute("data-testid") ?? "other",
          box.x + 1,
          box.y + box.height / 2,
        );
        assert(atRing !== "canvas-focus-ring", "the ring takes no pointer input");
        await s.cmd("DELETE", "/actions");
        // A pointer click: focus without the ring.
        await s.exec(() => document.activeElement?.blur());
        await s.cmd("POST", "/actions", {
          actions: [
            {
              type: "pointer",
              id: "mouse",
              parameters: { pointerType: "mouse" },
              actions: [
                {
                  type: "pointerMove",
                  origin: "viewport",
                  x: Math.round(box.x + box.width / 2),
                  y: Math.round(box.y + box.height / 2),
                },
                { type: "pointerDown", button: 0 },
                { type: "pointerUp", button: 0 },
              ],
            },
          ],
        });
        await s.cmd("DELETE", "/actions");
        await sleep(100);
        const pointer = await state();
        assert(pointer.active, "a click focuses the canvas");
        assert(!pointer.focusVisible && !pointer.ringShown, `no ring: ${JSON.stringify(pointer)}`);
        const clicked = await bands();
        const limeAfterClick = clicked.outer.filter((c) => near(c, lime)).length;
        assert(
          limeAfterClick < clicked.outer.length / 4,
          `no lime band after a click (${limeAfterClick})`,
        );
        return {
          presses,
          dpr: focused.dpr,
          expected: { ring: lime, halo },
          sample: { outer: focused.outer[0], inner: focused.inner[0] },
          keyboard,
          pointer,
          limeAfterClick,
        };
      },
    );

  if (want("fallback"))
    await scenario(
      "crash fallback: repeated render-worker crashes fall back to the main thread, disclosed and settled",
      async () => {
        await open();
        await loadB64("synthetic-correctness");
        const crash = async () => {
          await s.exec(() => {
            window.__crashBase = window.__vectra.canvas.diag().client.crashes;
            window.__vectra.canvas.crash();
          });
          await s.waitFor(() => window.__vectra.canvas.diag().client.crashes > window.__crashBase, {
            label: "the crash is registered",
          });
        };
        // Three crashes recover on a new worker, each presenting before the next crash; the
        // fourth within 30 s falls back to the main-thread renderer (RenderClient policy).
        for (let i = 0; i < 3; i++) {
          await crash();
          await settled();
        }
        await crash();
        await s.waitFor(
          () =>
            /^the render worker crashed repeatedly/.test(
              window.__vectra.canvas.diag().client.fallbackReason ?? "",
            ),
          { timeout: 30_000, label: "the main-thread fallback" },
        );
        // The host settles: ready, with an exact frame of the current revision and camera
        // (before 17a3ac0 it stayed "rendering").
        await settled();
        const d = await diag();
        const label = await s.exec(
          () => document.querySelector("[data-testid=canvas-state]")?.textContent ?? "",
        );
        assert(
          d.state.kind === "ready" && d.state.host === "main-thread",
          `host ready on the main thread: ${JSON.stringify(d.state)}`,
        );
        assert(d.lastExact?.host === "main-thread", `exact frame drawn on the main thread`);
        assert(
          /main thread \(fallback: the render worker crashed repeatedly/.test(label),
          `fallback disclosed: ${label}`,
        );
        return {
          state: d.state,
          fallbackReason: d.client.fallbackReason,
          crashes: d.client.crashes,
          recoveries: d.client.recoveries,
          label,
        };
      },
    );

  if (want("offline"))
    await scenario(
      "offline: workspace reload, import and both workers recreated from the cache",
      async () => {
        await s.navigate(`${site.origin}/workspace.html?debug=1`);
        await s.waitFor(
          () => document.querySelector("[data-testid=offline-status]")?.dataset.state === "ready",
          {
            timeout: 60_000,
            label: "offline ready (this build)",
          },
        );
        site.down = true; // an unreachable origin (WebDriver has no network emulation)
        await s.navigate(`${site.origin}/workspace.html?debug=1`);
        await s.waitFor(() => Boolean(window.__vectra && window.__vectra.canvas), {
          timeout: 60_000,
          label: "loaded offline",
        });
        const el = await s.cmd("POST", "/element", {
          using: "css selector",
          value: '[data-testid="import-input"]',
        });
        await s.cmd("POST", `/element/${Object.values(el)[0]}/value`, {
          text: join(PROCEDURAL, "nested_rings.png"),
        });
        await s.waitFor(
          () =>
            document
              .querySelector("[data-testid=status]")
              ?.textContent.includes("Traced nested_rings.png"),
          {
            timeout: 90_000,
            label: "traced offline",
          },
        );
        await settled();
        assert(await s.exec(() => window.__vectra.canvas.crash()), "render worker crashed");
        await s.waitFor(() => window.__vectra.canvas.diag().client.lastRecoveryMs !== null, {
          timeout: 60_000,
          label: "render worker recovered offline",
        });
        await settled();
        const d = await diag();
        site.down = false;
        assert(d.lastExact.host === "worker", "worker host after recovery");
        return { recoveryMs: d.client.lastRecoveryMs, buildMismatches: d.client.buildMismatches };
      },
    );
} catch (e) {
  report.scenarios.push({ name: "harness", pass: false, error: String(e.stack ?? e) });
  console.log(`FAIL harness: ${e.stack ?? e}`);
} finally {
  await s?.quit().catch(() => {});
  site.close();
}
report.loadavgEnd = loadavg();
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "gr1.json"), JSON.stringify(report, null, 2));
const failed = report.scenarios.filter((x) => x.pass === false).length;
const skipped = report.scenarios.filter((x) => x.pass === null).length;
console.log(
  `${report.scenarios.length - failed - skipped}/${report.scenarios.length - skipped} passed, ${skipped} NOT RUN (Safari ${report.safari?.version}; page ${report.page?.visibility})`,
);
process.exitCode = failed ? 1 : 0;
