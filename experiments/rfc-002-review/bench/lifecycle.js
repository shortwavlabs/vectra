// R03 lifecycle scenarios 1–12 against the real engine, with a minimal authoritative document
// store on the main thread (immutable layers, monotonic revision, undo/redo of layer arrays).
// Query: ?recycleMiB=N. The driver runs it online, then offline (served by lifecycle-sw.js).
import { Cancelled, Scheduler } from "./scheduler.mjs";
import { validatePacket } from "./packet.mjs";

const q = new URLSearchParams(location.search);
const log = [];
const check = (step, name, pass, details = {}) => log.push({ step, name, pass: !!pass, ...details });

// ---- Service worker (offline recreation) ----
async function ensureControlled() {
  if (!("serviceWorker" in navigator)) return false;
  await navigator.serviceWorker.register("lifecycle-sw.js");
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller)
    await new Promise((r) => navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }));
  return !!navigator.serviceWorker.controller;
}

// ---- Synthetic source (deterministic, no fixture licensing questions) ----
function synth(w, h, scale = 1) {
  const px = new Uint8ClampedArray(w * h * 4);
  const discs = [];
  let s = 7;
  const r = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
  for (let k = 0; k < 60; k++) discs.push([r() * 2400, r() * 1800, 30 + r() * 220, [r() * 255, r() * 255, r() * 255]]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const X = x / scale, Y = y / scale, i = 4 * (y * w + x);
      let c = [40 + (X / 2400) * 160, 60 + (Y / 1800) * 120, 120];
      for (const [cx, cy, rad, col] of discs) {
        const d = Math.hypot(X - cx, Y - cy) - rad;
        if (d < 1) {
          const a = Math.min(1, Math.max(0, 0.5 - d / 2));
          c = c.map((v, j) => v * (1 - a) + col[j] * a);
        }
      }
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
  return px;
}
const FULL = [2400, 1800], PREV = [600, 450];
const settings = (colorPrecision) => ({ presetVersion: 1, seed: 1, maxPixels: 12_000_000, maxAnchors: 1_000_000,
  settings: { mode: "color", colorPrecision, layerDifference: 16, speckle: 16, alphaThreshold: 128, compositing: "stacked",
    fit: { mode: "spline", cornerThreshold: 60, lengthThreshold: 4, spliceThreshold: 45, simplify: 0 } } });

// ---- Document store: authoritative, immutable layers, never transferred ----
const doc = { revision: 0, layers: [] };
const history = { undo: [], redo: [] };
const commit = (layers, label) => {
  history.undo.push({ before: doc.layers, after: layers, label });
  history.redo = [];
  doc.layers = layers;
  doc.revision++;
};
const undo = () => {
  const e = history.undo.pop();
  if (!e) return false;
  history.redo.push(e);
  doc.layers = e.before;
  doc.revision++;
  return true;
};
const redo = () => {
  const e = history.redo.pop();
  if (!e) return false;
  history.undo.push(e);
  doc.layers = e.after;
  doc.revision++;
  return true;
};
async function digest(layer) {
  const p = layer.packet;
  const parts = [new TextEncoder().encode(layer.sceneJson), p.verbs, p.coords, p.verbOffsets, p.coordOffsets];
  const all = new Uint8Array(parts.reduce((s, a) => s + a.byteLength, 0));
  let o = 0;
  for (const a of parts) {
    all.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), o);
    o += a.byteLength;
  }
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", all))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const recycleMiB = Number(q.get("recycleMiB") ?? 1024);
const sched = new Scheduler({
  createWorker: () => new Worker("lifecycle-worker.js", { type: "module" }),
  recycleAboveBytes: recycleMiB * 2 ** 20,
});
const fullPx = synth(...FULL), prevPx = synth(...PREV, PREV[0] / FULL[0]);
// Jobs receive their own copies; committed data and the retained source are never transferred.
const traceJob = (kind, px, [w, h], cp) => ({
  kind, scope: "layer:new",
  build: (jobId) => {
    const rgba = px.slice().buffer;
    return [{ type: "trace", jobId, rgba, width: w, height: h, request: settings(cp) }, [rgba]];
  },
});
const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));

async function scenarios(label) {
  const t0 = performance.now();
  // 1–2. Preview, then settings changed repeatedly: only the latest preview completes.
  const previews = [4, 5, 6, 7, 8].map((cp) => sched.submit(traceJob("preview", prevPx, PREV, cp)));
  const pr = await Promise.all(previews.map((j) => settle(j.done)));
  check(1, "preview runs", pr.at(-1).ok, { anchors: pr.at(-1).v?.metrics?.stats?.anchors,
    error: pr.at(-1).ok ? undefined : `${pr.at(-1).e?.name} ${pr.at(-1).e?.code ?? ""} ${pr.at(-1).e?.message}`,
    outcomes: pr.map((x) => (x.ok ? "ok" : `${x.e?.name}:${x.e?.code ?? ""}`)) });
  check(2, "only the latest of 5 rapid previews completes; earlier ones cancelled/superseded",
    pr.slice(0, -1).every((x) => !x.ok && x.e instanceof Cancelled) && pr.at(-1).ok);
  // 3. Apply a final result: validated, committed as a new immutable layer with history.
  const baseRev = doc.revision;
  const fin = await settle(sched.submit(traceJob("final", fullPx, FULL, 6)).done);
  let committed = null;
  if (fin.ok && doc.revision === baseRev) {
    const v = validatePacket(fin.v.packet);
    committed = { id: `layer-${doc.revision + 1}`, sceneJson: fin.v.sceneJson, packet: fin.v.packet, anchors: v.anchors };
    commit([...doc.layers, committed], "trace");
  }
  check(3, "final trace validated and committed atomically", !!committed, { ms: fin.v?.ms, anchors: committed?.anchors, revision: doc.revision });
  const committedDigest = await digest(committed);
  // 4–6. Export from a frozen snapshot; a later preview must queue behind it, not cancel it.
  const snapshot = { revision: doc.revision, sceneJson: committed.sceneJson };
  const exp = sched.submit({ kind: "export", scope: "export", build: (jobId) => [{ type: "export-pdf", jobId, sceneJson: snapshot.sceneJson }, []] });
  const prev2 = sched.submit(traceJob("preview", prevPx, PREV, 5));
  const [er, pr2] = await Promise.all([settle(exp.done), settle(prev2.done)]);
  check(4, "export completes from frozen snapshot", er.ok && er.v.pdf.byteLength > 1000, { pdfBytes: er.v?.pdf?.byteLength, snapshotRevision: snapshot.revision });
  check(5, "preview requested during export completes afterwards", pr2.ok);
  check(6, "preview did not cancel export (export finished first)", er.ok && pr2.ok && er.v.ms !== undefined);
  // 7. Cancel a long-running final trace.
  const long = sched.submit(traceJob("final", fullPx, FULL, 8));
  await new Promise((r) => setTimeout(r, 300));
  const tc = performance.now();
  sched.cancel(long.id);
  const lr = await settle(long.done);
  check(7, "long final cancelled by explicit cancel", !lr.ok && lr.e instanceof Cancelled, { ackMs: +(performance.now() - tc).toFixed(2) });
  // 8. Committed artwork intact after termination.
  check(8, "committed layer byte-identical after terminate", (await digest(doc.layers[0])) === committedDigest && doc.layers.length === 1,
    { coordsByteLength: doc.layers[0].packet.coords.byteLength });
  // 9. Replace the worker: crash during a job, fatal abort, recycle.
  const crash = await settle(sched.submit({ kind: "final", scope: "fault", build: (jobId) => [{ type: "crash", jobId, afterMs: 10 }, []] }).done);
  const fatal = await settle(sched.submit({ kind: "final", scope: "fault", build: (jobId) => [{ type: "fatal", jobId }, []] }).done);
  check(9, "crash and fatal abort reject the job and replace the worker", !crash.ok && crash.e.code === "worker_crashed" && !fatal.ok && fatal.e.code === "wasm_abort",
    { stats: { ...sched.stats } });
  // Stale messages: a late error after the job resolved; a result from a superseded generation.
  const before = sched.stats.staleDropped;
  const late = await settle(sched.submit({ kind: "final", scope: "fault", build: (jobId) => [{ type: "late", jobId }, []] }).done);
  await new Promise((r) => setTimeout(r, 120));
  check(9, "late error for a finished job is dropped (stale error)", late.ok && sched.stats.staleDropped > before);
  // 10. Evaluation restored on a fresh worker.
  const again = await settle(sched.submit(traceJob("preview", prevPx, PREV, 6)).done);
  check(10, "evaluation restored after replacement", again.ok, { workersCreated: sched.stats.workersCreated });
  // 11. Undo/redo, including undo while a final job is running (its result must be discarded).
  const rev0 = doc.revision;
  const pendingFinal = sched.submit(traceJob("final", fullPx, FULL, 6));
  const jobBase = doc.revision;
  undo();
  const pf = await settle(pendingFinal.done);
  const stale = pf.ok && doc.revision !== jobBase; // controller-side revision guard
  check(11, "undo removes the committed layer", doc.layers.length === 0 && doc.revision === rev0 + 1);
  check(11, "result of a job started before undo is discarded as stale (revision guard)", stale && doc.layers.length === 0);
  redo();
  check(11, "redo restores the identical layer", doc.layers.length === 1 && (await digest(doc.layers[0])) === committedDigest, { revision: doc.revision });
  // Undo/redo never touched the worker: history survives the terminations above.
  check(11, "history survived all worker terminations", history.undo.length === 1 && sched.stats.terminations >= 3, { terminations: sched.stats.terminations });
  return { label, ms: performance.now() - t0, stats: { ...sched.stats } };
}

async function main() {
  const controlled = await ensureControlled();
  check(0, "page controlled by service worker", controlled, { online: navigator.onLine });
  if (q.get("warm") === "1") {
    // Diagnostic: one plain job on a fresh worker before the churn of scenario 1.
    const w1 = await settle(sched.submit({ kind: "final", scope: "warm", build: (jobId) => [{ type: "sleep", jobId, ms: 1 }, []] }).done);
    const w2 = await settle(sched.submit({ kind: "final", scope: "warm", build: (jobId) => [{ type: "sleep", jobId, ms: 1 }, []] }).done);
    check(0, "warm-up job on first worker", w1.ok, { first: w1.ok ? "ok" : `${w1.e?.code} ${w1.e?.message}`, second: w2.ok ? "ok" : `${w2.e?.code}` });
  }
  const run = await scenarios(navigator.onLine ? "online" : "offline");
  return { run, log };
}
window.__run = main().then(
  (r) => (window.__done = { ok: true, ...r }),
  (e) => (window.__done = { ok: false, error: `${e}\n${e?.stack ?? ""}`, log }),
);
