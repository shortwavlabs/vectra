// Job controller: binds the scheduler to the document (RFC-002 §10.2–10.3, C2, C5, C8).
//
// - Committed state never depends on a worker: workers receive only fresh copies (trace input
//   copies, `GeometryStore.jobCopy`), and results are committed here, on the main thread, in
//   one transaction after the store's own validation (C2 commit is the trust boundary).
// - Explicit results are checked against the document they were requested for (RFC §10.3
//   rule 3b): a final trace into a new layer commits if its source asset still matches its
//   digest; a replace whose target changed, or any result for a replaced document, is `stale`.
// - Export snapshots are frozen at request time: the draw list and metadata are captured, and
//   the chunks are retained as `snapshot` until the job settles, whatever the outcome.
// - Jobs reserve their input bytes at submission and release them at settle (RFC §11.3).
import type { DocumentSession } from "../document/session.ts";
import { buildExport, type ExportJob } from "../document/export.ts";
import type { OwnerRef } from "../document/geometry-store.ts";
import type { ResourceLedger } from "../document/ledger.ts";
import type { AssetId, ChunkId, LayerNode, NodeId } from "../document/model.ts";
import {
  type DecodePolicy,
  type SceneMetaJson,
  traceProvenanceFromSceneMeta,
} from "../document/provenance.ts";
import type { PdfOptions, TraceRequest } from "../vectorization/types.ts";
import {
  type Stage,
  EXPORT_OPERATION_VERSION,
  type ExportResult,
  packetBuffers,
  type TraceResult,
} from "./protocol.ts";
import type { CancelReason, JobScheduler, JobTimings, QueuedJob } from "./scheduler.ts";

/** A decoded source. `rgba` is immutable and never transferred; each job posts its own copy. */
export interface TraceSource {
  readonly assetId: AssetId | null;
  readonly digest: string;
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  readonly decodePolicy: DecodePolicy;
}

export type Rejection = {
  readonly accepted: false;
  readonly code: "busy" | "build_mismatch" | "disposed" | "resource_budget";
  readonly message: string;
  readonly queued?: readonly QueuedJob[];
};
export type Accepted<T> = {
  readonly accepted: true;
  readonly jobId: number;
  readonly done: Promise<T>;
};

type Ended =
  | {
      readonly status: "failed";
      readonly jobId: number;
      readonly code: string;
      readonly message: string;
    }
  | { readonly status: "cancelled"; readonly jobId: number; readonly reason: CancelReason };

export type PreviewOutcome =
  | {
      readonly status: "succeeded";
      readonly jobId: number;
      readonly result: TraceResult;
      readonly memoryBytes: number;
      readonly timings: JobTimings;
    }
  | Ended;

export type CommitOutcome =
  | {
      readonly status: "committed";
      readonly jobId: number;
      readonly revision: number;
      readonly layerId: NodeId;
      readonly chunkId: ChunkId;
      readonly result: Omit<TraceResult, "packet">;
      readonly timings: JobTimings;
    }
  | {
      readonly status: "stale";
      readonly jobId: number;
      readonly reason: "document_replaced" | "source_changed" | "target_changed";
    }
  | Ended;

export type ExportOutcome =
  | {
      readonly status: "delivered";
      readonly jobId: number;
      readonly form: ExportJob["form"];
      readonly format: "svg" | "pdf";
      readonly bytes: Uint8Array;
      readonly timings: JobTimings & { readonly exportMs: number };
    }
  | Ended;

export interface ControllerOptions {
  scheduler: JobScheduler;
  session: DocumentSession;
  /** Engine version recorded in document-form export metadata (the build's engine). */
  engineVersion: string;
  /** Bytes that pending jobs may reserve for their input copies (RFC §11.3). */
  maxReservedBytes?: number;
  ledger?: ResourceLedger;
}

const deepFreeze = <T>(v: T): T => {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
};

export class JobController {
  readonly scheduler: JobScheduler;
  #session: DocumentSession;
  readonly #engineVersion: string;
  readonly #maxReserved: number;
  #reserved = 0;
  readonly #unregister: (() => void)[] = [];

  constructor(o: ControllerOptions) {
    this.scheduler = o.scheduler;
    this.#session = o.session;
    this.#engineVersion = o.engineVersion;
    this.#maxReserved = o.maxReservedBytes ?? 1024 ** 3;
    if (o.ledger) {
      this.#unregister.push(
        o.ledger.register({ id: "jobs.reserved", kind: "job-copies", bytes: () => this.#reserved }),
        o.ledger.register({
          id: "jobs.compute-worker",
          kind: "compute-worker",
          bytes: () => this.scheduler.lastMemoryBytes,
        }),
      );
    }
  }

  get session(): DocumentSession {
    return this.#session;
  }
  /** Bytes currently reserved by accepted, unsettled jobs. */
  get reservedBytes(): number {
    return this.#reserved;
  }

  /** Replaces the document (e.g. Open). Results requested for the old one become `stale`. */
  replaceSession(session: DocumentSession): void {
    this.#session = session;
  }

  cancel(jobId: number): boolean {
    return this.scheduler.cancel(jobId);
  }

  dispose(): void {
    this.scheduler.dispose();
    for (const u of this.#unregister.splice(0)) u();
  }

  // --- traces ---------------------------------------------------------------------------------
  /** A preview trace: supersedable, never committed (RFC §10.4). */
  tracePreview(
    src: TraceSource,
    request: TraceRequest,
    scope = "trace",
    onProgress?: (stage: Stage) => void,
  ): Accepted<PreviewOutcome> | Rejection {
    return this.#trace(src, request, "preview", scope, onProgress, (_jobId, o) => o);
  }

  /** A final trace, committed as a new layer (or replacing `replaceLayerId`) when it succeeds. */
  traceFinal(
    src: TraceSource,
    request: TraceRequest,
    o: { replaceLayerId?: NodeId; name?: string; onProgress?: (stage: Stage) => void } = {},
  ): Accepted<CommitOutcome> | Rejection {
    const session = this.#session;
    const target =
      o.replaceLayerId === undefined ? null : this.#layerChunks(session, o.replaceLayerId);
    return this.#trace(
      src,
      request,
      "final",
      "final",
      o.onProgress,
      (jobId, out): CommitOutcome => {
        if (out.status !== "succeeded") return out;
        if (this.#session !== session)
          return { status: "stale", jobId, reason: "document_replaced" };
        const asset =
          src.assetId === null ? undefined : session.state.sourceAssetsById.get(src.assetId);
        if (src.assetId !== null && asset?.digest !== src.digest)
          return { status: "stale", jobId, reason: "source_changed" };
        if (
          o.replaceLayerId !== undefined &&
          this.#layerChunks(session, o.replaceLayerId) !== target
        )
          return { status: "stale", jobId, reason: "target_changed" };
        const { packet, ...rest } = out.result;
        const sceneMeta = JSON.parse(rest.sceneMetaJson) as SceneMetaJson;
        const settings = request.settings as { fit?: { mode?: string } };
        try {
          const provenance = traceProvenanceFromSceneMeta({
            sceneMeta,
            width: packet.manifest.width,
            height: packet.manifest.height,
            traceRequest: {
              presetVersion: request.presetVersion,
              seed: request.seed,
              maxPixels: request.maxPixels,
              maxAnchors: request.maxAnchors,
              settings: request.settings as unknown as Record<string, unknown>,
            },
            source: { digest: src.digest, width: src.width, height: src.height },
            decodePolicy: src.decodePolicy,
            precisionFitVersion: settings.fit?.mode === "precision" ? 1 : null,
          });
          const before = new Set(session.state.orderedRootIds);
          const revision = session.dispatch({
            type: "commitTrace",
            packet,
            provenance,
            ...(o.replaceLayerId === undefined ? {} : { replaceLayerId: o.replaceLayerId }),
            ...(o.name === undefined ? {} : { name: o.name }),
          });
          const layerId =
            o.replaceLayerId ?? session.state.orderedRootIds.find((id) => !before.has(id))!;
          const layer = session.state.nodesById.get(layerId) as LayerNode;
          return {
            status: "committed",
            jobId,
            revision,
            layerId,
            chunkId: layer.traceProvenance!.chunkId,
            result: rest,
            timings: out.timings,
          };
        } catch (e) {
          // Commit validation (packet, document invariants, history budget) failed: nothing changed.
          const code = (e as { code?: unknown }).code;
          return {
            status: "failed",
            jobId,
            code: typeof code === "string" ? code : "commit_failed",
            message: e instanceof Error ? e.message : String(e),
          };
        }
      },
    );
  }

  #layerChunks(session: DocumentSession, layerId: NodeId): string | null {
    const s = session.state;
    if (!s.nodesById.has(layerId)) return null;
    const chunks = new Set<ChunkId>();
    const walk = (id: NodeId) => {
      const n = s.nodesById.get(id)!;
      if (n.kind === "path") chunks.add(n.geometry.chunkId);
      else if ("orderedChildIds" in n) for (const c of n.orderedChildIds) walk(c);
    };
    walk(layerId);
    return [...chunks].sort().join(",");
  }

  #trace<T>(
    src: TraceSource,
    request: TraceRequest,
    kind: "preview" | "final",
    scope: string,
    onProgress: ((stage: Stage) => void) | undefined,
    finish: (jobId: number, o: PreviewOutcome) => T,
  ): Accepted<T> | Rejection {
    const bytes = src.width * src.height * 4;
    if (src.width * src.height > request.maxPixels)
      return this.#budget(
        `the image has ${src.width * src.height} pixels; the limit is ${request.maxPixels}. Reduce its resolution and try again`,
      );
    if (src.rgba.byteLength !== bytes) throw new RangeError("rgba length does not match the size");
    if (!this.scheduler.canAccept(kind)) return this.#refuse(kind);
    if (this.#reserved + bytes > this.#maxReserved)
      return this.#budget(
        `this operation needs ${bytes} bytes but only ${this.#maxReserved - this.#reserved} are free for pending work. Wait for other operations or reduce the resolution`,
      );
    const sub = this.scheduler.submit({
      kind,
      scope,
      documentRevision: this.#session.getSnapshot().revision,
      operationVersion: request.presetVersion,
      sourceDigest: src.digest,
      ...(onProgress ? { onProgress } : {}),
      build: (h) => {
        const rgba = src.rgba.slice().buffer; // the job copy, allocated only when posted
        return [
          {
            type: "trace",
            ...h,
            sourceDigest: src.digest,
            rgba,
            width: src.width,
            height: src.height,
            request,
            quality: kind,
          },
          [rgba],
        ];
      },
    });
    if (!sub.accepted) return this.#rejection(sub);
    this.#reserved += bytes;
    const done = sub.done.then((o) => {
      this.#reserved -= bytes;
      const jobId = sub.jobId;
      const out: PreviewOutcome =
        o.status === "succeeded"
          ? {
              status: "succeeded",
              jobId,
              result: o.result as TraceResult,
              memoryBytes: o.memoryBytes,
              timings: o.timings,
            }
          : o.status === "failed"
            ? { status: "failed", jobId, code: o.code, message: o.message }
            : { status: "cancelled", jobId, reason: o.reason };
      return finish(jobId, out);
    });
    return { accepted: true, jobId: sub.jobId, done };
  }

  // --- export ---------------------------------------------------------------------------------
  /**
   * Exports a document (the controller's by default). The snapshot is frozen now; later edits
   * do not affect it. `kind: "preview"` makes it a supersedable display job (the workbench's SVG
   * preview); exports are explicit otherwise.
   */
  export(
    format: "svg" | "pdf",
    options: PdfOptions | null = null,
    o: {
      session?: DocumentSession;
      kind?: "export" | "preview";
      scope?: string;
      onProgress?: (stage: Stage) => void;
    } = {},
  ): Accepted<ExportOutcome> | Rejection {
    const kind = o.kind ?? "export";
    if (!this.scheduler.canAccept(kind)) return this.#refuse(kind);
    const session = o.session ?? this.#session;
    const store = session.store;
    const job = deepFreeze(buildExport(session.state, store, this.#engineVersion));
    const owner: OwnerRef = { kind: "snapshot" };
    for (const c of job.chunks) store.retain(c, owner);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      for (const c of job.chunks) store.release(c, owner);
      store.settle();
    };
    const sub = this.scheduler.submit({
      kind,
      scope: o.scope ?? "export",
      documentRevision: session.getSnapshot().revision,
      operationVersion: EXPORT_OPERATION_VERSION,
      ...(o.onProgress ? { onProgress: o.onProgress } : {}),
      build: (h) => {
        const { packets } = store.jobCopy([...job.chunks]);
        return [
          {
            type: "export",
            ...h,
            format,
            drawList: job.drawList,
            chunks: packets,
            sceneMeta: job.sceneMeta,
            options,
          },
          packets.flatMap(packetBuffers),
        ];
      },
    });
    if (!sub.accepted) {
      release();
      return this.#rejection(sub);
    }
    const done = sub.done.then((o): ExportOutcome => {
      release();
      const jobId = sub.jobId;
      if (o.status === "failed")
        return { status: "failed", jobId, code: o.code, message: o.message };
      if (o.status === "cancelled") return { status: "cancelled", jobId, reason: o.reason };
      const r = o.result as ExportResult;
      return {
        status: "delivered",
        jobId,
        form: job.form,
        format,
        bytes: new Uint8Array(r.bytes),
        timings: { ...o.timings, exportMs: r.timings.exportMs },
      };
    });
    return { accepted: true, jobId: sub.jobId, done };
  }

  // --- rejections -----------------------------------------------------------------------------
  #refuse(kind: "preview" | "final" | "export"): Rejection {
    const sub = this.scheduler.submit({
      kind,
      scope: "refused",
      documentRevision: 0,
      operationVersion: 0,
      build: () => {
        throw new Error("unreachable: a refused job is never posted");
      },
    });
    if (sub.accepted) throw new Error("scheduler accepted a job canAccept refused");
    return this.#rejection(sub);
  }

  #rejection(sub: Extract<ReturnType<JobScheduler["submit"]>, { accepted: false }>): Rejection {
    return sub.code === "busy"
      ? { accepted: false, code: "busy", message: sub.message, queued: sub.queued }
      : { accepted: false, code: sub.code, message: sub.message };
  }

  #budget(message: string): Rejection {
    return { accepted: false, code: "resource_budget", message };
  }
}
