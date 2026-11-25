// OffscreenCanvas variant: main-thread blocking during scene load and pan, with geometry
// preparation and raster in a render worker. Query: kind, name, reps (default 6).
import { loadPacket, pct, probe, twoFrames } from "./common.mjs";
import { clonePacket, transferList } from "./packet.mjs";
import { viewPacket } from "./common.mjs";
const q = new URLSearchParams(location.search);
const name = q.get("name"), reps = Number(q.get("reps") ?? 6), cache = q.get("cache") === "1";
const mode = q.get("mode") ?? "bench", zoom = Number(q.get("zoom") ?? 1);
const stage = document.getElementById("stage");
async function run() {
  const { man, bin } = await loadPacket(name);
  const base = viewPacket(man, bin);
  const corr = mode === "correctness";
  const W = corr ? Math.round(man.width * zoom) : innerWidth, H = corr ? Math.round(man.height * zoom) : innerHeight, dpr = devicePixelRatio;
  stage.style.width = `${W}px`;
  stage.style.height = `${H}px`;
  if (corr) {
    stage.classList.add("white");
    const c = document.createElement("canvas");
    c.style.width = `${W}px`; c.style.height = `${H}px`;
    stage.append(c);
    const off = c.transferControlToOffscreen();
    const worker = new Worker("offscreen-worker.js", { type: "module" });
    const next = () => new Promise((r) => (worker.onmessage = (e) => r(e.data)));
    worker.postMessage({ type: "init", canvas: off, dpr, w: W, h: H }, [off]);
    await next();
    const job = clonePacket(base);
    worker.postMessage({ type: "scene", packet: job, commit: q.get("commit") === "1", cam: { s: zoom, tx: 0, ty: 0 } }, transferList(job));
    await next();
    await twoFrames();
    await new Promise((r) => setTimeout(r, Number(q.get("waitMs") ?? 0)));
    await twoFrames();
    // Independent of screenshots: read the placeholder canvas back through drawImage.
    let placeholderNonWhite = null;
    try {
      const probeC = document.createElement("canvas");
      probeC.width = c.width || W; probeC.height = c.height || H;
      const pc = probeC.getContext("2d");
      pc.fillStyle = "#fff"; pc.fillRect(0, 0, probeC.width, probeC.height);
      pc.drawImage(c, 0, 0);
      const d = pc.getImageData(0, 0, probeC.width, probeC.height).data;
      placeholderNonWhite = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) placeholderNonWhite++;
    } catch (e) { placeholderNonWhite = `error: ${e}`; }
    return { W, H, dpr, placeholderNonWhite };
  }
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
    worker.postMessage({ type: "scene", packet: job, cache, cam: { s, tx: (W - man.width * s) / 2, ty: (H - man.height * s) / 2 } }, transferList(job));
    const drawn = await next();
    const workerDoneMs = performance.now() - t0; // packet handed over -> first frame drawn in the worker
    await twoFrames();
    const load = stop();
    const stop2 = probe();
    worker.postMessage({ type: "pan", frames: 30, cache });
    const pan = await next();
    worker.postMessage({ type: "zoom", frames: 30, cache });
    const zm = await next();
    const mainDuringGestures = stop2();
    worker.terminate();
    results.push({ rep, cache, workerRaf: ready.workerRaf, buildMs: drawn.buildMs, drawMs: drawn.drawMs, workerFirstDrawMs: workerDoneMs,
      mainLoadMaxGapMs: load.maxGap, mainLoadLongTasks: load.longTasks,
      workerPanP50: pct(pan.intervals, 50), workerPanP95: pct(pan.intervals, 95), workerPanMax: Math.max(...pan.intervals),
      workerZoomP50: pct(zm.intervals, 50), workerZoomP95: pct(zm.intervals, 95), settlePanMs: pan.settleMs, settleZoomMs: zm.settleMs,
      mainPanMaxGapMs: mainDuringGestures.maxGap });
  }
  return { W, H, dpr, results };
}
window.__run = run().then((r) => (window.__done = { ok: true, ...r }), (e) => (window.__done = { ok: false, error: `${e}\n${e?.stack}` }));
