// Scheduler conformance (RFC-002 §10.3, C5 r2) with a scripted fake worker.
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { BuildIdentity, JobKind, WorkerRequest, WorkerResponse } from "./protocol.ts";
import {
  type JobOutcome,
  JobScheduler,
  type SchedulerOptions,
  type Submission,
  type WorkerLike,
} from "./scheduler.ts";

const ID: BuildIdentity = {
  protocolVersion: 2,
  buildId: "b1",
  engineVersion: "0.0.0",
  packetVersion: 1,
};

class FakeWorker implements WorkerLike {
  posted: Extract<WorkerRequest, { jobId: number }>[] = [];
  debug: WorkerRequest[] = [];
  terminated = false;
  isReady = false;
  postedBeforeReady = false;
  generation = 0;
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: ((e: MessageEvent) => void) | null = null;
  postMessage(m: WorkerRequest): void {
    if (this.terminated) throw new Error("posted to a terminated worker");
    if (!this.isReady) this.postedBeforeReady = true;
    if (m.type === "debug") this.debug.push(m);
    else {
      this.generation = m.generation;
      this.posted.push(m);
    }
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(m: WorkerResponse): void {
    this.onmessage?.({ data: m } as MessageEvent<WorkerResponse>);
  }
  ready(identity: BuildIdentity = ID): void {
    this.isReady = true;
    this.emit({ type: "ready", ...identity, initMs: 1, memoryBytes: 1 });
  }
  fail(message = "boom"): void {
    this.onerror?.({ message, preventDefault() {} } as unknown as ErrorEvent);
  }
  last() {
    return this.posted.at(-1)!;
  }
  result(jobId = this.last().jobId, memoryBytes = 1, generation = this.generation): void {
    this.emit({
      type: "result",
      jobId,
      generation,
      memoryBytes,
      result: {
        type: "export",
        format: "svg",
        bytes: new ArrayBuffer(1),
        timings: { exportMs: 0 },
      },
    });
  }
  error(code: string, fatal: boolean, jobId = this.last().jobId): void {
    this.emit({ type: "error", jobId, generation: this.generation, code, message: code, fatal });
  }
}

function setup(o: Partial<SchedulerOptions> = {}) {
  const workers: FakeWorker[] = [];
  const s = new JobScheduler({
    identity: ID,
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    ...o,
  });
  const outcomes = new Map<number, JobOutcome>();
  const submit = (kind: JobKind, scope = "s"): Submission => {
    const sub = s.submit({
      kind,
      scope,
      documentRevision: 1,
      operationVersion: 1,
      build: (h) => [
        {
          type: "export",
          ...h,
          format: "svg",
          drawList: { width: 1, height: 1, runs: [], items: [] },
          chunks: [],
          sceneMeta: { background: null, palette: [], metadata: {} },
          options: null,
        },
        [],
      ],
    });
    if (sub.accepted) void sub.done.then((o) => outcomes.set(sub.jobId, o));
    return sub;
  };
  const id = (sub: Submission) => {
    if (!sub.accepted) throw new Error(`rejected: ${sub.code}`);
    return sub.jobId;
  };
  return { s, workers, submit, id, outcomes, w: () => workers.at(-1)! };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("handshake and start-up", () => {
  test("nothing is posted before ready; the header carries the C5 fields", async () => {
    const { s, w, submit, id } = setup();
    const j = id(submit("final"));
    expect(w().posted).toHaveLength(0);
    w().ready();
    expect(w().last()).toMatchObject({
      jobId: j,
      generation: 1,
      kind: "final",
      documentRevision: 1,
      operationVersion: 1,
    });
    expect(w().postedBeforeReady).toBe(false);
    expect(s.diag.handshakes).toBe(1);
  });

  test.each(["protocolVersion", "buildId", "engineVersion", "packetVersion"] as const)(
    "a %s mismatch is fatal build skew: no requeue, explicit jobs fail, later submissions refused",
    async (field) => {
      const onBuildMismatch = vi.fn();
      const { s, w, submit, id, outcomes, workers } = setup({ onBuildMismatch });
      const a = id(submit("final"));
      const b = id(submit("export"));
      w().ready({ ...ID, [field]: field === "buildId" || field === "engineVersion" ? "x" : 9 });
      await flush();
      expect(w().terminated).toBe(true);
      expect(w().posted).toHaveLength(0);
      expect(outcomes.get(a)).toMatchObject({ status: "failed", code: "build_mismatch" });
      expect(outcomes.get(b)).toMatchObject({ status: "failed", code: "build_mismatch" });
      expect(submit("preview")).toMatchObject({ accepted: false, code: "build_mismatch" });
      expect(onBuildMismatch).toHaveBeenCalledOnce();
      expect(workers).toHaveLength(1);
      expect(s.state).toBe("skewed");
    },
  );

  describe("timeouts", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    test("a start-up timeout discards the worker and requeues the never-run job once", async () => {
      const { s, workers, submit, id, outcomes } = setup({ startupTimeoutMs: 100 });
      const j = id(submit("final"));
      vi.advanceTimersByTime(100);
      expect(workers[0]!.terminated).toBe(true);
      expect(workers).toHaveLength(2);
      workers[1]!.ready();
      workers[1]!.result();
      await vi.runAllTimersAsync();
      expect(outcomes.get(j)?.status).toBe("succeeded");
      expect(s.diag).toMatchObject({ startupTimeouts: 1, startupRetries: 1 });
    });

    test("a second start-up failure fails the job and everything queued, with an actionable error", async () => {
      const { s, workers, submit, id, outcomes } = setup({ startupTimeoutMs: 100 });
      const a = id(submit("final"));
      const b = id(submit("preview"));
      vi.advanceTimersByTime(100);
      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();
      for (const j of [a, b]) {
        const o = outcomes.get(j)!;
        expect(o).toMatchObject({ status: "failed", code: "worker_startup_failed" });
        expect((o as { message: string }).message).toMatch(/offline/);
      }
      expect(workers.every((w) => w.terminated)).toBe(true);
      // A later submission tries again with a fresh worker.
      submit("final");
      expect(workers).toHaveLength(3);
      expect(s.diag.startupFailures).toBe(2);
    });
  });

  test("a module-load error before ready is a start-up failure: requeued once", async () => {
    const { workers, submit, id, outcomes } = setup();
    const j = id(submit("export"));
    workers[0]!.fail("Importing a module script failed.");
    expect(workers).toHaveLength(2);
    workers[1]!.ready();
    workers[1]!.result();
    await flush();
    expect(outcomes.get(j)?.status).toBe("succeeded");
  });
});

describe("scheduling", () => {
  test("rapid previews during start-up never terminate the starting worker (WebKit churn rule)", async () => {
    const { s, w, workers, submit, id, outcomes } = setup();
    const ids = [1, 2, 3, 4, 5].map(() => id(submit("preview")));
    expect(workers).toHaveLength(1);
    expect(w().terminated).toBe(false);
    w().ready();
    expect(w().posted.map((p) => p.jobId)).toEqual([ids[4]]);
    w().result();
    await flush();
    // Each earlier preview was replaced before reaching the worker (none was posted).
    for (const j of ids.slice(0, 4))
      expect(outcomes.get(j)).toEqual({ status: "cancelled", reason: "preempted" });
    expect(outcomes.get(ids[4]!)?.status).toBe("succeeded");
    expect(s.diag).toMatchObject({ workersCreated: 1, terminations: 0 });
  });

  test("a posted preview is pre-empted by a newer preview of its scope (terminate and recreate)", async () => {
    const { workers, submit, id, outcomes } = setup();
    const a = id(submit("preview", "x"));
    workers[0]!.ready();
    const b = id(submit("preview", "x"));
    expect(workers[0]!.terminated).toBe(true);
    workers[1]!.ready();
    expect(workers[1]!.last().jobId).toBe(b);
    await flush();
    expect(outcomes.get(a)).toEqual({ status: "cancelled", reason: "preempted" });
  });

  test("a preview of another scope waits; it does not pre-empt", () => {
    const { workers, submit, id } = setup();
    id(submit("preview", "x"));
    workers[0]!.ready();
    id(submit("preview", "y"));
    expect(workers[0]!.terminated).toBe(false);
  });

  test("previews never cancel explicit jobs; exports run before finals before previews", async () => {
    const { w, submit, id, outcomes } = setup();
    const fin = id(submit("final"));
    w().ready();
    const prev = id(submit("preview"));
    const exp = id(submit("export"));
    const fin2 = id(submit("final"));
    expect(w().terminated).toBe(false);
    const order: number[] = [];
    for (let k = 0; k < 4; k++) {
      order.push(w().last().jobId);
      w().result();
    }
    await flush();
    expect(order).toEqual([fin, exp, fin2, prev]);
    for (const j of [fin, exp, fin2, prev]) expect(outcomes.get(j)?.status).toBe("succeeded");
  });

  test("a thumbnail is the lowest priority and is pre-empted by a preview", async () => {
    const { w, submit, id, outcomes } = setup();
    const t = id(submit("thumbnail"));
    w().ready();
    id(submit("preview", "other"));
    await flush();
    expect(outcomes.get(t)).toEqual({ status: "cancelled", reason: "preempted" });
  });

  test("queue saturation rejects the fifth waiting explicit job before acceptance", async () => {
    const { s, w, submit, id } = setup();
    const running = id(submit("final"));
    w().ready();
    const queued = [submit("export"), submit("final"), submit("apply"), submit("final")].map(id);
    const r = submit("export");
    expect(r).toMatchObject({ accepted: false, code: "busy", running: { jobId: running } });
    expect(
      !r.accepted && r.code === "busy" && r.queued.map((q) => q.jobId).sort((x, y) => x - y),
    ).toEqual([...queued].sort((x, y) => x - y));
    expect(s.canAccept("final")).toBe(false);
    expect(submit("preview").accepted).toBe(true); // previews are never refused
    expect(s.diag.rejectedBusy).toBe(1);
  });
});

describe("cancellation", () => {
  test("cancel of a posted job terminates; of a starting job does not; of a queued job removes it", async () => {
    const { workers, submit, id, outcomes, s } = setup();
    const a = id(submit("final"));
    expect(s.cancel(a)).toBe(true); // not posted: the starting worker is kept
    expect(workers[0]!.terminated).toBe(false);
    const b = id(submit("final"));
    const c = id(submit("export"));
    workers[0]!.ready();
    expect(workers[0]!.last().jobId).toBe(b); // the running final is not overtaken
    expect(s.cancel(c)).toBe(true); // queued
    expect(s.cancel(b)).toBe(true); // posted: terminate
    expect(workers[0]!.terminated).toBe(true);
    expect(s.cancel(999)).toBe(false);
    await flush();
    for (const j of [a, b, c])
      expect(outcomes.get(j)).toEqual({ status: "cancelled", reason: "user" });
  });

  test("dispose settles everything once as cancelled", async () => {
    const { s, w, submit, id, outcomes } = setup();
    const a = id(submit("final"));
    w().ready();
    const b = id(submit("preview"));
    s.dispose();
    await flush();
    expect(outcomes.get(a)).toEqual({ status: "cancelled", reason: "disposed" });
    expect(outcomes.get(b)).toEqual({ status: "cancelled", reason: "disposed" });
    expect(submit("final")).toMatchObject({ accepted: false, code: "disposed" });
  });
});

describe("faults and stale messages", () => {
  test("a crash during a job fails that job only; the queue continues on a new worker", async () => {
    const { s, workers, submit, id, outcomes } = setup();
    const a = id(submit("final"));
    const b = id(submit("export"));
    workers[0]!.ready();
    workers[0]!.fail("injected");
    expect(workers).toHaveLength(2);
    workers[1]!.ready();
    workers[1]!.result();
    workers[1]!.result();
    await flush();
    const order = [outcomes.get(a), outcomes.get(b)].map((o) => o?.status);
    expect(new Set(order)).toEqual(new Set(["failed", "succeeded"]));
    expect(s.diag.crashes).toBe(1);
  });

  test("a fatal error discards the worker; a non-fatal one keeps it", async () => {
    const { workers, submit, id, outcomes } = setup();
    const a = id(submit("final"));
    workers[0]!.ready();
    workers[0]!.error("too_many_primitives", false);
    expect(workers[0]!.terminated).toBe(false);
    const b = id(submit("final"));
    workers[0]!.error("wasm_abort", true);
    expect(workers[0]!.terminated).toBe(true);
    await flush();
    expect(outcomes.get(a)).toMatchObject({ status: "failed", code: "too_many_primitives" });
    expect(outcomes.get(b)).toMatchObject({ status: "failed", code: "wasm_abort" });
  });

  test("late, duplicate and stale messages are dropped and counted, never acted on", async () => {
    const { s, workers, submit, id, outcomes } = setup();
    const a = id(submit("final"));
    workers[0]!.ready();
    workers[0]!.result(a);
    workers[0]!.result(a); // duplicate
    workers[0]!.error("late", false, a); // late error
    workers[0]!.emit({ type: "progress", jobId: a, generation: 1, stage: "fit" }); // stale progress
    await flush();
    expect(outcomes.get(a)?.status).toBe("succeeded");
    expect(s.diag).toMatchObject({
      unmatchedDropped: 3,
      droppedResults: 1,
      droppedErrors: 1,
      droppedProgress: 1,
      settleViolations: 0,
    });
    // A discarded worker's messages count as stale generation.
    const b = id(submit("preview"));
    id(submit("preview")); // pre-empts b: terminates worker 0
    workers[0]!.result(b, 1, 1);
    expect(s.diag.staleGenerationDropped).toBe(1);
  });

  test("a message echoing another generation terminates the worker (C5)", async () => {
    const { s, workers, submit, id, outcomes } = setup();
    const a = id(submit("final"));
    workers[0]!.ready();
    workers[0]!.result(a, 1, 99);
    await flush();
    expect(workers[0]!.terminated).toBe(true);
    expect(outcomes.get(a)).toMatchObject({ status: "failed", code: "protocol_error" });
    expect(s.diag.wrongGenerationDropped).toBe(1);
  });

  test("an unknown message type for the posted job is dropped and counted", () => {
    const { s, w, submit } = setup();
    submit("final");
    w().ready();
    w().emit({ type: "mystery", jobId: 1, generation: 1 } as unknown as WorkerResponse);
    expect(s.diag.unmatchedDropped).toBe(1);
    expect(s.running?.jobId).toBe(1);
  });

  test("a job that leaves WASM memory above the threshold recycles the worker", async () => {
    const { s, workers, submit } = setup({ recycleAboveBytes: 10 });
    submit("final");
    workers[0]!.ready();
    workers[0]!.result(undefined, 11);
    expect(workers[0]!.terminated).toBe(true);
    expect(s.diag.recycles).toBe(1);
  });

  test("progress is forwarded only for the posted job", () => {
    const { s, w } = setup();
    const stages: string[] = [];
    s.submit({
      kind: "final",
      scope: "s",
      documentRevision: 1,
      operationVersion: 1,
      onProgress: (st) => stages.push(st),
      build: (h) => [{ type: "debug", generation: h.generation, fault: "crash-now" }, []],
    });
    w().ready();
    w().emit({ type: "progress", jobId: 1, generation: 1, stage: "segment" });
    w().emit({ type: "progress", jobId: 2, generation: 1, stage: "fit" });
    expect(stages).toEqual(["segment"]);
  });
});

// Property: under random submissions, cancels, crashes, start-up failures, timeouts and
// responses, every job settles exactly once, explicit jobs are never cancelled implicitly,
// nothing is posted before ready, and no starting worker is terminated except by a start-up
// failure or timeout.
describe("property: settle exactly once", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const rng = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed / 2 ** 32;
  };
  const KINDS: JobKind[] = ["thumbnail", "preview", "final", "apply", "export"];

  test.each(Array.from({ length: 40 }, (_, i) => i + 1))("seed %i", async (seed) => {
    const r = rng(seed);
    const startingKilled: FakeWorker[] = [];
    const failedBeforeReady = new Set<FakeWorker>();
    const { s, workers, submit, outcomes } = setup({ startupTimeoutMs: 50 });
    const accepted: { id: number; kind: JobKind }[] = [];
    for (let step = 0; step < 300; step++) {
      const w = workers.at(-1);
      const x = r();
      if (x < 0.35) {
        const kind = KINDS[Math.floor(r() * KINDS.length)]!;
        const sub = submit(kind, r() < 0.5 ? "a" : "b");
        if (sub.accepted) accepted.push({ id: sub.jobId, kind });
      } else if (x < 0.45 && accepted.length) {
        s.cancel(accepted[Math.floor(r() * accepted.length)]!.id);
      } else if (x < 0.6 && w && !w.terminated && !w.isReady) {
        w.ready();
      } else if (x < 0.75 && w && w.isReady && !w.terminated && w.posted.length) {
        const y = r();
        if (y < 0.7) w.result(w.last().jobId, r() < 0.1 ? 2 ** 31 : 1);
        else w.error(y < 0.85 ? "engine_error" : "wasm_abort", y >= 0.85);
      } else if (x < 0.8 && w && !w.terminated) {
        if (!w.isReady) failedBeforeReady.add(w);
        w.fail();
      } else if (x < 0.85) {
        for (const ww of workers) if (!ww.isReady && !ww.terminated) failedBeforeReady.add(ww);
        vi.advanceTimersByTime(60);
      } else if (x < 0.87 && w?.isReady && !w.terminated && w.posted.length) {
        w.result(w.last().jobId); // possibly duplicate
      }
      for (const ww of workers)
        if (ww.terminated && !ww.isReady && !failedBeforeReady.has(ww)) startingKilled.push(ww);
    }
    // Drain: answer everything until idle.
    for (let k = 0; k < 2000 && (s.running || s.queued.length); k++) {
      const w = workers.at(-1)!;
      if (!w.isReady) w.ready();
      else if (w.posted.length) w.result(w.last().jobId);
    }
    await vi.runAllTimersAsync();
    expect(s.running).toBeNull();
    expect(s.queued).toHaveLength(0);
    expect(s.diag.settleViolations).toBe(0);
    for (const a of accepted) {
      const o = outcomes.get(a.id);
      expect(o, `job ${a.id}`).toBeDefined();
      if (
        o!.status === "cancelled" &&
        (a.kind === "final" || a.kind === "apply" || a.kind === "export")
      )
        expect(o!.reason, `explicit job ${a.id}`).toBe("user");
    }
    expect(workers.some((w) => w.postedBeforeReady)).toBe(false);
    expect(new Set(startingKilled).size).toBe(0);
  });
});
