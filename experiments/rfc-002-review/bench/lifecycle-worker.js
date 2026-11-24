// R03 compute worker: the real engine (built WASM package) plus fault injection hooks.
import init, { memoryBytes, sceneToPdf, vectorize } from "/pkg/vector_engine_wasm.js";
import { encodeScene, transferList } from "./packet.mjs";

await init();
self.postMessage({ type: "ready", memoryBytes: memoryBytes() });

const err = (jobId, e) => {
  if (typeof e === "string") {
    const p = JSON.parse(e);
    return { type: "error", jobId, code: p.code, message: p.message, fatal: false };
  }
  return { type: "error", jobId, code: "wasm_abort", message: String(e), fatal: true };
};

self.onmessage = ({ data: m }) => {
  try {
    if (m.type === "trace") {
      const t = performance.now();
      const res = vectorize(new Uint8Array(m.rgba), m.width, m.height, JSON.stringify(m.request));
      const sceneJson = res.scene;
      const report = JSON.parse(res.report);
      res.free();
      const packet = encodeScene(JSON.parse(sceneJson));
      self.postMessage({ type: "result", jobId: m.jobId, sceneJson, packet, metrics: report.metrics,
        ms: performance.now() - t, memoryBytes: memoryBytes() }, transferList(packet));
    } else if (m.type === "export-pdf") {
      const t = performance.now();
      const bytes = sceneToPdf(m.sceneJson, JSON.stringify({ width: 200, unit: "mm" }));
      const pdf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      self.postMessage({ type: "result", jobId: m.jobId, pdf, ms: performance.now() - t, memoryBytes: memoryBytes() }, [pdf]);
    } else if (m.type === "crash") {
      setTimeout(() => {
        throw new Error("injected worker crash");
      }, m.afterMs ?? 0);
    } else if (m.type === "fatal") {
      self.postMessage({ type: "error", jobId: m.jobId, code: "wasm_abort", message: "injected fatal abort", fatal: true });
    } else if (m.type === "late") {
      // Replies twice: a result, then (after the controller moved on) a late error for the same job.
      self.postMessage({ type: "result", jobId: m.jobId, memoryBytes: memoryBytes() });
      setTimeout(() => self.postMessage({ type: "error", jobId: m.jobId, code: "late", message: "late error", fatal: false }), 50);
    } else if (m.type === "sleep") {
      const end = performance.now() + m.ms;
      while (performance.now() < end); // synchronous, like a long WASM call
      self.postMessage({ type: "result", jobId: m.jobId, memoryBytes: memoryBytes() });
    }
  } catch (e) {
    self.postMessage(err(m.jobId ?? null, e));
  }
};
