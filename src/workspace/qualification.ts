// Engineering qualification API (workbench `?debug=1` only). It drives the production job
// system for the G-JOB browser tests (R03 lifecycle scenarios and the adversarial set) and
// returns outcomes, counters and digests only, never artwork.
import { GeometryStore } from "../document/geometry-store.ts";
import { createDocument, type NodeId, type PathNode } from "../document/model.ts";
import { DocumentSession, sha256Hex } from "../document/session.ts";
import type {
  CommitOutcome,
  ExportOutcome,
  JobController,
  PreviewOutcome,
  Rejection,
} from "../jobs/controller.ts";
import type { DebugFault } from "../jobs/protocol.ts";
import { DEFAULT_SETTINGS, makeRequest } from "../presets/defaults.ts";
import { saveContainer } from "../persistence/container.ts";
import type { Mode, Settings } from "../vectorization/types.ts";
import type { Source } from "./useWorkbench.ts";

export interface Summary {
  status: string;
  jobId: number;
  code?: string;
  reason?: string;
  layerId?: string;
  revision?: number;
  form?: string;
  bytes?: number;
  bytesDigest?: string;
  anchors?: number;
  estimate?: unknown;
  queuedMs?: number;
  workerMs?: number;
  postMs?: number;
  commitMs?: number;
  storeCommit?: unknown;
  snapshotMs?: number;
  settledAt: number;
}

export interface TraceOptions {
  /** Explicit settings, or the defaults of `mode` (bw when neither is given). */
  settings?: Settings;
  mode?: Mode;
  maxPixels?: number;
  maxAnchors?: number;
  scope?: string;
  replaceLayerId?: NodeId;
}

export function installQualificationApi(jobs: JobController, source: () => Source | null) {
  const outcomes = new Map<number, Promise<Summary>>();
  /** Stages each job reported, in order, with the main-thread time they arrived. */
  const stages = new Map<number, { stage: string; at: number }[]>();
  let pendingStages: { stage: string; at: number }[] = [];
  const summarize = async (o: PreviewOutcome | CommitOutcome | ExportOutcome): Promise<Summary> => {
    const s: Summary = { status: o.status, jobId: o.jobId, settledAt: performance.now() };
    if (o.status === "failed") s.code = o.code;
    if (o.status === "cancelled" || o.status === "stale") s.reason = o.reason;
    if (o.status === "committed") {
      s.layerId = o.layerId;
      s.revision = o.revision;
      s.anchors = o.result.metrics.stats.anchors;
      s.estimate = o.result.estimate;
    }
    if (o.status === "succeeded") {
      s.anchors = o.result.metrics.stats.anchors;
      s.estimate = o.result.estimate;
    }
    if (o.status === "delivered") {
      s.form = o.form;
      s.bytes = o.bytes.byteLength;
      s.bytesDigest = await sha256Hex(o.bytes);
    }
    if ("timings" in o) {
      s.queuedMs = o.timings.queuedMs;
      s.workerMs = o.timings.workerMs;
      s.postMs = o.timings.postMs;
      if ("commitMs" in o.timings) {
        s.commitMs = o.timings.commitMs;
        s.storeCommit = o.timings.storeCommit;
      }
      if ("snapshotMs" in o.timings) s.snapshotMs = o.timings.snapshotMs;
    }
    return s;
  };
  const record = <T extends PreviewOutcome | CommitOutcome | ExportOutcome>(
    sub: { accepted: true; jobId: number; done: Promise<T> } | Rejection,
  ) => {
    if (!sub.accepted) return { accepted: false, code: sub.code, message: sub.message };
    stages.set(sub.jobId, pendingStages);
    pendingStages = [];
    outcomes.set(sub.jobId, sub.done.then(summarize));
    return { accepted: true, jobId: sub.jobId };
  };
  const request = (o: TraceOptions) =>
    makeRequest(
      o.settings ?? DEFAULT_SETTINGS[o.mode ?? "bw"],
      o.maxPixels ?? 50_000_000,
      o.maxAnchors,
    );
  const src = () => {
    const s = source();
    if (!s) throw new Error("no source loaded");
    return s.trace;
  };
  const session = () => jobs.session;
  // Each submission gets its own stage list (bound before the job id is known).
  const progress = () => {
    const list: { stage: string; at: number }[] = [];
    pendingStages = list;
    return (stage: string) => list.push({ stage, at: performance.now() });
  };

  return {
    preview: (o: TraceOptions = {}) =>
      record(jobs.tracePreview(src(), request(o), o.scope ?? "qualification", progress())),
    final: (o: TraceOptions = {}) =>
      record(
        jobs.traceFinal(src(), request(o), {
          onProgress: progress(),
          ...(o.replaceLayerId ? { replaceLayerId: o.replaceLayerId } : {}),
        }),
      ),
    exportDocument: (format: "svg" | "pdf") =>
      record(
        jobs.export(format, format === "pdf" ? { width: 200, unit: "mm" } : null, {
          onProgress: progress(),
        }),
      ),
    stages: (jobId: number) => stages.get(jobId) ?? [],
    /** Explicit cancel; returns the main-thread acknowledgement time (C9). */
    cancel: (jobId: number) => {
      const t = performance.now();
      const ok = jobs.cancel(jobId);
      return { ok, ackMs: performance.now() - t };
    },
    outcome: (jobId: number) => outcomes.get(jobId) ?? Promise.resolve(null),
    undo: () => session().undo(),
    redo: () => session().redo(),
    revision: () => session().getSnapshot().revision,
    layerIds: () =>
      session().state.orderedRootIds.filter(
        (id) => session().state.nodesById.get(id)?.kind === "layer",
      ),
    /** A concurrent structural edit: recolours every path. */
    recolourAll: (color: number) =>
      session().dispatch({
        type: "setFill",
        ids: [...session().state.nodesById.values()]
          .filter((n): n is PathNode => n.kind === "path")
          .map((n) => n.id),
        fill: { color },
      }),
    /** Replaces the document (as Open would); results for the old one become stale. */
    replaceDocument: () =>
      jobs.replaceSession(
        new DocumentSession(new GeometryStore(), {
          state: createDocument({ documentId: "replacement", width: 1, height: 1 }),
        }),
      ),
    /** SHA-256 of the canonical uncompressed container: geometry, history-independent state
     *  and provenance (C7). Equal digests mean the committed document is byte-identical. */
    documentDigest: async () => sha256Hex(await saveContainer(session(), { codec: "none" })),
    storeIntact: () => session().store.checkIntegrity(),
    inject: (fault: DebugFault) => jobs.scheduler.inject(fault),
    diag: () => {
      const store = session().store;
      let snapshotRefs = 0;
      let jobRefs = 0;
      for (const id of store.chunkIds()) {
        const n = store.ownerCounts(id);
        snapshotRefs += n.snapshot;
        jobRefs += n.job;
      }
      return {
        ...jobs.scheduler.diag,
        state: jobs.scheduler.state,
        running: jobs.scheduler.running,
        queued: jobs.scheduler.queued,
        reservedBytes: jobs.reservedBytes,
        lastMemoryBytes: jobs.scheduler.lastMemoryBytes,
        snapshotRefs,
        jobRefs,
      };
    },
  };
}
