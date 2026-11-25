// Production compute-worker scheduler (RFC-002 §10.3, C5 r2). One worker generation at a time,
// terminate-and-recreate cancellation (synchronous WASM cannot observe a cancel message).
//
// - Priorities: export > final = apply > preview > thumbnail; FIFO within a priority.
// - Only previews and thumbnails are pre-empted (by a newer job of the same kind and scope, or
//   by any higher-priority job) and superseded (one pending job per kind and scope).
// - Explicit jobs (final, apply, export) are accepted into a bounded queue or rejected with
//   `busy` before acceptance. Once accepted they end only in success, a typed failure or an
//   explicit cancel; nothing cancels them implicitly.
// - Nothing is posted before the worker's `ready` handshake passes, and a starting worker is
//   never terminated because its job went away (R03: WebKit offline start-up under churn).
//   Only the start-up timeout discards a starting worker; its job is requeued once if it never
//   ran. A worker from another build is refused (fatal build skew, no requeue).
// - Messages are accepted only from the current generation and for the posted job; everything
//   else is dropped and counted. Every submitted job settles exactly once.
import {
  type BuildIdentity,
  type DebugFault,
  type ExportResult,
  isExplicit,
  type JobHeader,
  type JobKind,
  PRIORITY,
  type Stage,
  type TraceResult,
  type WorkerRequest,
  type WorkerResponse,
} from "./protocol.ts";

/** Minimal Worker surface (lets tests inject a fake). */
export interface WorkerLike {
  postMessage(message: WorkerRequest, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}

export type CancelReason = "user" | "superseded" | "preempted" | "disposed";

export interface JobTimings {
  /** Submission → posted to the worker (includes worker start-up). */
  readonly queuedMs: number;
  /** Posted → result received on the main thread (C9 "worker execution"). */
  readonly workerMs: number;
  /** Main-thread time to build and post the request (job copies included). */
  readonly postMs: number;
}

export type JobOutcome =
  | {
      readonly status: "succeeded";
      readonly result: TraceResult | ExportResult;
      readonly memoryBytes: number;
      readonly timings: JobTimings;
    }
  | { readonly status: "cancelled"; readonly reason: CancelReason }
  | { readonly status: "failed"; readonly code: string; readonly message: string };

export interface JobSpec {
  readonly kind: JobKind;
  /** Supersession scope for previews and thumbnails (one pending job per kind and scope). */
  readonly scope: string;
  readonly documentRevision: number;
  readonly operationVersion: number;
  readonly sourceDigest?: string;
  /** Builds the request when the job is posted; job copies are allocated here, not earlier. */
  build(header: JobHeader): [WorkerRequest, Transferable[]];
  onProgress?(stage: Stage): void;
}

export interface QueuedJob {
  readonly jobId: number;
  readonly kind: JobKind;
}

export type Submission =
  | { readonly accepted: true; readonly jobId: number; readonly done: Promise<JobOutcome> }
  | {
      readonly accepted: false;
      readonly code: "busy";
      readonly message: string;
      readonly queued: readonly QueuedJob[];
      readonly running: QueuedJob | null;
    }
  | {
      readonly accepted: false;
      readonly code: "build_mismatch" | "disposed";
      readonly message: string;
    };

export interface SchedulerOptions {
  createWorker(): WorkerLike;
  /** The identity this page was built with; a worker reporting anything else is refused. */
  identity: BuildIdentity;
  /** Explicit jobs that may wait (the running job is not counted). RFC §10.3: 4, provisional. */
  explicitCapacity?: number;
  /** RFC §10.3 rule 5: bounded start-up (10 s initially). */
  startupTimeoutMs?: number;
  /** RFC §11.4: recycle after a job that leaves WASM memory above this (reference: 1 GiB). */
  recycleAboveBytes?: number;
  onBuildMismatch?(detail: string): void;
  now?(): number;
}

export const BUILD_MISMATCH_MESSAGE =
  "This tab and its processing engine come from different versions of Vectra. Save your work, then reload the page.";
export const STARTUP_FAILED_MESSAGE =
  "The processing engine could not start (tried twice). If you are offline, the offline copy may be incomplete: reconnect and reload the page.";

interface Entry {
  readonly id: number;
  readonly spec: JobSpec;
  readonly submittedAt: number;
  postedAt: number;
  postMs: number;
  posted: boolean;
  retried: boolean;
  settled: boolean;
  resolve(o: JobOutcome): void;
}

interface Generation {
  readonly worker: WorkerLike;
  readonly generation: number;
  ready: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

const newDiagnostics = () => ({
  submitted: 0,
  workersCreated: 0,
  terminations: 0,
  handshakes: 0,
  buildMismatches: 0,
  startupTimeouts: 0,
  startupFailures: 0,
  startupRetries: 0,
  crashes: 0,
  fatalErrors: 0,
  recycles: 0,
  rejectedBusy: 0,
  superseded: 0,
  preempted: 0,
  cancelled: 0,
  succeeded: 0,
  failed: 0,
  /** Messages from a discarded worker. */
  staleGenerationDropped: 0,
  /** Messages from the current worker that echo another generation (it is terminated). */
  wrongGenerationDropped: 0,
  /** Results, errors, progress or status for a job that is not the posted job. */
  unmatchedDropped: 0,
  droppedResults: 0,
  droppedErrors: 0,
  droppedProgress: 0,
  /** Must stay 0: a second settle of one job. */
  settleViolations: 0,
});
export type SchedulerDiagnostics = ReturnType<typeof newDiagnostics>;

export class JobScheduler {
  readonly #o: Required<Omit<SchedulerOptions, "onBuildMismatch">> &
    Pick<SchedulerOptions, "onBuildMismatch">;
  #gen: Generation | null = null;
  #running: Entry | null = null;
  #queue: Entry[] = [];
  #nextJobId = 1;
  #nextGeneration = 1;
  #state: "ok" | "skewed" | "disposed" = "ok";
  #readyWaiters: ((r: BuildIdentity | null) => void)[] = [];
  readonly diag: SchedulerDiagnostics = newDiagnostics();
  lastReady: (BuildIdentity & { initMs: number; memoryBytes: number }) | null = null;
  lastMemoryBytes = 0;
  buildMismatch: string | null = null;

  constructor(o: SchedulerOptions) {
    this.#o = {
      explicitCapacity: 4,
      startupTimeoutMs: 10_000,
      recycleAboveBytes: 1024 ** 3,
      now: () => performance.now(),
      ...o,
    };
  }

  get state(): "ok" | "skewed" | "disposed" {
    return this.#state;
  }
  get running(): QueuedJob | null {
    return this.#running && { jobId: this.#running.id, kind: this.#running.spec.kind };
  }
  get queued(): readonly QueuedJob[] {
    return this.#sorted().map((e) => ({ jobId: e.id, kind: e.spec.kind }));
  }
  /** Whether an explicit job of `kind` would be accepted now (previews always are). */
  canAccept(kind: JobKind): boolean {
    if (this.#state !== "ok") return false;
    return !isExplicit(kind) || this.#explicitQueued() < this.#o.explicitCapacity;
  }

  submit(spec: JobSpec): Submission {
    if (this.#state === "disposed")
      return { accepted: false, code: "disposed", message: "the scheduler was disposed" };
    if (this.#state === "skewed")
      return { accepted: false, code: "build_mismatch", message: BUILD_MISMATCH_MESSAGE };
    if (!this.canAccept(spec.kind)) {
      this.diag.rejectedBusy++;
      const queued = this.queued.filter((q) => isExplicit(q.kind));
      return {
        accepted: false,
        code: "busy",
        message: `${queued.length} operations are already waiting; cancel one or wait for it to finish`,
        queued,
        running: this.running,
      };
    }
    this.diag.submitted++;
    let resolve!: (o: JobOutcome) => void;
    const done = new Promise<JobOutcome>((r) => (resolve = r));
    const entry: Entry = {
      id: this.#nextJobId++,
      spec,
      submittedAt: this.#o.now(),
      postedAt: 0,
      postMs: 0,
      posted: false,
      retried: false,
      settled: false,
      resolve,
    };
    if (!isExplicit(spec.kind)) {
      const i = this.#queue.findIndex(
        (e) => e.spec.kind === spec.kind && e.spec.scope === spec.scope,
      );
      if (i >= 0) {
        this.diag.superseded++;
        this.#settle(this.#queue.splice(i, 1)[0]!, { status: "cancelled", reason: "superseded" });
      }
    }
    this.#queue.push(entry);
    const r = this.#running;
    if (
      r &&
      !isExplicit(r.spec.kind) &&
      (PRIORITY[spec.kind] > PRIORITY[r.spec.kind] ||
        (spec.kind === r.spec.kind && spec.scope === r.spec.scope))
    ) {
      this.diag.preempted++;
      this.#abortRunning({ status: "cancelled", reason: "preempted" });
    }
    this.#dispatch();
    return { accepted: true, jobId: entry.id, done };
  }

  /** Explicit user cancel. A posted job terminates the worker; a starting worker is kept. */
  cancel(jobId: number): boolean {
    if (this.#running?.id === jobId) {
      this.diag.cancelled++;
      this.#abortRunning({ status: "cancelled", reason: "user" });
      this.#dispatch();
      return true;
    }
    const i = this.#queue.findIndex((e) => e.id === jobId);
    if (i < 0) return false;
    this.diag.cancelled++;
    this.#settle(this.#queue.splice(i, 1)[0]!, { status: "cancelled", reason: "user" });
    return true;
  }

  /** Starts a worker ahead of the first job (also loads its module graph for offline use). */
  warmup(): Promise<BuildIdentity | null> {
    if (this.#state !== "ok") return Promise.resolve(null);
    if (this.#gen?.ready) return Promise.resolve(this.lastReady);
    const p = new Promise<BuildIdentity | null>((r) => this.#readyWaiters.push(r));
    if (!this.#gen) {
      try {
        this.#spawn();
      } catch (e) {
        this.#startupFailure(null, false, e instanceof Error ? e.message : String(e));
      }
    }
    return p;
  }

  /** Engineering fault injection (`?debug=1`): forwarded to the current, ready worker. */
  inject(fault: DebugFault): boolean {
    const g = this.#gen;
    if (!g?.ready) return false;
    g.worker.postMessage({ type: "debug", generation: g.generation, fault }, []);
    return true;
  }

  dispose(): void {
    if (this.#state === "disposed") return;
    this.#state = "disposed";
    const r = this.#running;
    this.#running = null;
    if (r) this.#settle(r, { status: "cancelled", reason: "disposed" });
    for (const e of this.#queue.splice(0))
      this.#settle(e, { status: "cancelled", reason: "disposed" });
    this.#discard();
    this.#flushReady(null);
  }

  // --- internals ------------------------------------------------------------------------------
  #explicitQueued(): number {
    return this.#queue.filter((e) => isExplicit(e.spec.kind)).length;
  }
  #sorted(): Entry[] {
    return [...this.#queue].sort(
      (a, b) => PRIORITY[b.spec.kind] - PRIORITY[a.spec.kind] || a.id - b.id,
    );
  }

  #settle(e: Entry, o: JobOutcome): void {
    if (e.settled) {
      this.diag.settleViolations++;
      return;
    }
    e.settled = true;
    if (o.status === "succeeded") this.diag.succeeded++;
    else if (o.status === "failed") this.diag.failed++;
    e.resolve(o);
  }

  #abortRunning(o: JobOutcome): void {
    const r = this.#running;
    if (!r) return;
    this.#running = null;
    // Terminate only a worker that is running this job; a starting worker keeps loading and
    // simply receives the next job.
    if (r.posted) this.#discard();
    this.#settle(r, o);
  }

  #dispatch(): void {
    if (this.#state !== "ok" || this.#running || this.#queue.length === 0) return;
    const next = this.#sorted()[0]!;
    this.#queue.splice(this.#queue.indexOf(next), 1);
    this.#running = next;
    let g = this.#gen;
    if (!g) {
      try {
        g = this.#spawn();
      } catch (e) {
        this.#startupFailure(null, false, e instanceof Error ? e.message : String(e));
        return;
      }
    }
    if (g.ready) this.#post(next, g);
  }

  #post(e: Entry, g: Generation): void {
    const header: JobHeader = {
      jobId: e.id,
      generation: g.generation,
      kind: e.spec.kind,
      documentRevision: e.spec.documentRevision,
      operationVersion: e.spec.operationVersion,
      ...(e.spec.sourceDigest === undefined ? {} : { sourceDigest: e.spec.sourceDigest }),
    };
    const t0 = this.#o.now();
    try {
      const [message, transfer] = e.spec.build(header);
      g.worker.postMessage(message, transfer);
    } catch (err) {
      // Building or cloning the request failed on the main thread; the worker never saw it.
      this.#running = null;
      this.#settle(e, {
        status: "failed",
        code: "job_post_failed",
        message: err instanceof Error ? err.message : String(err),
      });
      this.#dispatch();
      return;
    }
    e.posted = true;
    e.postedAt = this.#o.now();
    e.postMs = e.postedAt - t0;
  }

  #spawn(): Generation {
    const worker = this.#o.createWorker();
    this.diag.workersCreated++;
    const g: Generation = { worker, generation: this.#nextGeneration++, ready: false, timer: null };
    g.timer = setTimeout(
      () => this.#startupFailure(g, true, "the worker did not report ready in time"),
      this.#o.startupTimeoutMs,
    );
    worker.onmessage = (ev) => this.#onMessage(g, ev.data);
    worker.onerror = (ev) => {
      ev.preventDefault?.();
      this.#onWorkerError(g, ev.message || "worker error");
    };
    worker.onmessageerror = () => this.#onWorkerError(g, "a worker message could not be read");
    this.#gen = g;
    return g;
  }

  #discard(g: Generation | null = this.#gen): void {
    if (!g) return;
    if (g.timer !== null) clearTimeout(g.timer);
    g.timer = null;
    g.worker.terminate(); // handlers stay attached so late messages are counted, never acted on
    if (this.#gen === g) this.#gen = null;
    this.diag.terminations++;
  }

  #flushReady(r: BuildIdentity | null): void {
    for (const w of this.#readyWaiters.splice(0)) w(r);
  }

  #identityMismatch(m: BuildIdentity): string | null {
    const want = this.#o.identity;
    for (const k of ["protocolVersion", "buildId", "engineVersion", "packetVersion"] as const)
      if (m[k] !== want[k]) return `${k}: page ${String(want[k])}, worker ${String(m[k])}`;
    return null;
  }

  #onMessage(g: Generation, m: WorkerResponse): void {
    if (this.#gen !== g) {
      this.diag.staleGenerationDropped++;
      return;
    }
    if (m.type === "ready") {
      if (g.ready) {
        this.diag.unmatchedDropped++;
        return;
      }
      if (g.timer !== null) clearTimeout(g.timer);
      g.timer = null;
      const mismatch = this.#identityMismatch(m);
      if (mismatch) return this.#skew(g, mismatch);
      g.ready = true;
      this.diag.handshakes++;
      this.lastReady = {
        protocolVersion: m.protocolVersion,
        buildId: m.buildId,
        engineVersion: m.engineVersion,
        packetVersion: m.packetVersion,
        initMs: m.initMs,
        memoryBytes: m.memoryBytes,
      };
      this.lastMemoryBytes = m.memoryBytes;
      this.#flushReady(this.lastReady);
      if (this.#running && !this.#running.posted) this.#post(this.#running, g);
      return;
    }
    if (!g.ready) {
      this.diag.unmatchedDropped++;
      return;
    }
    if (m.generation !== g.generation) {
      // C5: a generation mismatch identifies a stale worker; drop its message and terminate it.
      this.diag.wrongGenerationDropped++;
      return this.#crash(g, "protocol_error", `worker echoed generation ${m.generation}`);
    }
    const r = this.#running;
    if (!r || !r.posted || m.jobId !== r.id) {
      this.diag.unmatchedDropped++;
      if (m.type === "result") this.diag.droppedResults++;
      else if (m.type === "error") this.diag.droppedErrors++;
      else if (m.type === "progress") this.diag.droppedProgress++;
      return;
    }
    switch (m.type) {
      case "status":
        return;
      case "progress":
        r.spec.onProgress?.(m.stage);
        return;
      case "result": {
        this.#running = null;
        this.lastMemoryBytes = m.memoryBytes;
        const now = this.#o.now();
        this.#settle(r, {
          status: "succeeded",
          result: m.result,
          memoryBytes: m.memoryBytes,
          timings: {
            queuedMs: r.postedAt - r.submittedAt,
            workerMs: now - r.postedAt,
            postMs: r.postMs,
          },
        });
        if (m.memoryBytes > this.#o.recycleAboveBytes) {
          this.diag.recycles++;
          this.#discard(g);
        }
        this.#dispatch();
        return;
      }
      case "error":
        this.#running = null;
        if (m.fatal) {
          this.diag.fatalErrors++;
          this.#discard(g);
        }
        this.#settle(r, { status: "failed", code: m.code, message: m.message });
        this.#dispatch();
        return;
    }
  }

  #onWorkerError(g: Generation, message: string): void {
    if (this.#gen !== g) {
      this.diag.staleGenerationDropped++;
      return;
    }
    if (!g.ready) return this.#startupFailure(g, false, message);
    this.#crash(g, "worker_crashed", message);
  }

  #crash(g: Generation, code: string, message: string): void {
    this.diag.crashes++;
    this.#discard(g);
    const r = this.#running;
    this.#running = null;
    if (r) this.#settle(r, { status: "failed", code, message });
    this.#dispatch();
  }

  /** A worker that failed or timed out before its handshake. Its job never ran: requeue once. */
  #startupFailure(g: Generation | null, timeout: boolean, message: string): void {
    if (g && this.#gen !== g) return;
    this.diag.startupFailures++;
    if (timeout) this.diag.startupTimeouts++;
    this.#discard(g);
    this.#flushReady(null);
    const r = this.#running;
    this.#running = null;
    if (r && !r.retried) {
      r.retried = true;
      this.diag.startupRetries++;
      this.#queue.push(r);
    } else if (r) {
      // The retry failed too: the engine cannot start, so fail everything waiting for it.
      const detail = `${STARTUP_FAILED_MESSAGE} (${timeout ? "timeout" : message})`;
      for (const e of [r, ...this.#queue.splice(0)])
        this.#settle(e, { status: "failed", code: "worker_startup_failed", message: detail });
    }
    this.#dispatch();
  }

  #skew(g: Generation, detail: string): void {
    this.diag.buildMismatches++;
    this.#discard(g);
    this.#state = "skewed";
    this.buildMismatch = detail;
    const message = `${BUILD_MISMATCH_MESSAGE} (${detail})`;
    const r = this.#running;
    this.#running = null;
    for (const e of [...(r ? [r] : []), ...this.#queue.splice(0)])
      this.#settle(e, { status: "failed", code: "build_mismatch", message });
    this.#flushReady(null);
    this.#o.onBuildMismatch?.(detail);
  }
}
