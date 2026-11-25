// Render worker (C5 r2, R02): hosts the retained Canvas 2D renderer on an OffscreenCanvas.
// Posts `ready` with its build identity on load; nothing but `init` is accepted before it, and
// every message for another generation is ignored. It holds only render copies of packets and
// display caches: losing it loses nothing committed.
import { RENDER_IDENTITY } from "./build-info.ts";
import { CanvasRenderer } from "./core.ts";
import type { RenderRequest, RenderResponse } from "./protocol.ts";

interface WorkerScope {
  postMessage(message: RenderResponse): void;
  onmessage: ((event: MessageEvent<RenderRequest>) => void) | null;
}
const scope = self as unknown as WorkerScope;
const post = (m: RenderResponse) => scope.postMessage(m);

let generation = 0;
let renderer: CanvasRenderer | null = null;

post({ type: "ready", ...RENDER_IDENTITY, workerRaf: typeof requestAnimationFrame === "function" });

scope.onmessage = (event) => {
  const m = event.data;
  try {
    if (m.type === "init") {
      if (renderer) return; // one canvas per worker instance
      generation = m.generation;
      renderer = new CanvasRenderer(
        m.canvas,
        m.surface,
        {
          frame: (f) => post({ type: "frame", generation, ...f }),
          schedule: (cb) => setTimeout(cb, 0),
          now: () => performance.now(),
          createCanvas: (w, h) => new OffscreenCanvas(w, h),
        },
        { sliceMs: 16 },
      );
      return;
    }
    if (!renderer || m.generation !== generation) return; // stale or premature: dropped
    switch (m.type) {
      case "snapshot":
        renderer.setSnapshot(m.snapshot, m.packets, m.releaseChunks);
        post({ type: "stats", generation, ...renderer.stats });
        return;
      case "selection":
        renderer.setSelection(m.renderRevision, m.selection);
        return;
      case "camera":
        renderer.setCamera(m.camera);
        return;
      case "gesture":
        renderer.gesture(m.phase);
        return;
      case "resize":
        renderer.resize(m.surface);
        return;
      case "drag":
        if (m.phase === "start") {
          renderer.dragStart(m.renderRevision, m.items, m.clips);
          post({ type: "stats", generation, ...renderer.stats });
        } else if (m.phase === "move") renderer.dragMove(m.matrix);
        else if (m.phase === "end") renderer.dragEnd();
        else renderer.dragCancel();
        return;
      case "debug-crash":
        setTimeout(() => {
          throw new Error("injected render-worker crash (debug)");
        });
        return;
      case "release":
        renderer.release();
        return;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    post({
      type: "error",
      generation,
      code: message === "no_2d_context" ? "no_2d_context" : "render_failed",
      message,
      fatal: true,
    });
  }
};
