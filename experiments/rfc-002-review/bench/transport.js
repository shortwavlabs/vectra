// R01 browser transport benchmark (main thread). Query: ?kind=real|synth&name=<scene>&reps=6
import { validatePacket } from "./packet.mjs";
import { now, pathsFromPacket, pathsFromScene, probe, twoFrames } from "./common.mjs";

const q = new URLSearchParams(location.search);
const kind = q.get("kind"), name = q.get("name"), reps = Number(q.get("reps") ?? 6);
const worker = new Worker("transport-worker.js", { type: "module" });
const once = () => new Promise((r) => (worker.onmessage = (e) => r([e.data, now()])));

async function run() {
  worker.postMessage({ type: "load", kind, name });
  await once();
  const results = [];
  for (const mode of ["json-string", "json-object", "packet-clone", "packet-transfer"]) {
    for (let rep = 0; rep < reps; rep++) {
      await twoFrames();
      const stop = probe();
      const tReq = now();
      worker.postMessage({ type: "send", mode });
      const [msg, tRecv] = await once();
      let t = now(), geom;
      const r = { mode, rep, deliverMs: tRecv - msg.t, requestToReceiveMs: tRecv - tReq };
      if (mode === "json-string") {
        geom = JSON.parse(msg.json);
        r.parseMs = now() - t;
      } else if (mode === "json-object") geom = msg.obj;
      else {
        const v = validatePacket(msg.p);
        r.validateMs = now() - t;
        r.anchors = v.anchors;
        geom = msg.p;
      }
      t = now();
      const paths = mode.startsWith("json") ? pathsFromScene(geom) : pathsFromPacket(geom);
      r.path2dMs = now() - t;
      r.paths = paths.length;
      r.receiveToRendererMs = now() - tRecv;
      r.requestToRendererMs = now() - tReq;
      await twoFrames();
      const s = stop();
      r.maxFrameGapMs = s.maxGap;
      r.longTasks = s.longTasks;
      r.longestTaskMs = s.longestTask;
      if (performance.memory) r.jsHeapMB = performance.memory.usedJSHeapSize / 2 ** 20;
      results.push(r);
    }
  }
  return results;
}

window.__result = run().then(
  (r) => (window.__done = { ok: true, results: r }),
  (e) => (window.__done = { ok: false, error: String(e) }),
);
