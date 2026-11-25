// Job controller conformance: revision-checked commits (RFC §10.3 rule 3b), frozen export
// snapshots (rule 7, C8), ownership and reservations released on every exit (C2, RFC §11.3),
// and committed state untouched by failed, cancelled or terminated jobs.
import { describe, expect, test } from "vite-plus/test";
import { ResourceLedger } from "../document/ledger.ts";
import type { AssetId, LayerNode, PathNode } from "../document/model.ts";
import { emptySession } from "../document/testing/helpers.ts";
import { FIXTURE_SCENES, fixturePacket } from "../document/testing/fixtures.ts";
import { DEFAULT_SETTINGS, makeRequest } from "../presets/defaults.ts";
import { type CommitOutcome, JobController, type TraceSource } from "./controller.ts";
import type { BuildIdentity, WorkerRequest, WorkerResponse } from "./protocol.ts";
import { JobScheduler, type WorkerLike } from "./scheduler.ts";

const ID: BuildIdentity = {
  protocolVersion: 2,
  buildId: "b",
  engineVersion: "0.0.0",
  packetVersion: 1,
};
const DIGEST = "a".repeat(64);
const request = makeRequest(DEFAULT_SETTINGS.bw, 50_000_000);

class Engine implements WorkerLike {
  posted: Extract<WorkerRequest, { jobId: number }>[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: ((e: MessageEvent) => void) | null = null;
  postMessage(m: WorkerRequest) {
    if (m.type !== "debug") this.posted.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  emit(m: WorkerResponse) {
    this.onmessage?.({ data: m } as MessageEvent<WorkerResponse>);
  }
  ready() {
    this.emit({ type: "ready", ...ID, initMs: 0, memoryBytes: 0 });
  }
  get job() {
    return this.posted.at(-1)!;
  }
  /** Answers the posted trace with the named regression fixture. */
  trace(name = "circle-bw", mutate?: (p: ReturnType<typeof fixturePacket>) => void) {
    const { scene } = FIXTURE_SCENES.get(name)!;
    const packet = fixturePacket(name);
    mutate?.(packet);
    const s = scene as unknown as {
      background: string | null;
      palette: unknown[];
      metadata: object;
    };
    // The engine records the traced source's size in the metadata (C10 provenance check).
    const job = this.job as Extract<WorkerRequest, { type: "trace" }>;
    const metadata = { ...s.metadata, sourceWidth: job.width, sourceHeight: job.height };
    this.emit({
      type: "result",
      jobId: this.job.jobId,
      generation: this.job.generation,
      memoryBytes: 1,
      result: {
        type: "trace",
        packet,
        sceneMetaJson: JSON.stringify({ background: s.background, palette: s.palette, metadata }),
        metrics: {} as never,
        warnings: [],
        estimate: { kind: "unavailable", reason: "test" },
        timings: { segmentMs: 0, estimateMs: 0, fitMs: 0, parseMs: 0 },
      },
    });
  }
  exportBytes() {
    this.emit({
      type: "result",
      jobId: this.job.jobId,
      generation: this.job.generation,
      memoryBytes: 1,
      result: {
        type: "export",
        format: "svg",
        bytes: new Uint8Array([60, 115]).buffer,
        timings: { exportMs: 0 },
      },
    });
  }
  crash() {
    this.onerror?.({ message: "crash", preventDefault() {} } as unknown as ErrorEvent);
  }
  error(code: string, fatal: boolean) {
    this.emit({
      type: "error",
      jobId: this.job.jobId,
      generation: this.job.generation,
      code,
      message: code,
      fatal,
    });
  }
}

function setup(o: { maxReservedBytes?: number; startupTimeoutMs?: number } = {}) {
  const engines: Engine[] = [];
  const session = emptySession({}, 64, 64);
  const scheduler = new JobScheduler({
    identity: ID,
    createWorker: () => {
      const e = new Engine();
      engines.push(e);
      return e;
    },
    ...(o.startupTimeoutMs ? { startupTimeoutMs: o.startupTimeoutMs } : {}),
  });
  const ledger = new ResourceLedger(session);
  const c = new JobController({ scheduler, session, engineVersion: "0.0.0", ledger, ...o });
  return { c, session, scheduler, engines, e: () => engines.at(-1)!, ledger };
}

const source = (assetId: AssetId | null = null, w = 4, h = 4): TraceSource => ({
  assetId,
  digest: DIGEST,
  width: w,
  height: h,
  rgba: new Uint8Array(w * h * 4).fill(7),
  decodePolicy: "browser-canvas-v1",
});
const accepted = <T>(
  r: { accepted: boolean } & (
    | { accepted: true; done: Promise<T>; jobId: number }
    | { accepted: false }
  ),
) => {
  if (!r.accepted) throw new Error("rejected");
  return r;
};
const attach = (session: ReturnType<typeof emptySession>) => {
  session.dispatch({
    type: "attachSource",
    asset: {
      digest: DIGEST,
      mime: "image/png",
      width: 4,
      height: 4,
      embedded: false,
      decodePolicy: "browser-canvas-v1",
    },
  });
  return [...session.state.sourceAssetsById.keys()].at(-1)!;
};
/** Reference counts held by snapshots and jobs across every chunk (bytes() attributes a chunk
 *  to its highest-precedence owner, so a document-owned chunk shows no snapshot bytes). */
const owners = (session: ReturnType<typeof emptySession>) => {
  let snapshot = 0;
  let job = 0;
  for (const id of session.store.chunkIds()) {
    const n = session.store.ownerCounts(id);
    snapshot += n.snapshot;
    job += n.job;
  }
  return { snapshot, job };
};

describe("final traces", () => {
  test("a final trace commits one new layer with provenance, from a job copy of the source", async () => {
    const { c, session, e } = setup();
    const src = source();
    const job = accepted(c.traceFinal(src, request));
    e().ready();
    const posted = e().job as Extract<WorkerRequest, { type: "trace" }>;
    expect(posted.rgba).not.toBe(src.rgba.buffer); // a copy, allocated when posted
    expect(src.rgba.byteLength).toBe(64);
    expect(posted).toMatchObject({
      kind: "final",
      quality: "final",
      sourceDigest: DIGEST,
      operationVersion: 1,
    });
    const rev = session.getSnapshot().revision;
    e().trace();
    const out = (await job.done) as Extract<CommitOutcome, { status: "committed" }>;
    expect(out.status).toBe("committed");
    expect(out.revision).toBe(rev + 1);
    const layer = session.state.nodesById.get(out.layerId) as LayerNode;
    expect(layer.traceProvenance).toMatchObject({
      chunkId: out.chunkId,
      source: { digest: DIGEST },
    });
    expect(c.reservedBytes).toBe(0);
  });

  test("an unrelated edit during the trace does not make a new-layer final stale (rule 3b)", async () => {
    const { c, session, e } = setup();
    const asset = attach(session);
    const job = accepted(c.traceFinal(source(asset), request));
    e().ready();
    session.dispatch({ type: "setArtboard", width: 80, height: 80 });
    e().trace();
    expect((await job.done).status).toBe("committed");
  });

  test("undoing the source attachment during the trace makes it stale; nothing is committed", async () => {
    const { c, session, e } = setup();
    const asset = attach(session);
    const job = accepted(c.traceFinal(source(asset), request));
    e().ready();
    session.undo();
    const before = session.state;
    e().trace();
    expect(await job.done).toMatchObject({ status: "stale", reason: "source_changed" });
    expect(session.state).toBe(before);
    expect(owners(session).job + owners(session).snapshot).toBe(0);
  });

  test("replacing the document during the trace makes it stale for both documents", async () => {
    const { c, session, e } = setup();
    const job = accepted(c.traceFinal(source(), request));
    e().ready();
    const next = emptySession({}, 32, 32);
    c.replaceSession(next);
    const [a, b] = [session.state, next.state];
    e().trace();
    expect(await job.done).toMatchObject({ status: "stale", reason: "document_replaced" });
    expect([session.state, next.state]).toEqual([a, b]);
  });

  test("a replace whose target layer changed is stale; an unchanged target is replaced", async () => {
    const { c, session, e } = setup();
    const first = accepted(c.traceFinal(source(), request));
    e().ready();
    e().trace();
    const { layerId } = (await first.done) as Extract<CommitOutcome, { status: "committed" }>;
    const replace = accepted(c.traceFinal(source(), request, { replaceLayerId: layerId }));
    e().trace("nested_rings-bw");
    expect((await replace.done).status).toBe("committed");
    const stale = accepted(c.traceFinal(source(), request, { replaceLayerId: layerId }));
    session.dispatch({ type: "delete", ids: [layerId] });
    e().trace();
    expect(await stale.done).toMatchObject({ status: "stale", reason: "target_changed" });
  });

  test("an invalid packet from the worker fails at commit validation; the document is unchanged", async () => {
    const { c, session, e } = setup();
    const job = accepted(c.traceFinal(source(), request));
    e().ready();
    const before = session.state;
    e().trace("circle-bw", (p) => (p.verbs[0] = 99));
    const out = await job.done;
    expect(out.status).toBe("failed");
    expect((out as { code: string }).code).not.toBe("commit_failed");
    expect(session.state).toBe(before);
  });
});

describe("export snapshots", () => {
  async function withLayer() {
    const t = setup();
    const job = accepted(t.c.traceFinal(source(), request));
    t.e().ready();
    t.e().trace();
    await job.done;
    return t;
  }

  test("an export is frozen at request time; concurrent edits do not change it", async () => {
    const { c, session, e } = await withLayer();
    const path = [...session.state.nodesById.values()].find(
      (n): n is PathNode => n.kind === "path",
    )!;
    const busy = accepted(c.traceFinal(source(), request)); // the export queues behind it
    const exp = accepted(c.export("svg"));
    session.dispatch({ type: "setFill", ids: [path.id], fill: { color: 0x123456ff } });
    session.dispatch({ type: "delete", ids: [session.state.orderedRootIds[0]!] });
    expect(owners(session).snapshot).toBeGreaterThan(0); // retained by the snapshot only
    e().trace(); // finish the trace; the export is posted next, from the frozen snapshot
    await busy.done;
    const posted = e().job as Extract<WorkerRequest, { type: "export" }>;
    expect(posted.type).toBe("export");
    expect(posted.drawList.items.some((it) => it.fill === 0x123456ff)).toBe(false);
    expect(posted.chunks).toHaveLength(1);
    expect(Object.isFrozen(posted.drawList)).toBe(true);
    e().exportBytes();
    expect(await exp.done).toMatchObject({ status: "delivered" });
    expect(owners(session).snapshot).toBe(0);
    expect(session.store.checkIntegrity()).toBe(true);
  });

  const exits: [
    string,
    (t: Awaited<ReturnType<typeof withLayer>>, jobId: number) => void,
    string,
  ][] = [
    ["delivered", (t) => t.e().exportBytes(), "delivered"],
    ["cancelled while running", (t, j) => t.c.cancel(j), "cancelled"],
    ["crash", (t) => t.e().crash(), "failed"],
    ["fatal error", (t) => t.e().error("wasm_abort", true), "failed"],
    ["engine error", (t) => t.e().error("export_failed", false), "failed"],
    ["dispose", (t) => t.c.dispose(), "cancelled"],
  ];
  test.each(exits)("snapshot and job ownership return to 0 after: %s", async (_, act, status) => {
    const t = await withLayer();
    const exp = accepted(t.c.export("pdf", { width: 100, unit: "mm" }));
    expect(owners(t.session).snapshot).toBeGreaterThan(0);
    act(t, exp.jobId);
    expect((await exp.done).status).toBe(status);
    expect(owners(t.session)).toMatchObject({ snapshot: 0, job: 0 });
    expect(t.c.reservedBytes).toBe(0);
  });

  test("ownership returns to 0 when cancelled while queued, on build mismatch and on start-up failure", async () => {
    const t = await withLayer();
    accepted(t.c.traceFinal(source(), request)); // running
    const queued = accepted(t.c.export("svg"));
    t.c.cancel(queued.jobId);
    expect((await queued.done).status).toBe("cancelled");
    expect(owners(t.session).snapshot).toBe(0);

    const t2 = await withLayer();
    t2.e().crash(); // the next worker will be refused
    const exp = accepted(t2.c.export("svg"));
    t2.e().emit({ type: "ready", ...ID, buildId: "other", initMs: 0, memoryBytes: 0 });
    expect(await exp.done).toMatchObject({ status: "failed", code: "build_mismatch" });
    expect(owners(t2.session).snapshot).toBe(0);
    expect(t2.c.export("svg")).toMatchObject({ accepted: false, code: "build_mismatch" });
    expect(owners(t2.session).snapshot).toBe(0);

    const t3 = await withLayer();
    t3.e().crash();
    const exp3 = accepted(t3.c.export("svg"));
    t3.e().crash(); // start-up failure: requeued once
    t3.e().crash(); // second start-up failure
    expect(await exp3.done).toMatchObject({ status: "failed", code: "worker_startup_failed" });
    expect(owners(t3.session).snapshot).toBe(0);
  });

  test("a busy rejection retains nothing and reserves nothing", async () => {
    const t = await withLayer();
    accepted(t.c.traceFinal(source(), request));
    for (let k = 0; k < 4; k++) accepted(t.c.export("svg"));
    const held = owners(t.session).snapshot;
    const reserved = t.c.reservedBytes;
    expect(t.c.export("svg")).toMatchObject({ accepted: false, code: "busy" });
    expect(t.c.traceFinal(source(), request)).toMatchObject({ accepted: false, code: "busy" });
    expect(owners(t.session).snapshot).toBe(held);
    expect(t.c.reservedBytes).toBe(reserved);
  });
});

describe("resource budget", () => {
  test("a source over the pixel limit is refused before any worker starts", () => {
    const { c, engines } = setup();
    const r = c.traceFinal(source(null, 10, 10), { ...request, maxPixels: 50 });
    expect(r).toMatchObject({ accepted: false, code: "resource_budget" });
    expect((r as { message: string }).message).toMatch(/Reduce its resolution/);
    expect(engines).toHaveLength(0);
  });

  test("reservations beyond the budget are refused; they are released at settle", async () => {
    const { c, e, ledger } = setup({ maxReservedBytes: 100 });
    const a = accepted(c.tracePreview(source(), request)); // 64 bytes
    expect(ledger.snapshot().reporters["jobs.reserved"]!.bytes).toBe(64);
    expect(c.traceFinal(source(), request)).toMatchObject({
      accepted: false,
      code: "resource_budget",
    });
    e().ready();
    e().trace();
    expect((await a.done).status).toBe("succeeded");
    expect(c.reservedBytes).toBe(0);
  });

  test("a preview result is never committed", async () => {
    const { c, session, e } = setup();
    const before = session.state;
    const a = accepted(c.tracePreview(source(), request));
    e().ready();
    e().trace();
    expect((await a.done).status).toBe("succeeded");
    expect(session.state).toBe(before);
  });
});

test("property: random job outcomes never leave reservations, snapshots or a corrupt store", async () => {
  let seed = 7;
  const r = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
  const t = setup({ startupTimeoutMs: 1e9 });
  const done: Promise<unknown>[] = [];
  for (let step = 0; step < 400; step++) {
    const x = r();
    const e = t.engines.at(-1);
    if (x < 0.3) {
      const sub =
        r() < 0.5 ? t.c.traceFinal(source(), request) : t.c.tracePreview(source(), request);
      if (sub.accepted) done.push(sub.done);
    } else if (x < 0.45) {
      const sub = t.c.export(r() < 0.5 ? "svg" : "pdf", { width: 10, unit: "mm" });
      if (sub.accepted) done.push(sub.done);
    } else if (x < 0.55 && e && !e.terminated) {
      e.ready();
    } else if (x < 0.75 && e && !e.terminated && e.posted.length) {
      if (e.job.type === "trace") e.trace(r() < 0.5 ? "circle-bw" : "nested_rings-bw");
      else e.exportBytes();
    } else if (x < 0.8 && e && !e.terminated) {
      e.crash();
    } else if (x < 0.85 && e && !e.terminated && e.posted.length) {
      e.error("engine_error", r() < 0.5);
    } else if (x < 0.9 && t.session.getSnapshot().canUndo) {
      t.session.undo();
    } else if (x < 0.95) {
      const s = t.scheduler.running;
      if (s) t.c.cancel(s.jobId);
    }
  }
  t.c.dispose();
  await Promise.all(done);
  expect(t.c.reservedBytes).toBe(0);
  expect(owners(t.session)).toMatchObject({ snapshot: 0, job: 0 });
  expect(t.session.store.checkIntegrity()).toBe(true);
  expect(t.scheduler.diag.settleViolations).toBe(0);
});

describe("review fixes", () => {
  test("an export reserves its job-copy bytes until it settles, and is refused over budget", async () => {
    const t = setup({ maxReservedBytes: 10_000_000 });
    const job = accepted(t.c.traceFinal(source(), request));
    t.e().ready();
    t.e().trace();
    await job.done;
    const exp = accepted(t.c.export("svg"));
    const held = t.c.reservedBytes;
    expect(held).toBeGreaterThan(0);
    expect(t.ledger.snapshot().reporters["jobs.reserved"]!.bytes).toBe(held);
    t.e().exportBytes();
    await exp.done;
    expect(t.c.reservedBytes).toBe(0);
    const tight = setup({ maxReservedBytes: 100 });
    const j2 = accepted(tight.c.traceFinal(source(), request));
    tight.e().ready();
    tight.e().trace();
    await j2.done;
    expect(tight.c.export("svg")).toMatchObject({ accepted: false, code: "resource_budget" });
    expect(owners(tight.session).snapshot).toBe(0);
  });

  test("a result of the wrong type or with unreadable metadata fails typed; nothing commits", async () => {
    const t = setup();
    const before = t.session.state;
    const a = accepted(t.c.traceFinal(source(), request));
    t.e().ready();
    t.e().exportBytes(); // an export result answering a trace
    expect(await a.done).toMatchObject({ status: "failed", code: "protocol_error" });
    const b = accepted(t.c.traceFinal(source(), request));
    t.e().emit({
      type: "result",
      jobId: t.e().job.jobId,
      generation: t.e().job.generation,
      memoryBytes: 1,
      result: {
        type: "trace",
        packet: fixturePacket("circle-bw"),
        sceneMetaJson: "{not json",
        metrics: {} as never,
        warnings: [],
        estimate: { kind: "unavailable", reason: "test" },
        timings: { segmentMs: 0, estimateMs: 0, fitMs: 0, parseMs: 0 },
      },
    });
    expect((await b.done).status).toBe("failed");
    expect(t.session.state).toBe(before);
  });
});
