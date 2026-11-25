// R02 renderer bake-off page. Query:
//   renderer=canvas|svgdom|svgimg|webgl kind=real|synth|native name=<scene> reps=6 frames=30
//   mode=bench|correctness zoom=<correctness scale> index=grid|str
// Input to every candidate: the GeometryPacket already on the main thread (post-transport),
// plus the engine's SVG text for the P0 <img> baseline. Index build is reported separately from
// first visible (it does not block the first frame) but inside the blocking probe window.
import { validatePacket } from "./packet.mjs";
import { loadPacket, nextFrame, now, pct, probe, twoFrames, viewPacket } from "./common.mjs";
import { RENDERERS } from "./renderers.mjs";
import { HitIndex } from "./hit.mjs";

const q = new URLSearchParams(location.search);
const R = q.get("renderer"), kind = q.get("kind"), name = q.get("name");
const reps = Number(q.get("reps") ?? 6), frames = Number(q.get("frames") ?? 30);
const cache = q.get("cache") === "1";
const mode = q.get("mode") ?? "bench", zoom = Number(q.get("zoom") ?? 1), indexKind = q.get("index") ?? "grid";
const stage = document.getElementById("stage");
const dpr = devicePixelRatio;
const SERIES_CAP_MS = mode === "pan" ? 20000 : 5000;

const base = { real: "/scenes/real/", synth: "/scenes/synth/", native: "/scenes/native/" }[kind];

function fit(r, m) {
  const s = Math.min(r.w / m.width, r.h / m.height);
  r.cam = { s, tx: (r.w - m.width * s) / 2, ty: (r.h - m.height * s) / 2 };
}

async function loadScene(inp, W, H) {
  const buf = inp.bin.slice(0); // a fresh, owned copy, as if just transferred from the worker
  const stop = probe();
  const t0 = now();
  const p = viewPacket(inp.man, buf);
  let t = now();
  const derived = validatePacket(p);
  const validateMs = now() - t;
  const r = new RENDERERS[R](stage, { white: mode === "correctness", cache });
  r.resize(W, H, dpr);
  if (mode === "correctness") r.cam = { s: zoom, tx: 0, ty: 0 };
  else fit(r, p.manifest);
  t = now();
  const lt = R === "svgimg" ? await r.loadSvg(inp.svgText, p) : r.load(p, derived);
  const prepareMs = now() - t;
  t = now();
  r.draw();
  const drawMs = now() - t;
  await twoFrames();
  const firstVisibleMs = now() - t0;
  t = now();
  const hit = new HitIndex(p, derived, { kind: indexKind });
  const indexMs = now() - t;
  await twoFrames();
  const s = stop();
  return {
    r, p, derived, hit,
    t: { validateMs, prepareMs, ...lt, drawMs, firstVisibleMs, indexMs, indexItemsMs: hit.buildMs.items, indexBuildMs: hit.buildMs.index,
      indexItems: hit.itemCount, indexBytes: hit.bytes, loadMaxFrameGapMs: s.maxGap, loadLongTasks: s.longTasks, loadLongestTaskMs: s.longestTask },
  };
}

async function series(n, step) {
  const intervals = [], js = [];
  let last = await nextFrame();
  const start = performance.now();
  let truncated = false;
  for (let k = 0; k < n; k++) {
    const t = performance.now();
    step(k);
    js.push(performance.now() - t);
    const tf = await nextFrame();
    intervals.push(tf - last);
    last = tf;
    if (performance.now() - start > SERIES_CAP_MS) {
      truncated = k + 1 < n;
      break;
    }
  }
  return { n: intervals.length, truncated, p50: pct(intervals, 50), p95: pct(intervals, 95), max: Math.max(...intervals),
    over50: intervals.filter((x) => x > 50).length, jsP50: pct(js, 50), jsMax: Math.max(...js) };
}

/** Discrete-action latency, aligned to a frame start: JS work, then until two frames later
 *  (vsync-quantised: a cheap change reads ≈ 2 frames ≈ 33 ms at 60 Hz). */
async function latency(fn) {
  await nextFrame();
  const t = now();
  fn();
  const jsMs = now() - t;
  await twoFrames();
  return { jsMs: +jsMs.toFixed(2), visibleMs: +(now() - t).toFixed(2) };
}

/** Per-query time: first (cold) call, then a repeated loop until ≥ 2 ms (coarse clocks). */
function timeQuery(fn) {
  let t = performance.now();
  const res = fn();
  const cold = performance.now() - t;
  let count = 0;
  t = performance.now();
  do {
    fn();
    count++;
  } while (performance.now() - t < 2 && count < 1000);
  return [res, cold, (performance.now() - t) / count];
}

let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);

async function interactions(sc, rep) {
  const { r, p, hit } = sc;
  const m = p.manifest, out = {};
  const home = { ...r.cam };
  const redraw = () => r.draw();
  r.gesture = true;
  out.pan = await series(frames, () => {
    r.cam.tx -= 12;
    redraw();
  });
  r.gesture = false;
  if (cache) out.panSettle = await latency(redraw); // exact redraw when the gesture ends
  r.cam = { ...home };
  redraw();
  r.gesture = true;
  out.zoom = await series(frames, () => {
    const f = 1.04, cx = r.w / 2, cy = r.h / 2;
    r.cam = { s: r.cam.s * f, tx: cx - (cx - r.cam.tx) * f, ty: cy - (cy - r.cam.ty) * f };
    redraw();
  });
  r.gesture = false;
  if (cache) out.zoomSettle = await latency(redraw);
  r.cam = { ...home };
  redraw();
  await twoFrames();
  // Hit tests at random viewport points (document coordinates via the inverse camera).
  seed = 12345 + rep;
  const cold = [], warm = [], pts = [];
  let hits = 0;
  for (let k = 0; k < 300; k++) {
    const sx = rnd() * r.w, sy = rnd() * r.h;
    const x = (sx - r.cam.tx) / r.cam.s, y = (sy - r.cam.ty) / r.cam.s;
    const [res, c, w] = timeQuery(() => hit.hit(x, y));
    cold.push(c);
    warm.push(w);
    pts.push([sx, sy, x, y, res]);
    if (res >= 0) hits++;
  }
  out.hitTest = { queries: 300, hits, coldP50: pct(cold, 50), coldP95: pct(cold, 95), coldMax: Math.max(...cold),
    warmP50: pct(warm, 50), warmP95: pct(warm, 95), warmMax: Math.max(...warm), flattenMs: hit.flattenMs };
  if (R === "svgdom" && rep === 1) {
    const rect = r.svg.getBoundingClientRect();
    const nat = [];
    let agree = 0;
    for (const [sx, sy, , , res] of pts) {
      const [n, c] = timeQuery(() => r.nativeHit(rect.left + sx, rect.top + sy));
      nat.push(c);
      if (n === res) agree++;
    }
    out.nativeElementFromPoint = { coldP50: pct(nat, 50), coldP95: pct(nat, 95), coldMax: Math.max(...nat), agreeWithCpuIndex: agree };
  }
  if (R === "canvas" && rep === 1) {
    // Validate the JS exact test against the browser's isPointInPath on the same candidates.
    const ctx = document.createElement("canvas").getContext("2d");
    let agree = 0, disagree = [];
    for (const [, , x, y, res] of pts) {
      const cand = [];
      hit.index.query(x, y, cand);
      const paths = [...new Set(cand.map((k) => hit.itemPath[k]))].sort((a, b) => b - a);
      let truth = -1;
      for (const i of paths) {
        const g = p.groupIndex[i], clip = m.groups[g].clip;
        if (clip && (x < clip.x || y < clip.y || x > clip.x + clip.width || y > clip.y + clip.height)) continue;
        if (ctx.isPointInPath(r.paths[i], x, y, m.styles[p.styleIndex[i]].evenOdd ? "evenodd" : "nonzero")) {
          truth = i;
          break;
        }
      }
      truth === res ? agree++ : disagree.push([+x.toFixed(2), +y.toFixed(2), res, truth]);
    }
    out.hitAgreementWithIsPointInPath = { agree, of: pts.length, disagree: disagree.slice(0, 10) };
  }
  // Selection + highlight: first random point that hits something.
  const target = pts.find((q) => q[4] >= 0);
  if (target) {
    out.selectLatencyMs = await latency(() => {
      r.sel = hit.hit(target[2], target[3]);
      redraw();
    });
    const b = sc.derived.bounds, i = r.sel, cx = (b[4 * i] + b[4 * i + 2]) / 2, cy = (b[4 * i + 1] + b[4 * i + 3]) / 2;
    out.translate = await series(frames, (k) => {
      r.objT = [1, 0, 0, 1, 2 * (k + 1), 1 * (k + 1)];
      redraw();
    });
    out.scale = await series(frames, (k) => {
      const f = 1 + 0.02 * (k + 1);
      r.objT = [f, 0, 0, f, cx - f * cx, cy - f * cy];
      redraw();
    });
    r.objT = null;
    if (R !== "svgimg" && R !== "webgl") {
      out.invalidateLatencyMs = await latency(() => {
        r.invalidate(i);
        hit.polys.delete(i);
        redraw();
      });
    }
    r.sel = -1;
  }
  out.visibilityLatencyMs = await latency(() => {
    r.hidden.add(0);
    hit.hidden.add(0);
    redraw();
  });
  r.hidden.clear();
  hit.hidden.clear();
  redraw();
  // Palette change on the style used by most paths.
  const counts = new Map();
  for (const s of p.styleIndex) counts.set(s, (counts.get(s) ?? 0) + 1);
  const [topStyle, topCount] = [...counts].sort((a, b) => b[1] - a[1])[0];
  out.paletteLatencyMs = await latency(() => {
    r.setStyleColor(topStyle, "#ff00ff");
    redraw();
  });
  out.palettePathsChanged = topCount;
  out.resizeLatencyMs = await latency(() => {
    r.resize(r.w - 200, r.h, dpr);
    redraw();
  });
  r.resize(r.w + 200, r.h, dpr);
  redraw();
  if (sc.r.syncRedraw) {
    // Raster-complete cost of a full redraw at the fitted camera (forced 1-px readback).
    const xs = [];
    for (let k = 0; k < 10; k++) {
      const t = performance.now();
      sc.r.syncRedraw();
      xs.push(performance.now() - t);
      await nextFrame();
    }
    out.syncRedraw = { p50: pct(xs, 50), p95: pct(xs, 95), max: Math.max(...xs) };
  }
  if (R === "svgimg") for (const k of ["selectLatencyMs", "translate", "scale", "paletteLatencyMs", "visibilityLatencyMs"]) out[k] = "N/A (static image)";
  return out;
}

async function run() {
  const inp = await loadPacket(name);
  if (R === "svgimg") inp.svgText = await fetch(`${base}${name}.svg`).then((x) => x.text());
  const W = mode === "correctness" ? Math.round(inp.man.width * zoom) : innerWidth;
  const H = mode === "correctness" ? Math.round(inp.man.height * zoom) : innerHeight;
  stage.style.width = `${W}px`;
  stage.style.height = `${H}px`;
  if (mode === "pan") {
    // Frame-presentation check: pan 120 frames between user-timing marks (traced by the driver).
    const sc = await loadScene(inp, W, H);
    await twoFrames();
    await new Promise((r) => setTimeout(r, 500));
    performance.mark("pan-start");
    const pan = await series(120, () => {
      sc.r.cam.tx -= 6;
      sc.r.draw();
    });
    performance.mark("pan-end");
    return { W, H, dpr, pan };
  }
  if (mode === "correctness") {
    stage.classList.add("white");
    const sc = await loadScene(inp, W, H);
    await twoFrames();
    const checks = q.get("checks") ? JSON.parse(q.get("checks")).map(([x, y, want]) => ({ x, y, want, got: sc.hit.hit(x, y) })) : [];
    return { W, H, dpr, t: sc.t, checks };
  }
  const results = [];
  for (let rep = 0; rep < reps; rep++) {
    const sc = await loadScene(inp, W, H);
    const row = { rep, cold: rep === 0, ...sc.t, memory: { ...sc.r.memory(), packetBytes: inp.bin.byteLength } };
    if (performance.memory) row.memory.jsHeapUsedBytes = performance.memory.usedJSHeapSize;
    if (rep > 0) row.interactions = await interactions(sc, rep);
    if (R === "webgl" && rep === 1) row.contextLoss = await sc.r.loseContext();
    sc.r.release();
    results.push(row);
    await twoFrames();
  }
  return { W, H, dpr, results };
}

window.__run = run().then(
  (r) => (window.__done = { ok: true, ...r }),
  (e) => (window.__done = { ok: false, error: `${e}\n${e?.stack ?? ""}` }),
);
