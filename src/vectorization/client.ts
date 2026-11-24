// Main-thread client for the vectorization worker.
//
// Semantics:
// - One job in flight at a time. Starting a trace cancels any in-flight job ("latest wins").
// - Cancellation terminates the worker: synchronous WASM cannot observe a cancel message.
//   A fresh worker (and WASM instance) is created lazily for the next job.
// - Every job has a unique jobId; messages for any other jobId, or from a terminated worker,
//   are dropped and counted, so stale results can never resolve a newer job.
// - Worker crashes and fatal WASM aborts reject the job and discard the worker.
// - WASM linear memory never shrinks, so the worker is recycled after a job that leaves it
//   above `recycleAboveBytes`.
import type { TraceTimings, WorkerRequest, WorkerResponse } from "../workers/protocol.ts";
import type { EngineMetrics, EngineWarning, PdfOptions, TraceRequest } from "./types.ts";

export class CancelledError extends Error {
  override name = "CancelledError";
}

export class JobError extends Error {
  override name = "JobError";
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface ReadyInfo {
  engineVersion: string;
  initMs: number;
  memoryBytes: number;
}

export interface TraceOutcome {
  jobId: number;
  revision: number;
  sceneJson: string;
  svg: string;
  metrics: EngineMetrics;
  warnings: EngineWarning[];
  timings: TraceTimings;
  memoryBytes: number;
  /** postMessage to result, including transfer and worker start-up if one was needed. */
  roundTripMs: number;
}

export interface PdfOutcome {
  bytes: Uint8Array<ArrayBuffer>;
  ms: number;
  memoryBytes: number;
}

/** Minimal Worker surface used by the client (lets tests inject a fake). */
export interface WorkerLike {
  postMessage(message: WorkerRequest, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}

export interface ClientOptions {
  createWorker: () => WorkerLike;
  recycleAboveBytes?: number;
  onStatus?: (jobId: number) => void;
}

interface Generation {
  worker: WorkerLike;
  ready: Promise<ReadyInfo>;
  resolveReady: (info: ReadyInfo) => void;
  rejectReady: (e: Error) => void;
}

interface Pending {
  jobId: number;
  kind: "trace" | "pdf";
  started: number;
  resolve: (value: never) => void;
  reject: (e: Error) => void;
}

export class VectorizerClient {
  private gen: Generation | null = null;
  private pending: Pending | null = null;
  private nextJobId = 1;
  readonly stats = { workersCreated: 0, terminations: 0, staleMessagesDropped: 0 };
  lastReady: ReadyInfo | null = null;

  private readonly opts: ClientOptions;
  constructor(opts: ClientOptions) {
    this.opts = opts;
  }

  get busy(): boolean {
    return this.pending !== null;
  }

  private spawn(): Generation {
    if (this.gen) return this.gen;
    const worker = this.opts.createWorker();
    this.stats.workersCreated++;
    let resolveReady!: (info: ReadyInfo) => void;
    let rejectReady!: (e: Error) => void;
    const ready = new Promise<ReadyInfo>((res, rej) => {
      resolveReady = res;
      rejectReady = rej;
    });
    ready.catch(() => {}); // observed via the pending job instead
    const gen: Generation = { worker, ready, resolveReady, rejectReady };
    worker.onmessage = (e) => {
      if (this.gen !== gen) {
        this.stats.staleMessagesDropped++;
        return;
      }
      this.onMessage(gen, e.data);
    };
    const crash = (message: string) => {
      if (this.gen !== gen) return;
      this.discard();
      const err = new JobError("worker_crashed", message);
      gen.rejectReady(err);
      this.settle(this.pending?.jobId ?? -1, undefined, err);
    };
    worker.onerror = (e) => {
      e.preventDefault?.();
      crash(e.message || "worker error");
    };
    worker.onmessageerror = () => crash("worker message could not be deserialised");
    this.gen = gen;
    return gen;
  }

  private discard(): void {
    if (!this.gen) return;
    this.gen.rejectReady(new CancelledError("worker discarded"));
    this.gen.worker.onmessage = null;
    this.gen.worker.onerror = null;
    this.gen.worker.onmessageerror = null;
    this.gen.worker.terminate();
    this.gen = null;
    this.stats.terminations++;
  }

  private settle(jobId: number, value: unknown, error?: Error): boolean {
    const p = this.pending;
    if (!p || p.jobId !== jobId) {
      this.stats.staleMessagesDropped++;
      return false;
    }
    this.pending = null;
    if (error) p.reject(error);
    else p.resolve(value as never);
    return true;
  }

  private onMessage(gen: Generation, msg: WorkerResponse): void {
    switch (msg.type) {
      case "ready":
        this.lastReady = {
          engineVersion: msg.engineVersion,
          initMs: msg.initMs,
          memoryBytes: msg.memoryBytes,
        };
        gen.resolveReady(this.lastReady);
        return;
      case "status":
        if (this.pending?.jobId === msg.jobId) this.opts.onStatus?.(msg.jobId);
        return;
      case "trace-result": {
        const roundTripMs = performance.now() - (this.pending?.started ?? performance.now());
        const { type: _type, ...rest } = msg;
        if (this.settle(msg.jobId, { ...rest, roundTripMs } satisfies TraceOutcome))
          this.maybeRecycle(msg.memoryBytes);
        return;
      }
      case "pdf-result":
        if (
          this.settle(msg.jobId, {
            bytes: new Uint8Array(msg.pdf),
            ms: msg.ms,
            memoryBytes: msg.memoryBytes,
          } satisfies PdfOutcome)
        )
          this.maybeRecycle(msg.memoryBytes);
        return;
      case "error":
        if (msg.fatal) this.discard();
        this.settle(
          msg.jobId ?? this.pending?.jobId ?? -1,
          undefined,
          new JobError(msg.code, msg.message),
        );
        return;
    }
  }

  private maybeRecycle(memoryBytes: number): void {
    if (memoryBytes > (this.opts.recycleAboveBytes ?? 1024 * 1024 * 1024)) this.discard();
  }

  private run<T>(
    kind: Pending["kind"],
    build: (jobId: number) => [WorkerRequest, Transferable[]],
  ): Promise<T> {
    const jobId = this.nextJobId++;
    const result = new Promise<T>((resolve, reject) => {
      this.pending = {
        jobId,
        kind,
        started: performance.now(),
        resolve: resolve as (v: never) => void,
        reject,
      };
    });
    const gen = this.spawn();
    // Post once the worker is ready, unless the job was cancelled or the worker replaced meanwhile.
    gen.ready.then(
      () => {
        if (this.pending?.jobId === jobId && this.gen === gen) {
          const [message, transfer] = build(jobId);
          gen.worker.postMessage(message, transfer);
        }
      },
      () => {}, // a failed start-up already rejected the job
    );
    return result;
  }

  /** Starts the worker and WASM instance ahead of the first job (also loads them for offline use). */
  warmup(): Promise<ReadyInfo> {
    return this.spawn().ready;
  }

  /** Starts a trace, cancelling any in-flight job. `rgba` is transferred and becomes detached. */
  trace(
    input: { rgba: ArrayBuffer; width: number; height: number; revision: number },
    request: TraceRequest,
  ): Promise<TraceOutcome> {
    this.cancel();
    return this.run<TraceOutcome>("trace", (jobId) => [
      {
        type: "trace",
        jobId,
        revision: input.revision,
        width: input.width,
        height: input.height,
        rgba: input.rgba,
        request,
      },
      [input.rgba],
    ]);
  }

  /** Exports a PDF from a canonical scene. Rejects if another job is in flight. */
  exportPdf(sceneJson: string, options: PdfOptions): Promise<PdfOutcome> {
    if (this.pending) return Promise.reject(new JobError("busy", "another job is in progress"));
    return this.run<PdfOutcome>("pdf", (jobId) => [
      { type: "export-pdf", jobId, sceneJson, options },
      [],
    ]);
  }

  /** Cancels the in-flight job (if any) by terminating the worker. Returns whether a job was cancelled. */
  cancel(): boolean {
    const p = this.pending;
    if (!p) return false;
    this.discard();
    this.settle(p.jobId, undefined, new CancelledError(`job ${p.jobId} cancelled`));
    return true;
  }

  dispose(): void {
    this.cancel();
    this.discard();
  }
}
