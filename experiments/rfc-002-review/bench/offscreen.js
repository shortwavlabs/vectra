// OffscreenCanvas variant: main-thread blocking during scene load and pan, with geometry
// preparation and raster in a render worker. Query: kind, name, reps (default 6).
import { loadPacket, pct, probe, twoFrames } from "./common.mjs";
import { clonePacket, transferList } from "./packet.mjs";
import { viewPacket } from "./common.mjs";
const q = new URLSearchParams(location.search);
const name = q.get("name"), reps = Number(q.get("reps") ?? 6);
const stage = document.getElementById("stage");
async function run() {
  const { man, bin } = await loadPacket(name);
  const base = viewPacket(man, bin);
  const W = innerWidth, H = innerHeight, dpr = devicePixelRatio;
  const results = [];
  for (let rep = 0; rep < reps; rep++) {
    stage.replaceChildren();
    const c = document.createElement("canvas");
    c.style.width = `${W}px`; c.style.height = `${H}px`;
    stage.append(c);
    const off = c.transferControlToOffscreen();
    const worker = new Worker("offscreen-worker.js", { type: "module" });
    const next = () => new Promise((r) => (worker.onmessage = (e) => r(e.data)));
    worker.postMessage({ type: "init", canvas: off, dpr, w: W, h: H }, [off]);
    const ready = await next();
    const s = Math.min(W / man.width, H / man.height);
    await twoFrames();
    const stop = probe();
    const t0 = performance.now();
    const job = clonePacket(base); // a disposable render-cache copy; the document keeps `base`
    worker.postMessage({ type: "scene", packet: job, cam: { s, tx: (W - man.width * s) / 2, ty: (H - man.height * s) / 2 } }, transferList(job));
    const drawn = await next();
    const workerDoneMs = performance.now() - t0;
    await twoFrames();
    const load = stop();
    const stop2 = probe();
    worker.postMessage({ type: "pan", frames: 30 });
    const pan = await next();
    const mainDuringPan = stop2();
    worker.terminate();
    results.push({ rep, workerRaf: ready.workerRaf, buildMs: drawn.buildMs, drawMs: drawn.drawMs, workerDoneMs,
      mainLoadMaxGapMs: load.maxGap, mainLoadLongTasks: load.longTasks,
      workerPanP50: pct(pan.intervals, 50), workerPanP95: pct(pan.intervals, 95), workerPanMax: Math.max(...pan.intervals),
      mainPanMaxGapMs: mainDuringPan.maxGap });
  }
  return { W, H, dpr, results };
}
window.__run = run().then((r) => (window.__done = { ok: true, ...r }), (e) => (window.__done = { ok: false, error: `${e}\n${e?.stack}` }));
