// R03 prototype scheduler (review experiment; the minimal policy the review recommends).
// - One compute worker generation at a time (terminate-and-recreate, as P0).
// - Priorities: export 2 > final 1 > preview 0. Only PREVIEWS are pre-emptible: a newer
//   preview of the same scope, or any final/export, may terminate a running preview. Finals
//   and exports are never cancelled implicitly; they queue work behind them and stop only on
//   an explicit cancel.
// - At most one pending job per (kind, scope): a newer submission supersedes the pending one.
// - Messages are accepted only from the current generation AND for the running jobId;
//   everything else (late results, late errors) is counted and dropped.
// - Crash / fatal error: reject the running job, discard the worker, keep the queue; the next
//   dispatch spawns a fresh worker. Recycle after a job above `recycleAboveBytes`.
export class Cancelled extends Error {
  name = "Cancelled";
}
export class JobFailed extends Error {
  name = "JobFailed";
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const PRIORITY = { preview: 0, final: 1, export: 2 };

export class Scheduler {
  constructor({ createWorker, recycleAboveBytes = 1 << 30 }) {
    this.createWorker = createWorker;
    this.recycleAboveBytes = recycleAboveBytes;
    this.gen = null;
    this.running = null;
    this.pending = [];
    this.nextId = 1;
    this.stats = { workersCreated: 0, terminations: 0, staleDropped: 0, superseded: 0, crashes: 0, recycles: 0 };
  }
  /** job: { kind, scope, build(jobId) -> [message, transfer] }. Resolves with the result message. */
  submit(job) {
    const id = this.nextId++;
    const entry = { ...job, id, submittedAt: performance.now() };
    const done = new Promise((res, rej) => Object.assign(entry, { res, rej }));
    // Supersede a pending job of the same kind and scope.
    const i = this.pending.findIndex((p) => p.kind === job.kind && p.scope === job.scope);
    if (i >= 0) {
      const [old] = this.pending.splice(i, 1);
      this.stats.superseded++;
      old.rej(new Cancelled(`job ${old.id} superseded by ${id}`));
    }
    this.pending.push(entry);
    // Pre-empt a running PREVIEW only.
    const r = this.running;
    if (r && r.kind === "preview" && (job.kind !== "preview" || job.scope === r.scope)) {
      this.stats.superseded++;
      this.abortRunning(new Cancelled(`running preview ${r.id} pre-empted by ${job.kind} ${id}`));
    }
    this.dispatch();
    return { id, done };
  }
  cancel(id) {
    if (this.running?.id === id) {
      this.abortRunning(new Cancelled(`job ${id} cancelled`));
      this.dispatch();
      return true;
    }
    const i = this.pending.findIndex((p) => p.id === id);
    if (i < 0) return false;
    this.pending.splice(i, 1)[0].rej(new Cancelled(`job ${id} cancelled while queued`));
    return true;
  }
  abortRunning(err) {
    const r = this.running;
    this.running = null;
    this.discard();
    r?.rej(err);
  }
  discard() {
    if (!this.gen) return;
    this.gen.worker.onmessage = this.gen.worker.onerror = null;
    this.gen.worker.terminate();
    this.gen = null;
    this.stats.terminations++;
  }
  spawn() {
    if (this.gen) return this.gen;
    const worker = this.createWorker();
    this.stats.workersCreated++;
    const gen = { worker, ready: null };
    gen.ready = new Promise((res, rej) => {
      worker.onmessage = (e) => {
        if (this.gen !== gen) return void this.stats.staleDropped++;
        if (e.data.type === "ready") return res(e.data);
        this.onMessage(e.data);
      };
      worker.onerror = (e) => {
        e.preventDefault?.();
        if (this.gen !== gen) return void this.stats.staleDropped++;
        this.stats.crashes++;
        rej(new JobFailed("worker_crashed", e.message || "worker error"));
        const r = this.running;
        this.running = null;
        this.discard();
        r?.rej(new JobFailed("worker_crashed", e.message || "worker error"));
        this.dispatch();
      };
    });
    gen.ready.catch(() => {});
    this.gen = gen;
    return gen;
  }
  onMessage(msg) {
    const r = this.running;
    if (!r || msg.jobId !== r.id) return void this.stats.staleDropped++;
    if (msg.type === "status") return;
    this.running = null;
    if (msg.type === "error") {
      if (msg.fatal) this.discard();
      r.rej(new JobFailed(msg.code, msg.message));
    } else {
      if (msg.memoryBytes > this.recycleAboveBytes) {
        this.stats.recycles++;
        this.discard();
      }
      r.res(msg);
    }
    this.dispatch();
  }
  dispatch() {
    if (this.running || !this.pending.length) return;
    this.pending.sort((a, b) => PRIORITY[b.kind] - PRIORITY[a.kind] || a.id - b.id);
    const job = this.pending.shift();
    this.running = job;
    const gen = this.spawn();
    gen.ready.then(
      () => {
        if (this.running !== job || this.gen !== gen) return;
        job.startedAt = performance.now();
        const [msg, transfer] = job.build(job.id);
        gen.worker.postMessage(msg, transfer);
      },
      () => {},
    );
  }
}
