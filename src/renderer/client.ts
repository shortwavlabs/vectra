// Main-thread side of the renderer (C5 r2, R02): starts the render worker, checks its handshake,
// binds a generation, transfers a fresh canvas, forwards snapshots and camera changes, rejects
// stale frames, and recovers from a crash by recreating the worker on a NEW canvas (a canvas
// whose control was transferred cannot be reused) and asking the host to replay the current
// snapshot with every chunk. Where a worker host is unavailable it uses the same renderer on the
// main thread: a disclosed fallback, never a second renderer.
import { RENDER_IDENTITY } from "./build-info.ts";
import { CanvasRenderer } from "./core.ts";
import type {
  DragClip,
  FrameInfo,
  RenderIdentity,
  RenderRequest,
  RenderResponse,
  Surface,
} from "./protocol.ts";
import type { Affine, Camera, RenderPacket, RenderSnapshot } from "./snapshot.ts";

export type HostMode = "worker" | "main-thread";

export type ClientState =
  | { kind: "starting" }
  | { kind: "ready"; host: HostMode; reason?: string }
  | { kind: "recovering"; reason: string }
  | { kind: "error"; code: string; message: string };

export interface RenderClientOptions {
  container: HTMLElement;
  surface: Surface;
  createWorker(): Worker;
  /** Use the main-thread renderer (engineering toggle; also the automatic fallback). */
  forceMainThread?: boolean;
  startupTimeoutMs?: number;
  onFrame(frame: FrameInfo & { host: HostMode }): void;
  onState(state: ClientState): void;
  /** After every (re)start the renderer holds nothing: send a full snapshot with all chunks. */
  onNeedReplay(): void;
}

const mismatch = (want: RenderIdentity, got: RenderIdentity): string | null => {
  for (const k of ["protocolVersion", "buildId", "packetVersion"] as const)
    if (want[k] !== got[k]) return `${k}: page ${String(want[k])}, render worker ${String(got[k])}`;
  return null;
};

export class RenderClient {
  /** Chunks the current renderer holds (the host computes copies and releases from it). */
  readonly held = new Set<string>();
  readonly diag = {
    workersCreated: 0,
    startupFailures: 0,
    crashes: 0,
    recoveries: 0,
    staleFrames: 0,
    staleMessages: 0,
    buildMismatches: 0,
    canvasesCreated: 0,
    fallbackReason: null as string | null,
    lastRecoveryMs: null as number | null,
    /** What the render worker reports holding after its last snapshot. */
    workerHeld: null as { chunks: number; paths: number; bytes: number } | null,
    /** Drag layer caches held by the renderer (display-only memory, capped). */
    dragLayers: 0,
    dragLayerBytes: 0,
  };
  readonly #o: RenderClientOptions;
  #surface: Surface;
  #worker: Worker | null = null;
  #generation = 0;
  #canvas: HTMLCanvasElement | null = null;
  #retiring: HTMLCanvasElement | null = null;
  #main: CanvasRenderer | null = null;
  #lastRevision = 0;
  /** The last camera, replayed after every (re)start (messages before `init` are ignored). */
  #camera: Camera | null = null;
  #recoveringSince: number | null = null;
  #crashTimes: number[] = [];
  #disposed = false;

  constructor(o: RenderClientOptions) {
    this.#o = o;
    this.#surface = o.surface;
  }

  get host(): HostMode | null {
    return this.#main ? "main-thread" : this.#worker ? "worker" : null;
  }
  get canvas(): HTMLCanvasElement | null {
    return this.#canvas;
  }

  start(): void {
    this.#o.onState({ kind: "starting" });
    const supported =
      typeof Worker !== "undefined" &&
      typeof OffscreenCanvas !== "undefined" &&
      "transferControlToOffscreen" in HTMLCanvasElement.prototype;
    if (this.#o.forceMainThread) this.#fallback("main-thread renderer selected");
    else if (!supported)
      this.#fallback("this browser cannot draw in a worker (no OffscreenCanvas)");
    else this.#spawn();
  }

  send(snapshot: RenderSnapshot, packets: RenderPacket[], release: string[]): void {
    this.#lastRevision = snapshot.renderRevision;
    for (const id of release) this.held.delete(id);
    for (const p of packets) this.held.add(p.chunkId);
    if (this.#main) return this.#main.setSnapshot(snapshot, packets, release);
    if (!this.#worker) return;
    const transfer = packets.flatMap((p) => [
      p.verbs.buffer as ArrayBuffer,
      p.coords.buffer as ArrayBuffer,
      p.verbOffsets.buffer as ArrayBuffer,
      p.coordOffsets.buffer as ArrayBuffer,
    ]);
    this.#post(
      { type: "snapshot", generation: this.#generation, snapshot, packets, releaseChunks: release },
      transfer,
    );
  }

  selection(renderRevision: number, selection: number[]): void {
    this.#lastRevision = renderRevision;
    if (this.#main) return this.#main.setSelection(renderRevision, selection);
    this.#post({ type: "selection", generation: this.#generation, renderRevision, selection });
  }

  camera(camera: Camera): void {
    this.#camera = camera;
    if (this.#main) return this.#main.setCamera(camera);
    this.#post({ type: "camera", generation: this.#generation, camera });
  }

  gesture(phase: "start" | "end"): void {
    if (this.#main) return this.#main.gesture(phase);
    this.#post({ type: "gesture", generation: this.#generation, phase });
  }

  /** A transform drag (display only): forwarded to the renderer in either host. */
  dragStart(renderRevision: number, items: number[], clips: DragClip[]): void {
    if (this.#main) {
      this.#main.dragStart(renderRevision, items, clips);
      const st = this.#main.stats;
      this.diag.dragLayers = st.dragLayers;
      this.diag.dragLayerBytes = st.dragLayerBytes;
      return;
    }
    this.#post({
      type: "drag",
      generation: this.#generation,
      phase: "start",
      renderRevision,
      items,
      clips,
    });
  }
  dragMove(matrix: Affine): void {
    if (this.#main) return this.#main.dragMove(matrix);
    this.#post({ type: "drag", generation: this.#generation, phase: "move", matrix });
  }
  dragEnd(cancel: boolean): void {
    if (this.#main) return cancel ? this.#main.dragCancel() : this.#main.dragEnd();
    this.#post({ type: "drag", generation: this.#generation, phase: cancel ? "cancel" : "end" });
  }

  resize(surface: Surface): void {
    this.#surface = surface;
    if (this.#main) return this.#main.resize(surface);
    this.#post({ type: "resize", generation: this.#generation, surface });
  }

  /** Engineering fault injection (`?debug=1`). */
  crashWorker(): boolean {
    if (!this.#worker) return false;
    this.#post({ type: "debug-crash", generation: this.#generation });
    return true;
  }

  dispose(): void {
    this.#disposed = true;
    this.#worker?.terminate();
    this.#worker = null;
    this.#main?.release();
    this.#main = null;
    this.#canvas?.remove();
    this.#retiring?.remove();
    this.#canvas = null;
  }

  // --- internals ------------------------------------------------------------------------------
  #post(m: RenderRequest, transfer: Transferable[] = []): void {
    this.#worker?.postMessage(m, transfer);
  }

  /**
   * A fresh canvas element in the container (a canvas whose control was transferred cannot be
   * reused). It is inserted underneath the previous canvas, which keeps showing its last frame
   * until the new one has drawn. (The new canvas is never hidden: WebKit does not present a
   * worker canvas whose placeholder was hidden when the frame was committed.)
   */
  #newCanvas(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    if (this.#canvas) {
      this.#retiring?.remove();
      this.#retiring = this.#canvas;
      this.#retiring.dataset.testid = "vector-canvas-retiring";
    }
    c.dataset.testid = "vector-canvas";
    this.#o.container.prepend(c); // earlier in the DOM: painted below the retiring canvas
    this.#canvas = c;
    this.diag.canvasesCreated++;
    return c;
  }

  #presented(): void {
    if (!this.#retiring) return;
    this.#retiring.remove();
    this.#retiring = null;
  }

  #spawn(): void {
    if (this.#disposed) return;
    const gen = ++this.#generation;
    let ready = false;
    let worker: Worker;
    try {
      worker = this.#o.createWorker();
    } catch (e) {
      this.#startupFailed(String(e));
      return;
    }
    this.diag.workersCreated++;
    this.#worker = worker;
    const timer = setTimeout(() => {
      if (!ready && this.#worker === worker)
        this.#startupFailed("the render worker did not report ready in time");
    }, this.#o.startupTimeoutMs ?? 10_000);
    worker.onmessage = (e: MessageEvent<RenderResponse>) => {
      if (this.#worker !== worker) return void this.diag.staleMessages++;
      const m = e.data;
      if (m.type === "ready") {
        clearTimeout(timer);
        const skew = mismatch(RENDER_IDENTITY, m);
        if (skew) {
          this.diag.buildMismatches++;
          worker.terminate();
          this.#worker = null;
          this.#o.onState({
            kind: "error",
            code: "build_mismatch",
            message: `The canvas and its render worker come from different versions of Vectra. Save your work, then reload the page. (${skew})`,
          });
          return;
        }
        ready = true;
        const canvas = this.#newCanvas();
        const offscreen = canvas.transferControlToOffscreen();
        this.held.clear();
        this.#post({ type: "init", generation: gen, canvas: offscreen, surface: this.#surface }, [
          offscreen,
        ]);
        if (this.#camera) this.#post({ type: "camera", generation: gen, camera: this.#camera });
        this.#o.onState({ kind: "ready", host: "worker" });
        this.#o.onNeedReplay();
        return;
      }
      if (m.generation !== gen) return void this.diag.staleMessages++;
      if (m.type === "frame") {
        if (m.renderRevision < this.#lastRevision) return void this.diag.staleFrames++;
        if (m.kind === "exact" && this.#recoveringSince !== null) {
          this.diag.lastRecoveryMs = performance.now() - this.#recoveringSince;
          this.#recoveringSince = null;
        }
        this.#presented();
        this.#o.onFrame({ ...m, host: "worker" });
      } else if (m.type === "stats") {
        this.diag.workerHeld = { chunks: m.chunks, paths: m.paths, bytes: m.bytes };
        this.diag.dragLayers = m.dragLayers ?? 0;
        this.diag.dragLayerBytes = m.dragLayerBytes ?? 0;
      } else if (m.type === "error") {
        if (m.code === "no_2d_context")
          this.#fallback("the render worker has no 2D canvas context");
        else if (m.fatal) this.#crash(m.message);
      }
    };
    worker.onerror = (e) => {
      e.preventDefault();
      if (this.#worker !== worker) return;
      clearTimeout(timer);
      if (!ready) this.#startupFailed(e.message || "render worker failed to start");
      else this.#crash(e.message || "render worker crashed");
    };
  }

  #startupFailed(reason: string): void {
    this.diag.startupFailures++;
    this.#worker?.terminate();
    this.#worker = null;
    if (this.diag.startupFailures >= 2)
      this.#fallback(`the render worker could not start (${reason})`);
    else this.#spawn();
  }

  #crash(reason: string): void {
    this.diag.crashes++;
    this.#worker?.terminate();
    this.#worker = null;
    const now = performance.now();
    this.#crashTimes = [...this.#crashTimes.filter((t) => now - t < 30_000), now];
    if (this.#crashTimes.length > 3)
      return this.#fallback(`the render worker crashed repeatedly (${reason})`);
    this.diag.recoveries++;
    this.#recoveringSince ??= now;
    // The last frame stays visible until the replacement canvas is inserted with a new frame.
    this.#o.onState({ kind: "recovering", reason });
    this.#spawn();
  }

  #fallback(reason: string): void {
    this.diag.fallbackReason = reason;
    this.#worker?.terminate();
    this.#worker = null;
    const canvas = this.#newCanvas();
    try {
      this.#main = new CanvasRenderer(
        canvas,
        this.#surface,
        {
          frame: (f) => {
            if (f.kind === "exact" && this.#recoveringSince !== null) {
              this.diag.lastRecoveryMs = performance.now() - this.#recoveringSince;
              this.#recoveringSince = null;
            }
            this.#presented();
            this.#o.onFrame({ ...f, host: "main-thread" });
          },
          schedule: (cb) => setTimeout(cb, 0),
          now: () => performance.now(),
          createCanvas: (w, h) =>
            typeof OffscreenCanvas !== "undefined"
              ? new OffscreenCanvas(w, h)
              : Object.assign(document.createElement("canvas"), { width: w, height: h }),
        },
        { sliceMs: 8 },
      );
    } catch (e) {
      this.#o.onState({ kind: "error", code: "no_2d_context", message: String(e) });
      return;
    }
    this.held.clear();
    if (this.#camera) this.#main.setCamera(this.#camera);
    this.#o.onState({ kind: "ready", host: "main-thread", reason });
    this.#o.onNeedReplay();
  }
}
