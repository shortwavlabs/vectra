import { useCallback, useEffect, useRef, useState } from "react";
import { GeometryStore } from "../document/geometry-store.ts";
import { createDocument } from "../document/model.ts";
import {
  hexToRgba,
  type SceneMetaJson,
  traceProvenanceFromSceneMeta,
} from "../document/provenance.ts";
import { DocumentSession, sha256Hex } from "../document/session.ts";
import { downloadBlob } from "../export/download.ts";
import { BUILD_IDENTITY } from "../jobs/build-info.ts";
import {
  type ExportOutcome,
  JobController,
  type PreviewOutcome,
  type TraceSource,
} from "../jobs/controller.ts";
import { watchOfflineStatus } from "../jobs/offline-status.ts";
import type { TraceResult } from "../jobs/protocol.ts";
import { JobScheduler, type WorkerLike } from "../jobs/scheduler.ts";
import { DEFAULT_SETTINGS, makeRequest } from "../presets/defaults.ts";
import {
  DEFAULT_MAX_PIXELS,
  type DecodedImage,
  decodeImage,
  IntakeError,
} from "../vectorization/intake.ts";
import type {
  EngineMetrics,
  EngineWarning,
  PdfOptions,
  Settings,
  TraceRequest,
} from "../vectorization/types.ts";
import type { DocumentRenderHost } from "../canvas-host/render-host.ts";
import type { CanvasHostState } from "../canvas-host/types.ts";
import type { NodeId } from "../document/model.ts";
import { loadContainer } from "../persistence/container.ts";
import { installQualificationApi } from "./qualification.ts";
import { type ResponsivenessSample, startProbe } from "./responsiveness.ts";

export interface Source extends DecodedImage {
  revision: number;
  name: string;
  bytes: number;
  url: string;
  /** SHA-256 of the file bytes (C10 source identity; never the file name). */
  digest: string;
  trace: TraceSource;
}

export interface Result {
  jobId: number;
  revision: number;
  /** SVG of the preview (only with the `?svgPreview=1` comparison toggle). */
  svg: string | null;
  metrics: EngineMetrics;
  warnings: EngineWarning[];
  timings: {
    /** Worker time inside the staged engine calls (segment + estimate + fit). */
    wasmCallMs: number;
    segmentMs: number;
    estimateMs: number;
    fitMs: number;
    /** Worker time of the SVG serialisation job (`?svgPreview=1` only). */
    svgMs: number | null;
    parseMs: number;
  };
  memoryBytes: number;
  /** Trace submitted → result received (plus the SVG job with `?svgPreview=1`). */
  roundTripMs: number;
  svgUrl: string | null;
  svgBytes: number | null;
  responsiveness: ResponsivenessSample;
  request: TraceRequest;
  /** The validated preview, held outside the document (a preview is never committed). */
  preview: DocumentSession;
}

export type Status =
  | { kind: "idle" }
  | { kind: "decoding" }
  | { kind: "processing"; since: number; revision: number }
  | { kind: "done" }
  | { kind: "cancelled"; ackMs: number }
  | { kind: "error"; code: string; message: string };

export interface PdfInfo {
  bytes: number;
  ms: number;
  options: PdfOptions;
}

declare global {
  interface Window {
    /** Engineering instrumentation for browser tests. Contains metrics only, never artwork. */
    __vectra?: Record<string, unknown>;
  }
}

const createWorker = () =>
  new Worker(new URL("../jobs/compute.worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as WorkerLike;

/** A preview held in its own session: the store's commit validates it (C2 trust boundary), and
 *  its unedited single trace exports in original form, byte-identical to the engine route. */
function previewSession(src: Source, request: TraceRequest, out: TraceResult) {
  const { packet } = out;
  const sceneMeta = JSON.parse(out.sceneMetaJson) as SceneMetaJson;
  const session = new DocumentSession(new GeometryStore(), {
    state: createDocument({
      documentId: "preview",
      width: packet.manifest.width,
      height: packet.manifest.height,
      background: sceneMeta.background === null ? null : hexToRgba(sceneMeta.background),
    }),
  });
  const settings = request.settings as { fit?: { mode?: string } };
  session.dispatch({
    type: "commitTrace",
    packet: out.packet,
    provenance: traceProvenanceFromSceneMeta({
      sceneMeta,
      width: packet.manifest.width,
      height: packet.manifest.height,
      traceRequest: {
        ...request,
        settings: request.settings as unknown as Record<string, unknown>,
      },
      source: { digest: src.digest, width: src.width, height: src.height },
      decodePolicy: "browser-canvas-v1",
      precisionFitVersion: settings.fit?.mode === "precision" ? 1 : null,
    }),
  });
  return session;
}

const emptyDocument = (width = 1, height = 1) =>
  new DocumentSession(new GeometryStore(), {
    state: createDocument({ documentId: "workbench", width, height }),
  });

export function useWorkbench() {
  // Engineering options for tests: ?debug=1 exposes fault injection and the qualification API;
  // ?recycleMiB=N lowers the recycle threshold; ?startupTimeoutMs=N (debug only) shortens the
  // start-up timeout. None of them touches artwork.
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const debugMode = params.get("debug") === "1";
  // ?svgPreview=1: the P0 SVG <img> preview, kept for visual comparison (G-R0); ?renderer=main:
  // the main-thread renderer instead of the render worker.
  const svgPreview = params.get("svgPreview") === "1";
  const forceMainThread = params.get("renderer") === "main";
  const [buildMismatch, setBuildMismatch] = useState<string | null>(null);
  const [jobs] = useState(() => {
    const recycleMiB = Number(params.get("recycleMiB"));
    const startupTimeoutMs = Number(params.get("startupTimeoutMs"));
    const scheduler = new JobScheduler({
      createWorker,
      identity: BUILD_IDENTITY,
      ...(recycleMiB > 0 ? { recycleAboveBytes: recycleMiB * 1024 * 1024 } : {}),
      ...(debugMode && startupTimeoutMs > 0 ? { startupTimeoutMs } : {}),
      onBuildMismatch: (detail) => setBuildMismatch(detail),
    });
    return new JobController({
      scheduler,
      session: emptyDocument(),
      engineVersion: BUILD_IDENTITY.engineVersion,
    });
  });
  const scheduler = jobs.scheduler;
  const [offlineReady, setOfflineReady] = useState(false);
  const [updateWaiting, setUpdateWaiting] = useState(false);
  const [offlineMismatch, setOfflineMismatch] = useState(false);
  const [source, setSource] = useState<Source | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS.bw);
  const [maxPixels, setMaxPixels] = useState(DEFAULT_MAX_PIXELS);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [result, setResult] = useState<Result | null>(null);
  const [pdf, setPdf] = useState<PdfInfo | null>(null);
  const [selection, setSelection] = useState<readonly NodeId[]>([]);
  /** A document shown instead of the preview (engineering: correctness fixtures). */
  const [shown, setShown] = useState<DocumentSession | null>(null);
  const [canvasState, setCanvasState] = useState<CanvasHostState>({ kind: "starting" });
  const awaitingFrame = useRef(false);
  const canvasHost = useRef<DocumentRenderHost | null>(null);
  const selectionRef = useRef(selection);
  const shownRef = useRef(shown);
  useEffect(() => {
    selectionRef.current = selection;
    shownRef.current = shown;
  }, [selection, shown]);
  const revision = useRef(0);
  /** The preview jobs in flight (trace, then its SVG); cancel and new files stop them. */
  const previewJobs = useRef(new Set<number>());
  // Timing anchors for the performance baseline (metrics only).
  const importAt = useRef(0);
  const resultAt = useRef(0);
  const previewProbe = useRef<(() => ResponsivenessSample) | null>(null);
  const debug = useRef<Record<string, unknown>>({ stats: scheduler.diag, results: 0 });
  const sourceRef = useRef<Source | null>(null);
  const live = useRef(0);
  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  useEffect(() => {
    window.__vectra = debug.current;
    if (debugMode) {
      debug.current.crashWorker = () => scheduler.inject("crash-now");
      debug.current.jobs = installQualificationApi(jobs, () => sourceRef.current);
    }
    void scheduler.warmup().then((ready) => {
      if (ready) debug.current.ready = scheduler.lastReady;
    });
    // Offline recovery needs the service worker to control this page with this build.
    const stopOffline = watchOfflineStatus((o) => {
      debug.current.updateWaiting = o.updateWaiting;
      debug.current.offlineReady = o.ready;
      debug.current.controllerBuild = o.controller;
      setUpdateWaiting(o.updateWaiting);
      setOfflineReady(o.ready);
      setOfflineMismatch(o.mismatch);
    });
    const mounts = live; // a counter, not a DOM ref: the same object in setup and cleanup
    mounts.current++;
    return () => {
      mounts.current--;
      stopOffline();
      // React StrictMode (development) runs this cleanup and the setup again at once with the
      // same state: dispose only if no setup followed, so the scheduler survives the remount.
      setTimeout(() => {
        if (mounts.current === 0) jobs.dispose();
      });
    };
  }, [jobs, scheduler, debugMode]);

  const cancelPreviews = useCallback(() => {
    let cancelled = false;
    for (const id of previewJobs.current) cancelled = jobs.cancel(id) || cancelled;
    previewJobs.current.clear();
    return cancelled;
  }, [jobs]);

  const loadFile = useCallback(
    async (file: File) => {
      // Previews of the old image stop; accepted explicit jobs are never cancelled implicitly.
      cancelPreviews();
      importAt.current = performance.now();
      const rev = ++revision.current;
      setStatus({ kind: "decoding" });
      setResult((prev) => {
        if (prev?.svgUrl) URL.revokeObjectURL(prev.svgUrl);
        return null;
      });
      setPdf(null);
      try {
        const [decoded, bytes] = await Promise.all([
          decodeImage(file, maxPixels),
          file.arrayBuffer().then((b) => new Uint8Array(b)),
        ]);
        const digest = await sha256Hex(bytes);
        if (rev !== revision.current) return; // a newer file was chosen meanwhile
        // A new image opens a new workbench document holding it as a (linked) source.
        const doc = emptyDocument(decoded.width, decoded.height);
        await doc.attachSource(bytes, { embedded: false, name: file.name });
        if (rev !== revision.current) return;
        jobs.replaceSession(doc);
        const assetId = [...doc.state.sourceAssetsById.keys()][0] ?? null;
        const trace: TraceSource = {
          assetId,
          digest,
          width: decoded.width,
          height: decoded.height,
          rgba: new Uint8Array(
            decoded.rgba.buffer,
            decoded.rgba.byteOffset,
            decoded.rgba.byteLength,
          ),
          decodePolicy: "browser-canvas-v1",
        };
        setSource((prev) => {
          if (prev) URL.revokeObjectURL(prev.url);
          return {
            ...decoded,
            revision: rev,
            name: file.name,
            bytes: file.size,
            url: URL.createObjectURL(file),
            digest,
            trace,
          };
        });
        debug.current.decodeMs = decoded.decodeMs;
      } catch (e) {
        if (rev !== revision.current) return;
        const code = e instanceof IntakeError ? e.code : "decode_failed";
        setStatus({ kind: "error", code, message: e instanceof Error ? e.message : String(e) });
      }
    },
    [jobs, maxPixels, cancelPreviews],
  );

  const fail = useCallback((code: string, message: string) => {
    setStatus({ kind: "error", code, message });
  }, []);

  /** Increments per trace request; only the latest request may update the UI. */
  const latestTrace = useRef(0);

  // One preview pipeline per workbench: the trace, then its SVG job, both scope "workbench", so
  // a newer request pre-empts or supersedes either step. Only the latest request (same image,
  // latest settings) may update the UI; a step pre-empted by an explicit job (an export) is
  // submitted again, so the latest settings are always shown in the end.
  const trace = useCallback(
    (src: Source, s: Settings) => {
      const token = ++latestTrace.current;
      const isLatest = () => token === latestTrace.current && src.revision === revision.current;
      const stop = startProbe();
      setStatus({ kind: "processing", since: performance.now(), revision: src.revision });
      const request = makeRequest(s, maxPixels);

      const showResult = (
        out: Extract<PreviewOutcome, { status: "succeeded" }>,
        svgOut: Extract<ExportOutcome, { status: "delivered" }> | null,
        preview: DocumentSession,
        handling: Record<string, unknown>,
      ) => {
        const responsiveness = stop();
        const r = out.result;
        resultAt.current = performance.now();
        previewProbe.current?.(); // a previous preview never painted: stop its probe
        previewProbe.current = startProbe();
        const blob = svgOut
          ? new Blob([svgOut.bytes as Uint8Array<ArrayBuffer>], { type: "image/svg+xml" })
          : null;
        const wasmCallMs = r.timings.segmentMs + r.timings.estimateMs + r.timings.fitMs;
        const next: Result = {
          jobId: out.jobId,
          revision: src.revision,
          svg: svgOut ? new TextDecoder().decode(svgOut.bytes) : null,
          metrics: r.metrics,
          warnings: r.warnings,
          timings: { ...r.timings, wasmCallMs, svgMs: svgOut?.timings.exportMs ?? null },
          memoryBytes: out.memoryBytes,
          roundTripMs:
            out.timings.queuedMs +
            out.timings.workerMs +
            (svgOut ? svgOut.timings.queuedMs + svgOut.timings.workerMs : 0),
          svgUrl: blob ? URL.createObjectURL(blob) : null,
          svgBytes: blob?.size ?? null,
          responsiveness,
          request,
          preview,
        };
        setResult((prev) => {
          if (prev?.svgUrl) URL.revokeObjectURL(prev.svgUrl);
          return next;
        });
        setSelection([]);
        setPdf(null);
        setStatus({ kind: "done" });
        awaitingFrame.current = true;
        debug.current.results = (debug.current.results as number) + 1;
        debug.current.lastRequest = request;
        debug.current.last = {
          jobId: out.jobId,
          metrics: r.metrics,
          estimate: r.estimate,
          timings: next.timings,
          roundTripMs: next.roundTripMs,
          memoryBytes: out.memoryBytes,
          svgBytes: next.svgBytes,
          responsiveness,
          ready: scheduler.lastReady,
          // Main-thread job handling (C9): the preview's commit into its session, the trace
          // job's post (source copy), and with the SVG toggle the SVG job's snapshot and post.
          handling: {
            ...handling,
            tracePostMs: out.timings.postMs,
            svgSnapshotMs: svgOut?.timings.snapshotMs ?? null,
            svgPostMs: svgOut?.timings.postMs ?? null,
          },
        };
      };

      const runDisplay = (
        out: Extract<PreviewOutcome, { status: "succeeded" }>,
        preview: DocumentSession,
        handling: Record<string, unknown>,
      ) => {
        const display = jobs.export("svg", null, {
          session: preview,
          kind: "preview",
          scope: "workbench",
        });
        if (!display.accepted) {
          stop();
          return fail(display.code, display.message);
        }
        previewJobs.current.add(display.jobId);
        void display.done.then((svgOut) => {
          previewJobs.current.delete(display.jobId);
          if (!isLatest()) return void stop();
          if (svgOut.status === "cancelled") {
            if (svgOut.reason === "preempted") return runDisplay(out, preview, handling);
            return void stop();
          }
          if (svgOut.status === "failed") {
            stop();
            return fail(svgOut.code, svgOut.message);
          }
          showResult(out, svgOut, preview, handling);
        });
      };

      const runTrace = () => {
        const sub = jobs.tracePreview(src.trace, request, "workbench");
        if (!sub.accepted) {
          stop();
          return fail(sub.code, sub.message);
        }
        previewJobs.current.add(sub.jobId);
        void sub.done.then((out) => {
          previewJobs.current.delete(sub.jobId);
          if (!isLatest()) return void stop();
          if (out.status === "cancelled") {
            if (out.reason === "preempted") return runTrace();
            return void stop();
          }
          if (out.status === "failed") {
            stop();
            return fail(out.code, out.message);
          }
          let preview: DocumentSession;
          const tCommit = performance.now();
          try {
            preview = previewSession(src, request, out.result);
          } catch (e) {
            stop();
            const code = (e as { code?: unknown }).code;
            return fail(typeof code === "string" ? code : "invalid_result", String(e));
          }
          const handling = {
            previewCommitMs: performance.now() - tCommit,
            previewStoreCommit: preview.store.lastCommitTiming,
          };
          // The canvas renders the preview's vector geometry directly; the SVG job runs only
          // for the P0 comparison toggle.
          if (svgPreview) runDisplay(out, preview, handling);
          else showResult(out, null, preview, handling);
        });
      };
      runTrace();
    },
    [jobs, scheduler, maxPixels, fail, svgPreview],
  );

  // Re-trace (debounced) whenever the source or settings change.
  useEffect(() => {
    if (!source) return;
    const t = setTimeout(() => trace(source, settings), 200);
    return () => clearTimeout(t);
  }, [source, settings, trace]);

  const cancel = useCallback(() => {
    const t = performance.now();
    if (cancelPreviews()) {
      const ackMs = performance.now() - t;
      debug.current.cancelAckMs = ackMs;
      setStatus({ kind: "cancelled", ackMs });
    }
  }, [cancelPreviews]);

  const downloadSvg = useCallback(async () => {
    if (!result) return;
    let bytes: Uint8Array;
    if (result.svg !== null) bytes = new TextEncoder().encode(result.svg);
    else {
      // An explicit engine export of the displayed preview, frozen now (never the canvas).
      const sub = jobs.export("svg", null, { session: result.preview });
      if (!sub.accepted) return fail(sub.code, sub.message);
      const out = await sub.done;
      if (out.status === "cancelled") return;
      if (out.status === "failed") return fail(out.code, out.message);
      bytes = out.bytes;
      debug.current.lastSvg = { bytes: out.bytes.byteLength, ms: out.timings.exportMs };
    }
    downloadBlob(
      new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/svg+xml" }),
      `vectra-${result.metrics.mode}.svg`,
    );
  }, [jobs, result, fail]);

  const downloadPdf = useCallback(
    async (options: PdfOptions) => {
      if (!result) return;
      // An explicit export of the displayed preview, frozen now.
      const sub = jobs.export("pdf", options, { session: result.preview });
      if (!sub.accepted) return fail(sub.code, sub.message);
      const out = await sub.done;
      if (out.status === "cancelled") return;
      if (out.status === "failed") return fail(out.code, out.message);
      downloadBlob(
        new Blob([out.bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
        `vectra-${result.metrics.mode}.pdf`,
      );
      setPdf({ bytes: out.bytes.byteLength, ms: out.timings.exportMs, options });
      debug.current.lastPdf = { bytes: out.bytes.byteLength, ms: out.timings.exportMs };
    },
    [jobs, result, fail],
  );

  /** Called when the result <img> has loaded: measures decode + first paint of the SVG preview. */
  const onPreviewLoaded = useCallback((img: HTMLImageElement) => {
    const stopProbe = previewProbe.current;
    previewProbe.current = null;
    void img.decode().then(() =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const now = performance.now();
          const last = debug.current.last as Record<string, unknown> | undefined;
          if (!last) return;
          last.previewMs = now - resultAt.current;
          last.importToVisibleMs = now - importAt.current;
          last.previewResponsiveness = stopProbe?.() ?? null;
          debug.current.previews = ((debug.current.previews as number | undefined) ?? 0) + 1;
        }),
      ),
    );
  }, []);

  const select = useCallback((ids: readonly NodeId[], mode: "replace" | "toggle") => {
    setSelection((prev) =>
      mode === "replace"
        ? ids
        : ids.reduce<readonly NodeId[]>(
            (acc, id) => (acc.includes(id) ? acc.filter((x) => x !== id) : [...acc, id]),
            prev,
          ),
    );
  }, []);

  /** Canvas states: the first exact frame of a new preview gives the preview metrics (C9). */
  const onCanvasState = useCallback((s: CanvasHostState) => {
    setCanvasState(s);
    debug.current.canvasState = s;
    if (s.kind !== "ready" || !awaitingFrame.current) return;
    awaitingFrame.current = false;
    const stopProbe = previewProbe.current;
    previewProbe.current = null;
    const last = debug.current.last as Record<string, unknown> | undefined;
    if (!last) return;
    const now = performance.now();
    last.previewMs = now - resultAt.current;
    last.importToVisibleMs = now - importAt.current;
    last.previewResponsiveness = stopProbe?.() ?? null;
    last.renderer = s.host;
    debug.current.previews = ((debug.current.previews as number | undefined) ?? 0) + 1;
  }, []);

  const onCanvasHost = useCallback(
    (h: DocumentRenderHost | null) => {
      canvasHost.current = h;
      debug.current.canvas = h && {
        diag: () => ({
          ...h.diag,
          client: { ...h.client.diag },
          host: h.client.host,
          state: h.state,
          camera: h.camera,
          renderRevision: h.renderRevision,
          documentRevision: h.documentRevision,
        }),
        fit: () => h.fitToView(),
        setView: (scale: number, tx: number, ty: number) => h.setView({ scale, tx, ty }),
        zoomBy: (f: number) => h.zoomBy(f),
        panBy: (dx: number, dy: number) => h.panBy(dx, dy),
        gesture: (phase: "start" | "end") => h.gesture(phase),
        hitAt: (x: number, y: number) => h.hitAt(x, y),
        hitDocument: (x: number, y: number) => h.hitDocument(x, y),
        select: (ids: NodeId[]) => setSelection(ids),
        selection: () => selectionRef.current,
        ...(debugMode
          ? {
              crash: () => h.client.crashWorker(),
              /** Shows a .vectra container (base64) instead of the preview. */
              showContainer: async (b64: string) => {
                const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
                const session = await loadContainer(bytes, {});
                setShown(session);
                setSelection([]);
                return session.getSnapshot().revision;
              },
              edit: (command: unknown) =>
                (shownRef.current ?? null)?.dispatch(
                  command as Parameters<DocumentSession["dispatch"]>[0],
                ),
              undo: () => shownRef.current?.undo(),
              redo: () => shownRef.current?.redo(),
            }
          : {}),
      };
    },
    [debugMode],
  );

  // Build skew is fatal for this tab: it is shown until the user reloads (RFC §15.3).
  const shownStatus: Status = buildMismatch
    ? {
        kind: "error",
        code: "build_mismatch",
        message: `This tab and its processing engine come from different versions of Vectra. Save your work, then reload the page. (${buildMismatch})`,
      }
    : status;

  return {
    onPreviewLoaded,
    offlineReady,
    offlineMismatch,
    updateWaiting,
    source,
    settings,
    setSettings,
    maxPixels,
    setMaxPixels,
    status: shownStatus,
    svgPreview,
    forceMainThread,
    selection,
    select,
    canvasState,
    onCanvasState,
    onCanvasHost,
    displaySession: shown ?? result?.preview ?? null,
    result,
    pdf,
    loadFile,
    cancel,
    downloadSvg,
    downloadPdf,
  };
}
