// The renderer core's frame protocol, deterministically: a stub 2D context, a manual clock and a
// manual scheduler (no browser). Regression (found by the G-R1 perf spec in 3 engines): a
// selection arriving while an exact frame for a new camera is being drawn must not re-present a
// cache from the old camera, and the frame in progress must complete under the new revision;
// before the fix no exact frame of the current revision was ever produced ("rendering" forever).
import { describe, expect, test } from "vite-plus/test";
import { CanvasRenderer } from "./core.ts";
import type { FrameInfo, Surface } from "./protocol.ts";
import type { RenderPacket, RenderSnapshot } from "./snapshot.ts";

class StubPath {
  readonly d: string | undefined;
  constructor(d?: string) {
    this.d = d;
  }
}
(globalThis as unknown as { Path2D: unknown }).Path2D ??= StubPath;

function stubCanvas(width = 100, height = 100) {
  const ctx = new Proxy(
    {},
    { get: (_t, k) => (k === "canvas" ? undefined : () => undefined), set: () => true },
  );
  return { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
}

/** `n` unit squares in one chunk, spread over a 1000×1000 artboard. */
function scene(n: number): { snapshot: RenderSnapshot; packet: RenderPacket } {
  const verbs: number[] = [];
  const coords: number[] = [];
  const verbOffsets = [0];
  const coordOffsets = [0];
  for (let i = 0; i < n; i++) {
    const x = (i * 37) % 990;
    const y = (i * 53) % 990;
    verbs.push(0, 1, 1, 1, 3);
    coords.push(x, y, x + 5, y, x + 5, y + 5, x, y + 5);
    verbOffsets.push(verbs.length);
    coordOffsets.push(coords.length);
  }
  return {
    packet: {
      chunkId: "chk_1",
      verbs: Uint8Array.from(verbs),
      coords: Float64Array.from(coords),
      verbOffsets: Uint32Array.from(verbOffsets),
      coordOffsets: Uint32Array.from(coordOffsets),
    },
    snapshot: {
      renderRevision: 1,
      documentRevision: 1,
      artboard: { width: 1000, height: 1000, background: null },
      runs: [{ id: "r0", clip: null }],
      drawList: Array.from({ length: n }, (_, k) => ({
        chunkId: "chk_1",
        pathIndex: k,
        transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number],
        fill: 0x000000ff,
        evenOdd: false,
        groupRun: 0,
      })),
      selection: [],
    },
  };
}

function harness() {
  let clock = 0;
  const queue: (() => void)[] = [];
  const frames: FrameInfo[] = [];
  const surface: Surface = {
    cssWidth: 100,
    cssHeight: 100,
    dpr: 1,
    workspace: "#333",
    paper: "#fff",
  };
  const r = new CanvasRenderer(
    stubCanvas(),
    surface,
    {
      frame: (f) => frames.push(f),
      schedule: (cb) => queue.push(cb),
      now: () => (clock += 1), // every clock read advances 1 ms: slices end deterministically
      createCanvas: (w, h) => stubCanvas(w, h),
    },
    { sliceMs: 40 },
  );
  const runOne = () => queue.shift()?.();
  const runAll = () => {
    for (let i = 0; i < 10_000 && queue.length; i++) queue.shift()!();
  };
  return { r, frames, runOne, runAll };
}

describe("exact frames and selection revisions", () => {
  test("a selection during a new camera's exact frame: the frame completes under the new revision", () => {
    const h = harness();
    const { snapshot, packet } = scene(400);
    // An exact frame at the first camera completes (the cache now holds that camera's frame).
    h.r.setSnapshot(snapshot, [packet], []);
    h.runAll();
    expect(h.frames.at(-1)).toMatchObject({ kind: "exact", complete: true, renderRevision: 1 });
    // A new camera: a progressive exact frame starts and is still in progress.
    const camera = { scale: 0.1, tx: 3, ty: 4 };
    h.r.setCamera(camera);
    expect(h.frames.at(-1)).toMatchObject({ kind: "interaction", complete: false });
    // The selection changes mid-frame (revision 2).
    h.r.setSelection(2, [5]);
    h.runAll();
    const last = h.frames.at(-1)!;
    expect(last).toMatchObject({ kind: "exact", complete: true, renderRevision: 2 });
    expect(last.camera).toEqual(camera);
    // No frame presented the old camera's cache under the new revision.
    expect(h.frames.some((f) => f.renderRevision === 2 && f.camera.scale !== 0.1)).toBe(false);
  });

  test("a selection after the exact frame re-presents the cache at the same camera", () => {
    const h = harness();
    const { snapshot, packet } = scene(50);
    h.r.setSnapshot(snapshot, [packet], []);
    h.runAll();
    const n = h.frames.length;
    h.r.setSelection(2, [3]);
    expect(h.frames.length).toBe(n + 1); // a blit, no new progressive frame
    expect(h.frames.at(-1)).toMatchObject({ kind: "exact", complete: true, renderRevision: 2 });
  });
});
