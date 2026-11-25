// Shell binding to the G-JOB job system: final traces committed through JobController (the C2
// trust boundary) and engine exports. The canvas renders the document directly (G-R0/G-R1);
// no export job is involved in displaying it. No result is mocked: every outcome (rejected,
// stale, failed, cancelled) reaches the caller.
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
  const jobs = new JobController({
    scheduler,
    session: placeholder,
    engineVersion: BUILD_IDENTITY.engineVersion,
  });
  placeholders.set(jobs, placeholder);
  return jobs;
}

const placeholders = new WeakMap<JobController, DocumentSession>();

/** Points the controller at the workspace's document (or the placeholder when there is none). */
export function associate(jobs: JobController, session: DocumentSession | null): void {
  const target = session ?? placeholders.get(jobs)!;
  if (jobs.session !== target) jobs.replaceSession(target);
}

/**
 * Qualification only (`?debug=1`): when set, an import waits for this promise after decoding,
 * so tests can act during the preparation interval deterministically instead of by timing.
 */
export const preparationGate: { current: Promise<void> | null; release: (() => void) | null } = {
  current: null,
  release: null,
};

export class JobError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface TraceStart {
  jobId: number;
  /** The session the trace commits into (a new one when there was no document). */
  session: DocumentSession;
  /** Whether `session` was created for this import (adopted only if the trace commits). */
  created: boolean;
  done: Promise<CommitOutcome>;
}

/**
 * Decodes a local file and starts a final trace that commits as a new layer. With no current
 * document, a new document sized to the image is created; the caller adopts it only if the
 * trace commits, so a failed or cancelled import leaves no document (RFC-002 §7). The source
 * image is not attached: the trace carries its digest in provenance (C10).
 *
 * The target document is the one current when the import began (`current()`). If the import is
 * cancelled, or the workspace's document changes while the file is being prepared, no job is
 * submitted (`cancelled`, `document_replaced`), so the workspace and the job controller can
 * never be left pointing at different documents.
 */
export async function startTrace(
  jobs: JobController,
  file: File,
  preset: PresetId,
  current: () => DocumentSession | null,
  signal: AbortSignal,
  onProgress: (stage: Stage) => void,
): Promise<TraceStart> {
  const before = current();
  const check = () => {
    if (signal.aborted)
      throw new JobError("cancelled", "Import cancelled; the document is unchanged");
    if (current() !== before)
      throw new JobError(
        "document_replaced",
        "The document changed while the image was being prepared; the import was discarded",
      );
  };
  const [decoded, bytes] = await Promise.all([
    decodeImage(file, DEFAULT_MAX_PIXELS),
    file.arrayBuffer().then((b) => new Uint8Array(b)),
  ]);
  if (preparationGate.current) await preparationGate.current;
  check();
  const digest = await sha256Hex(bytes);
  check();
  const created = before === null;
  const session =
    before ??
    new DocumentSession(new GeometryStore(), {
      state: createDocument({ width: decoded.width, height: decoded.height }),
    });
  associate(jobs, session);
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
  if (!sub.accepted) {
    associate(jobs, before);
    throw new JobError(sub.code, sub.message);
  }
  return { jobId: sub.jobId, session, created, done: sub.done };
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
