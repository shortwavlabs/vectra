import { useCallback, useEffect, useRef, useState } from "react";
import { downloadBlob } from "../export/download.ts";
import { DEFAULT_SETTINGS, makeRequest } from "../presets/defaults.ts";
import {
  CancelledError,
  JobError,
  type TraceOutcome,
  VectorizerClient,
  type WorkerLike,
} from "../vectorization/client.ts";
import {
  DEFAULT_MAX_PIXELS,
  type DecodedImage,
  decodeImage,
  IntakeError,
} from "../vectorization/intake.ts";
import type { PdfOptions, Settings, TraceRequest } from "../vectorization/types.ts";
import { type ResponsivenessSample, startProbe } from "./responsiveness.ts";

export interface Source extends DecodedImage {
  revision: number;
  name: string;
  bytes: number;
  url: string;
}

export interface Result extends TraceOutcome {
  svgUrl: string;
  svgBytes: number;
  responsiveness: ResponsivenessSample;
  request: TraceRequest;
}

export type Status =
  | { kind: "idle" }
  | { kind: "decoding" }
  | { kind: "processing"; since: number }
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
    /** Engineering instrumentation for P0 browser tests. Contains metrics only, never artwork. */
    __vectra?: Record<string, unknown>;
  }
}

const createWorker = () =>
  new Worker(new URL("../workers/vectorize.worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as WorkerLike;

export function useWorkbench() {
  const [client] = useState(() => new VectorizerClient({ createWorker }));
  const [source, setSource] = useState<Source | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS.bw);
  const [maxPixels, setMaxPixels] = useState(DEFAULT_MAX_PIXELS);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [result, setResult] = useState<Result | null>(null);
  const [pdf, setPdf] = useState<PdfInfo | null>(null);
  const revision = useRef(0);
  const debug = useRef<Record<string, unknown>>({ stats: client.stats, results: 0 });

  useEffect(() => {
    window.__vectra = debug.current;
    return () => client.dispose();
  }, [client]);

  const loadFile = useCallback(
    async (file: File) => {
      client.cancel();
      const rev = ++revision.current;
      setStatus({ kind: "decoding" });
      setResult((prev) => {
        if (prev) URL.revokeObjectURL(prev.svgUrl);
        return null;
      });
      setPdf(null);
      try {
        const decoded = await decodeImage(file, maxPixels);
        if (rev !== revision.current) return; // a newer file was chosen meanwhile
        setSource((prev) => {
          if (prev) URL.revokeObjectURL(prev.url);
          return {
            ...decoded,
            revision: rev,
            name: file.name,
            bytes: file.size,
            url: URL.createObjectURL(file),
          };
        });
        debug.current.decodeMs = decoded.decodeMs;
      } catch (e) {
        if (rev !== revision.current) return;
        const code = e instanceof IntakeError ? e.code : "decode_failed";
        setStatus({ kind: "error", code, message: e instanceof Error ? e.message : String(e) });
      }
    },
    [client, maxPixels],
  );

  const trace = useCallback(
    (src: Source, s: Settings) => {
      const stop = startProbe();
      setStatus({ kind: "processing", since: performance.now() });
      const request = makeRequest(s, maxPixels);
      // Copy: the buffer is transferred (detached) and the source stays available for re-tracing.
      const rgba = src.rgba.slice().buffer;
      client
        .trace({ rgba, width: src.width, height: src.height, revision: src.revision }, request)
        .then(
          (out) => {
            const responsiveness = stop();
            if (out.revision !== revision.current) return;
            const blob = new Blob([out.svg], { type: "image/svg+xml" });
            const next: Result = {
              ...out,
              svgUrl: URL.createObjectURL(blob),
              svgBytes: blob.size,
              responsiveness,
              request,
            };
            setResult((prev) => {
              if (prev) URL.revokeObjectURL(prev.svgUrl);
              return next;
            });
            setPdf(null);
            setStatus({ kind: "done" });
            debug.current.results = (debug.current.results as number) + 1;
            debug.current.lastRequest = request;
            debug.current.last = {
              jobId: out.jobId,
              metrics: out.metrics,
              timings: out.timings,
              roundTripMs: out.roundTripMs,
              memoryBytes: out.memoryBytes,
              svgBytes: blob.size,
              responsiveness,
              ready: client.lastReady,
            };
          },
          (e: unknown) => {
            stop();
            if (e instanceof CancelledError) return;
            setStatus({
              kind: "error",
              code: e instanceof JobError ? e.code : "error",
              message: e instanceof Error ? e.message : String(e),
            });
          },
        );
    },
    [client, maxPixels],
  );

  // Re-trace (debounced) whenever the source or settings change.
  useEffect(() => {
    if (!source) return;
    const t = setTimeout(() => trace(source, settings), 200);
    return () => clearTimeout(t);
  }, [source, settings, trace]);

  const cancel = useCallback(() => {
    const t = performance.now();
    if (client.cancel()) {
      const ackMs = performance.now() - t;
      debug.current.cancelAckMs = ackMs;
      setStatus({ kind: "cancelled", ackMs });
    }
  }, [client]);

  const downloadSvg = useCallback(() => {
    if (result)
      downloadBlob(
        new Blob([result.svg], { type: "image/svg+xml" }),
        `vectra-${result.metrics.mode}.svg`,
      );
  }, [result]);

  const downloadPdf = useCallback(
    async (options: PdfOptions) => {
      if (!result) return;
      try {
        const out = await client.exportPdf(result.sceneJson, options);
        downloadBlob(
          new Blob([out.bytes], { type: "application/pdf" }),
          `vectra-${result.metrics.mode}.pdf`,
        );
        setPdf({ bytes: out.bytes.byteLength, ms: out.ms, options });
        debug.current.lastPdf = { bytes: out.bytes.byteLength, ms: out.ms };
      } catch (e) {
        setStatus({
          kind: "error",
          code: e instanceof JobError ? e.code : "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [client, result],
  );

  return {
    source,
    settings,
    setSettings,
    maxPixels,
    setMaxPixels,
    status,
    result,
    pdf,
    loadFile,
    cancel,
    downloadSvg,
    downloadPdf,
  };
}
