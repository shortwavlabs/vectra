// Typed main-thread <-> worker protocol. Every job carries a unique jobId; trace jobs also
// carry the source image revision so the UI can reject results for a replaced image.
import type {
  EngineMetrics,
  EngineWarning,
  PdfOptions,
  TraceRequest,
} from "../vectorization/types.ts";

export type WorkerRequest =
  | {
      type: "trace";
      jobId: number;
      revision: number;
      width: number;
      height: number;
      /** Transferred (detached on the sender side). */
      rgba: ArrayBuffer;
      request: TraceRequest;
    }
  | { type: "export-pdf"; jobId: number; sceneJson: string; options: PdfOptions }
  /** Engineering fault injection (workbench `?debug=1` only): throw an uncaught error. */
  | { type: "debug-crash" };

export interface TraceTimings {
  /** Time inside the WASM vectorize call (trace + SVG serialisation). */
  wasmCallMs: number;
  svgMs: number;
  /** JSON.parse of the metrics/warnings report in the worker. */
  parseMs: number;
}

export type WorkerResponse =
  | { type: "ready"; engineVersion: string; initMs: number; memoryBytes: number }
  | { type: "status"; jobId: number; state: "processing" }
  | {
      type: "trace-result";
      jobId: number;
      revision: number;
      sceneJson: string;
      svg: string;
      metrics: EngineMetrics;
      warnings: EngineWarning[];
      timings: TraceTimings;
      memoryBytes: number;
    }
  | { type: "pdf-result"; jobId: number; pdf: ArrayBuffer; ms: number; memoryBytes: number }
  | {
      type: "error";
      jobId: number | null;
      code: string;
      message: string;
      /** The WASM instance may be corrupt (panic/abort); the worker must be replaced. */
      fatal: boolean;
    };
