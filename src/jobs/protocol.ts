// Compute-worker protocol v2 (C5 r2, RFC-002 §10.2). Every request carries the job header;
// every response echoes `jobId` and `generation`. The worker announces its build identity in an
// unsolicited `ready` message, and nothing is posted to it before that handshake passes.
import type { ExportDrawList, ExportSceneMeta } from "../document/export.ts";
import type { TransferPacket } from "../document/packet-port.ts";
import type {
  EngineMetrics,
  EngineWarning,
  PdfOptions,
  TraceRequest,
} from "../vectorization/types.ts";

export const PROTOCOL_VERSION = 2;

/** Scheduling classes (RFC §10.3 rule 1). */
export type JobKind = "thumbnail" | "preview" | "final" | "apply" | "export";
export const PRIORITY: Readonly<Record<JobKind, number>> = {
  thumbnail: 0,
  preview: 1,
  final: 2,
  apply: 2,
  export: 3,
};
/** Explicit operations are accepted or rejected at submission and never cancelled implicitly. */
export const isExplicit = (k: JobKind) => k === "final" || k === "apply" || k === "export";

/** Operation versions (C6): the trace preset version, and the AM-1 export draw-list version. */
export const EXPORT_OPERATION_VERSION = 1;

export interface BuildIdentity {
  readonly protocolVersion: number;
  readonly buildId: string;
  readonly engineVersion: string;
  readonly packetVersion: number;
}

export interface JobHeader {
  readonly jobId: number;
  readonly generation: number;
  readonly kind: JobKind;
  readonly documentRevision: number;
  readonly operationVersion: number;
  readonly sourceDigest?: string;
}

/** Engine stages the worker reports as they start; there are no percentages (C5). */
export type Stage = "segment" | "estimate" | "fit" | "validate" | "serialize";

/** Fault injection, honoured only when the page runs with `?debug=1` (engineering tests). */
export type DebugFault =
  | "crash-now"
  | "crash-next-job"
  | "fatal-next-job"
  | "duplicate-next-result"
  | "late-error-after-next-result"
  | "stale-progress-after-next-result"
  | "wrong-generation-next-result";

export type WorkerRequest =
  | (JobHeader & {
      type: "trace";
      /** Transferred: a job copy, never a committed or retained buffer. */
      rgba: ArrayBuffer;
      width: number;
      height: number;
      request: TraceRequest;
      quality: "preview" | "final";
      sourceDigest: string;
    })
  | (JobHeader & {
      type: "export";
      format: "svg" | "pdf";
      drawList: ExportDrawList;
      /** Job copies (`GeometryStore.jobCopy`), indexed by the draw list's `chunk`. */
      chunks: TransferPacket[];
      sceneMeta: ExportSceneMeta;
      options: PdfOptions | null;
    })
  | { type: "debug"; generation: number; fault: DebugFault };

/** The staged estimate (C4), reported as-is; it never rejects or downsamples by itself. */
export type Estimate =
  | { kind: "range"; anchorsLow: number; anchorsHigh: number; basis: string }
  | { kind: "unavailable"; reason: string };

export interface TraceResult {
  type: "trace";
  packet: TransferPacket;
  sceneMetaJson: string;
  metrics: EngineMetrics;
  warnings: EngineWarning[];
  estimate: Estimate;
  timings: { segmentMs: number; estimateMs: number; fitMs: number; parseMs: number };
}
export interface ExportResult {
  type: "export";
  format: "svg" | "pdf";
  bytes: ArrayBuffer;
  timings: { exportMs: number };
}

export type WorkerResponse =
  | ({ type: "ready"; initMs: number; memoryBytes: number } & BuildIdentity)
  | { type: "status"; jobId: number; generation: number; state: "processing" }
  | { type: "progress"; jobId: number; generation: number; stage: Stage }
  | {
      type: "result";
      jobId: number;
      generation: number;
      result: TraceResult | ExportResult;
      memoryBytes: number;
    }
  | {
      type: "error";
      jobId: number;
      generation: number;
      code: string;
      message: string;
      /** The WASM instance may be corrupt; the worker must be replaced. */
      fatal: boolean;
    };

/** Transfer list for a packet's six section buffers. */
export const packetBuffers = (p: TransferPacket): ArrayBuffer[] => [
  p.verbs.buffer as ArrayBuffer,
  p.coords.buffer as ArrayBuffer,
  p.verbOffsets.buffer as ArrayBuffer,
  p.coordOffsets.buffer as ArrayBuffer,
  p.styleIndex.buffer as ArrayBuffer,
  p.groupIndex.buffer as ArrayBuffer,
];
