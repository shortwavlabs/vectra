// Shell binding to the G-JOB job system: final traces committed through JobController (the C2
// trust boundary), engine exports, and the interim canvas's preview-class SVG. No result is
// mocked: every outcome (rejected, stale, failed, cancelled) reaches the caller.
import { GeometryStore } from "../document/geometry-store.ts";
import { createDocument } from "../document/model.ts";
import { DocumentSession, sha256Hex } from "../document/session.ts";
import { BUILD_IDENTITY } from "../jobs/build-info.ts";
import { type CommitOutcome, JobController } from "../jobs/controller.ts";
import type { Stage } from "../jobs/protocol.ts";
import { JobScheduler, type WorkerLike } from "../jobs/scheduler.ts";
import { DEFAULT_SETTINGS, makeRequest } from "../presets/defaults.ts";
import { DEFAULT_MAX_PIXELS, decodeImage } from "../vectorization/intake.ts";
import type { PdfOptions } from "../vectorization/types.ts";

/** The P1 presets the engine provides today (gray and silhouette are not implemented yet). */
export const PRESETS = [
  { id: "bw", label: "Black & White" },
  { id: "color", label: "Full Colour" },
  { id: "limited", label: "Limited Palette" },
] as const;
export type PresetId = (typeof PRESETS)[number]["id"];

export function createJobs(onBuildMismatch: (detail: string) => void): JobController {
  const scheduler = new JobScheduler({
    createWorker: () =>
      new Worker(new URL("../jobs/compute.worker.ts", import.meta.url), {
        type: "module",
      }) as unknown as WorkerLike,
    identity: BUILD_IDENTITY,
    onBuildMismatch,
  });
  // A placeholder until the first import creates the real document.
  const placeholder = new DocumentSession(new GeometryStore(), {
    state: createDocument({ documentId: "none", width: 1, height: 1 }),
  });
  return new JobController({
    scheduler,
    session: placeholder,
    engineVersion: BUILD_IDENTITY.engineVersion,
  });
}

export class JobError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const latestPreview = new WeakMap<JobController, number>();
/**
 * Preview-class SVG of a session for display. Only the latest request is ever resubmitted
 * after a preemption (by a higher-priority job): a newer request preempts an older one in the
 * same scope, and resubmitting the older one would in turn preempt the newer (live-lock).
 */
export async function renderPreviewSvg(
  jobs: JobController,
  session: DocumentSession,
): Promise<Uint8Array> {
  const token = (latestPreview.get(jobs) ?? 0) + 1;
  latestPreview.set(jobs, token);
  for (;;) {
    const sub = jobs.export("svg", null, { session, kind: "preview", scope: "canvas" });
    if (!sub.accepted) throw new JobError(sub.code, sub.message);
    const out = await sub.done;
    if (out.status === "delivered") return out.bytes;
    if (out.status === "failed") throw new JobError(out.code, out.message);
    if (out.reason !== "preempted" || latestPreview.get(jobs) !== token)
      throw new JobError("superseded", "preview superseded by a newer request");
  }
}

export interface TraceStart {
  jobId: number;
  /** The session the trace commits into (a new one when there was no document). */
  session: DocumentSession;
  done: Promise<CommitOutcome>;
}

/**
 * Decodes a local file and starts a final trace that commits as a new layer. With no current
 * document, a new document sized to the image is created; the caller adopts it only if the
 * trace commits, so a failed or cancelled import leaves no document (RFC-002 §7). The source
 * image is not attached: the trace carries its digest in provenance (C10).
 */
export async function startTrace(
  jobs: JobController,
  file: File,
  preset: PresetId,
  current: DocumentSession | null,
  onProgress: (stage: Stage) => void,
): Promise<TraceStart> {
  const [decoded, bytes] = await Promise.all([
    decodeImage(file, DEFAULT_MAX_PIXELS),
    file.arrayBuffer().then((b) => new Uint8Array(b)),
  ]);
  const digest = await sha256Hex(bytes);
  const session =
    current ??
    new DocumentSession(new GeometryStore(), {
      state: createDocument({ width: decoded.width, height: decoded.height }),
    });
  if (jobs.session !== session) jobs.replaceSession(session);
  const sub = jobs.traceFinal(
    {
      assetId: null,
      digest,
      width: decoded.width,
      height: decoded.height,
      rgba: new Uint8Array(decoded.rgba.buffer, decoded.rgba.byteOffset, decoded.rgba.byteLength),
      decodePolicy: "browser-canvas-v1",
    },
    makeRequest(DEFAULT_SETTINGS[preset], DEFAULT_MAX_PIXELS),
    { name: file.name.replace(/\.[^.]+$/, "") || "Trace", onProgress },
  );
  if (!sub.accepted) throw new JobError(sub.code, sub.message);
  return { jobId: sub.jobId, session, done: sub.done };
}

/** An explicit engine export of the current document (frozen at request time). */
export async function exportDocument(
  jobs: JobController,
  session: DocumentSession,
  format: "svg" | "pdf",
  pdf: PdfOptions | null,
): Promise<Uint8Array | null> {
  const sub = jobs.export(format, format === "pdf" ? pdf : null, { session });
  if (!sub.accepted) throw new JobError(sub.code, sub.message);
  const out = await sub.done;
  if (out.status === "delivered") return out.bytes;
  if (out.status === "failed") throw new JobError(out.code, out.message);
  return null; // cancelled
}
