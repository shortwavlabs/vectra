// Compute worker (protocol v2, C5 r2). Owns the WASM instance and processes one message at a
// time; long WASM calls are synchronous, so cancellation is the scheduler terminating it.
// Traces use the staged engine API (C4: segment → estimate → fit) and report each stage as it
// starts; there are no percentages. The estimate is reported, never acted on: the engine's own
// limits stay authoritative and nothing is downsampled.
import init, {
  engineVersion,
  exportDrawListPdf,
  exportDrawListSvg,
  memoryBytes,
  PacketSet,
  segment,
} from "../../packages/vector-engine-wasm/pkg/vector_engine_wasm.js";
import type { TransferPacket } from "../document/packet-port.ts";
import { BUILD_IDENTITY } from "./build-info.ts";
import {
  type DebugFault,
  type Estimate,
  packetBuffers,
  type Stage,
  type WorkerRequest,
  type WorkerResponse,
} from "./protocol.ts";

interface WorkerScope {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
}
const scope = self as unknown as WorkerScope;
const post = (m: WorkerResponse, transfer: Transferable[] = []) => scope.postMessage(m, transfer);

/** Engine errors are JSON strings `{code, message}`; anything else (a trap) is fatal. */
function toError(jobId: number, generation: number, e: unknown): WorkerResponse {
  if (typeof e === "string") {
    try {
      const { code, message } = JSON.parse(e) as { code: string; message: string };
      return { type: "error", jobId, generation, code, message, fatal: false };
    } catch {
      return { type: "error", jobId, generation, code: "engine_error", message: e, fatal: false };
    }
  }
  const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return { type: "error", jobId, generation, code: "wasm_abort", message, fatal: true };
}

const t0 = performance.now();
await init();
post({
  type: "ready",
  ...BUILD_IDENTITY,
  engineVersion: engineVersion(), // what the loaded WASM reports, not what the page expects
  initMs: performance.now() - t0,
  memoryBytes: memoryBytes(),
});

const faults = new Set<DebugFault>();
const take = (f: DebugFault) => faults.delete(f);

scope.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === "debug") {
    if (msg.fault === "crash-now")
      setTimeout(() => {
        throw new Error("injected worker crash (debug)");
      });
    else faults.add(msg.fault);
    return;
  }
  const { jobId, generation } = msg;
  const progress = (stage: Stage) => post({ type: "progress", jobId, generation, stage });
  try {
    post({ type: "status", jobId, generation, state: "processing" });
    if (take("crash-next-job")) {
      progress(msg.type === "trace" ? "segment" : "serialize");
      setTimeout(() => {
        throw new Error("injected worker crash during a job (debug)");
      });
      return;
    }
    if (take("fatal-next-job")) throw new WebAssembly.RuntimeError("injected fatal abort (debug)");

    let response: Extract<WorkerResponse, { type: "result" }>;
    let transfer: ArrayBuffer[];
    if (msg.type === "trace") {
      progress("segment");
      let t = performance.now();
      const handle = segment(
        new Uint8Array(msg.rgba),
        msg.width,
        msg.height,
        JSON.stringify(msg.request),
      );
      const segmentMs = performance.now() - t;
      progress("estimate");
      t = performance.now();
      const estimate = JSON.parse(handle.estimateJson()) as Estimate;
      const estimateMs = performance.now() - t;
      progress("fit");
      t = performance.now();
      const r = handle.fitPacket(); // consumes the segmentation
      const fitMs = performance.now() - t;
      t = performance.now();
      const manifest = JSON.parse(r.manifestJson) as TransferPacket["manifest"];
      const report = JSON.parse(r.reportJson) as Pick<
        Extract<typeof response.result, { type: "trace" }>,
        "metrics" | "warnings"
      >;
      const sceneMetaJson = r.sceneMetaJson;
      // One copy out of WASM memory per array: fresh, whole-buffer arrays (C2 rule 1, C4).
      const packet: TransferPacket = {
        manifest,
        verbs: r.takeVerbs(),
        coords: r.takeCoords(),
        verbOffsets: r.takeVerbOffsets(),
        coordOffsets: r.takeCoordOffsets(),
        styleIndex: r.takeStyleIndex(),
        groupIndex: r.takeGroupIndex(),
      };
      r.free();
      const parseMs = performance.now() - t;
      transfer = packetBuffers(packet);
      response = {
        type: "result",
        jobId,
        generation,
        memoryBytes: memoryBytes(),
        result: {
          type: "trace",
          packet,
          sceneMetaJson,
          metrics: report.metrics,
          warnings: report.warnings,
          estimate,
          timings: { segmentMs, estimateMs, fitMs, parseMs },
        },
      };
    } else {
      progress("serialize");
      const t = performance.now();
      const set = new PacketSet();
      let bytes: ArrayBuffer;
      try {
        for (const p of msg.chunks)
          set.add(
            JSON.stringify(p.manifest),
            p.verbs,
            p.coords,
            p.verbOffsets,
            p.coordOffsets,
            p.styleIndex,
            p.groupIndex,
          );
        const dl = JSON.stringify(msg.drawList);
        const sm = JSON.stringify(msg.sceneMeta);
        if (msg.format === "svg") {
          bytes = new TextEncoder().encode(exportDrawListSvg(dl, sm, set)).buffer as ArrayBuffer;
        } else {
          const u = exportDrawListPdf(dl, sm, JSON.stringify(msg.options), set);
          bytes =
            u.byteOffset === 0 && u.byteLength === u.buffer.byteLength
              ? (u.buffer as ArrayBuffer)
              : (u.slice().buffer as ArrayBuffer);
        }
      } finally {
        set.free();
      }
      transfer = [bytes];
      response = {
        type: "result",
        jobId,
        generation,
        memoryBytes: memoryBytes(),
        result: {
          type: "export",
          format: msg.format,
          bytes,
          timings: { exportMs: performance.now() - t },
        },
      };
    }

    if (take("wrong-generation-next-result"))
      response = { ...response, generation: generation + 1000 };
    post(response, transfer);
    if (take("duplicate-next-result"))
      post({
        type: "result",
        jobId,
        generation,
        memoryBytes: memoryBytes(),
        result: {
          type: "export",
          format: "svg",
          bytes: new ArrayBuffer(0),
          timings: { exportMs: 0 },
        },
      });
    if (take("stale-progress-after-next-result")) progress("fit");
    if (take("late-error-after-next-result"))
      setTimeout(
        () =>
          post({
            type: "error",
            jobId,
            generation,
            code: "late_error",
            message: "injected late error (debug)",
            fatal: false,
          }),
        50,
      );
  } catch (e) {
    post(toError(jobId, generation, e));
  }
};
