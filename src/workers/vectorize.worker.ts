// Vectorization worker: owns the WASM instance. Processes one message at a time; long WASM
// calls are synchronous, so cancellation is done by the client terminating this worker.
import init, {
  engineVersion,
  memoryBytes,
  sceneToPdf,
  vectorize,
} from "../../packages/vector-engine-wasm/pkg/vector_engine_wasm.js";
import type { WorkerRequest, WorkerResponse } from "./protocol.ts";

interface WorkerScope {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
}
const scope = self as unknown as WorkerScope;
const post = (m: WorkerResponse, transfer: Transferable[] = []) => scope.postMessage(m, transfer);

/** Engine errors are thrown as JSON strings; anything else (e.g. RuntimeError) is fatal. */
function toError(jobId: number | null, e: unknown): WorkerResponse {
  if (typeof e === "string") {
    try {
      const parsed = JSON.parse(e) as { code: string; message: string };
      return { type: "error", jobId, code: parsed.code, message: parsed.message, fatal: false };
    } catch {
      return { type: "error", jobId, code: "engine_error", message: e, fatal: false };
    }
  }
  const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return { type: "error", jobId, code: "wasm_abort", message, fatal: true };
}

const t0 = performance.now();
await init();
post({
  type: "ready",
  engineVersion: engineVersion(),
  initMs: performance.now() - t0,
  memoryBytes: memoryBytes(),
});

scope.onmessage = (event) => {
  const msg = event.data;
  try {
    if (msg.type === "trace") {
      post({ type: "status", jobId: msg.jobId, state: "processing" });
      const t = performance.now();
      const result = vectorize(
        new Uint8Array(msg.rgba),
        msg.width,
        msg.height,
        JSON.stringify(msg.request),
      );
      const wasmCallMs = performance.now() - t;
      const { scene: sceneJson, report, svg, svgMs } = result;
      result.free();
      const tp = performance.now();
      const parsed = JSON.parse(report) as Pick<
        Extract<WorkerResponse, { type: "trace-result" }>,
        "metrics" | "warnings"
      >;
      const parseMs = performance.now() - tp;
      post({
        type: "trace-result",
        jobId: msg.jobId,
        revision: msg.revision,
        sceneJson,
        svg,
        metrics: parsed.metrics,
        warnings: parsed.warnings,
        timings: { wasmCallMs, svgMs, parseMs },
        memoryBytes: memoryBytes(),
      });
    } else if (msg.type === "debug-crash") {
      setTimeout(() => {
        throw new Error("injected worker crash (debug)");
      });
    } else if (msg.type === "export-pdf") {
      const t = performance.now();
      const bytes = sceneToPdf(msg.sceneJson, JSON.stringify(msg.options));
      const ms = performance.now() - t;
      const pdf = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      post({ type: "pdf-result", jobId: msg.jobId, pdf, ms, memoryBytes: memoryBytes() }, [pdf]);
    }
  } catch (e) {
    post(toError("jobId" in msg ? msg.jobId : null, e));
  }
};
