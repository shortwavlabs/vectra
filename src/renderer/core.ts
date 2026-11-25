// Retained Canvas 2D renderer (R02 decision record, C8). The same code runs in the render
// worker (OffscreenCanvas) and in the disclosed main-thread fallback.
//
// - Path2D objects are built linearly from SVG path data, lazily, in paint order, and kept per
//   (chunk, path) until the chunk is released.
// - Exact frames are progressive: items are drawn in paint order in time slices, so the canvas
//   shows a growing prefix of the exact frame (reported as `interaction`, incomplete) until the
//   exact frame completes (`exact`). A newer snapshot, camera or size abandons the old frame.
// - During a camera gesture the last exact frame (without the selection) is blitted from a
//   display-only cache, then the exact frame is redrawn when the gesture ends. The cache is never
//   used for anything but display; hit testing, editing and export use vector data.
import type { FrameInfo, Surface } from "./protocol.ts";
import { pathBounds, pathData } from "./path-data.ts";
import type { Affine, Camera, RenderPacket, RenderSnapshot } from "./snapshot.ts";

type Canvas = OffscreenCanvas | HTMLCanvasElement;
type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export interface RendererHooks {
  frame(info: FrameInfo): void;
  /** Runs `cb` in a later task (the canvas presents between tasks). */
  schedule(cb: () => void): void;
  now(): number;
  /** Creates the display-cache surface. */
  createCanvas(width: number, height: number): Canvas;
}

interface Held {
  readonly packet: RenderPacket;
  readonly bounds: Float64Array;
  readonly paths: (Path2D | undefined)[];
}

/** Defaults when the surface names no selection colours (the design system's lime and ink). */
export const SELECTION_COLOR = "#b9e87b";
export const HALO_COLOR = "#191a1c";

const css = (rgba: number) =>
  `rgba(${rgba >>> 24},${(rgba >>> 16) & 255},${(rgba >>> 8) & 255},${(rgba & 255) / 255})`;

/** Device transform: device px = D × document. */
const device = (c: Camera, dpr: number): Affine => [
  dpr * c.scale,
  0,
  0,
  dpr * c.scale,
  dpr * c.tx,
  dpr * c.ty,
];
const mul = (m: Affine, n: Affine): Affine => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

export class CanvasRenderer {
  readonly #canvas: Canvas;
  readonly #ctx: Ctx;
  readonly #hooks: RendererHooks;
  readonly #sliceMs: number;
  #surface: Surface;
  #camera: Camera = { scale: 1, tx: 0, ty: 0 };
  #snapshot: RenderSnapshot | null = null;
  readonly #held = new Map<string, Held>();
  #cache: Canvas | null = null;
  #cacheCamera: Camera | null = null;
  #cacheRevision = -1;
  #gesture = false;
  #token = 0;
  #built = 0;
  #buildMs = 0;

  constructor(
    canvas: Canvas,
    surface: Surface,
    hooks: RendererHooks,
    o: { sliceMs?: number } = {},
  ) {
    const ctx = canvas.getContext("2d", { alpha: false }) as Ctx | null;
    if (!ctx) throw new Error("no_2d_context");
    this.#canvas = canvas;
    this.#ctx = ctx;
    this.#hooks = hooks;
    this.#sliceMs = o.sliceMs ?? 12;
    this.#surface = surface;
    this.#applySize();
  }

  get stats() {
    let paths = 0;
    let bytes = 0;
    for (const h of this.#held.values()) {
      paths += h.packet.verbOffsets.length - 1;
      bytes +=
        h.packet.verbs.byteLength +
        h.packet.coords.byteLength +
        h.packet.verbOffsets.byteLength +
        h.packet.coordOffsets.byteLength +
        h.bounds.byteLength;
    }
    return { chunks: this.#held.size, paths, bytes, built: this.#built };
  }

  resize(surface: Surface): void {
    this.#surface = surface;
    this.#applySize();
    this.#invalidateCache();
    this.#drawExact();
  }

  setSnapshot(
    snapshot: RenderSnapshot,
    packets: readonly RenderPacket[],
    release: readonly string[],
  ): void {
    for (const id of release) this.#held.delete(id);
    for (const p of packets)
      this.#held.set(p.chunkId, { packet: p, bounds: pathBounds(p), paths: [] });
    this.#snapshot = snapshot;
    this.#invalidateCache();
    this.#drawExact();
  }

  setSelection(renderRevision: number, selection: readonly number[]): void {
    if (!this.#snapshot) return;
    this.#snapshot = { ...this.#snapshot, renderRevision, selection };
    if (this.#cache && this.#cacheRevision >= 0) {
      // The cache holds the frame without the selection: re-present it with the new outline.
      this.#cacheRevision = renderRevision;
      this.#blitCache(true);
    } else this.#drawExact();
  }

  setCamera(camera: Camera): void {
    this.#camera = camera;
    if (this.#gesture && this.#cache) this.#blitCache(false);
    else this.#drawExact();
  }

  gesture(phase: "start" | "end"): void {
    this.#gesture = phase === "start";
    if (!this.#gesture) this.#drawExact();
  }

  release(): void {
    this.#token++;
    this.#held.clear();
    this.#snapshot = null;
    this.#cache = null;
  }

  // --- drawing --------------------------------------------------------------------------------
  #applySize(): void {
    const { cssWidth, cssHeight, dpr } = this.#surface;
    this.#canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.#canvas.height = Math.max(1, Math.round(cssHeight * dpr));
  }

  #invalidateCache(): void {
    this.#cacheRevision = -1;
  }

  #path(chunkId: string, i: number): Path2D | null {
    const h = this.#held.get(chunkId);
    if (!h) return null;
    let p = h.paths[i];
    if (!p) {
      const t = this.#hooks.now();
      p = new Path2D(pathData(h.packet, i));
      this.#buildMs += this.#hooks.now() - t;
      h.paths[i] = p;
      this.#built++;
    }
    return p;
  }

  #background(ctx: Ctx, D: Affine): void {
    const { workspace, paper } = this.#surface;
    const snap = this.#snapshot;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = workspace;
    ctx.fillRect(0, 0, this.#canvas.width, this.#canvas.height);
    if (!snap) return;
    ctx.setTransform(D[0], D[1], D[2], D[3], D[4], D[5]);
    const bg = snap.artboard.background;
    ctx.fillStyle = bg === null ? paper : css(bg);
    ctx.fillRect(0, 0, snap.artboard.width, snap.artboard.height);
  }

  /** Whether item `k` may be visible in the viewport (bounds of its control points). */
  #visible(k: number, D: Affine): boolean {
    const it = this.#snapshot!.drawList[k]!;
    const h = this.#held.get(it.chunkId);
    if (!h) return false;
    const b = h.bounds;
    const j = 4 * it.pathIndex;
    const M = mul(D, it.transform);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of [
      [b[j]!, b[j + 1]!],
      [b[j + 2]!, b[j + 1]!],
      [b[j]!, b[j + 3]!],
      [b[j + 2]!, b[j + 3]!],
    ] as const) {
      const X = M[0] * x + M[2] * y + M[4];
      const Y = M[1] * x + M[3] * y + M[5];
      x0 = Math.min(x0, X);
      x1 = Math.max(x1, X);
      y0 = Math.min(y0, Y);
      y1 = Math.max(y1, Y);
    }
    const pad = 2 + (it.stroke ? it.stroke.width * Math.hypot(M[0], M[1]) : 0);
    return (
      x1 >= -pad && y1 >= -pad && x0 <= this.#canvas.width + pad && y0 <= this.#canvas.height + pad
    );
  }

  #drawItem(ctx: Ctx, k: number, D: Affine): boolean {
    const it = this.#snapshot!.drawList[k]!;
    if (!this.#visible(k, D)) return false;
    const path = this.#path(it.chunkId, it.pathIndex);
    if (!path) return false;
    const M = mul(D, it.transform);
    ctx.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
    if (it.fill !== null) {
      ctx.fillStyle = css(it.fill);
      ctx.fill(path, it.evenOdd ? "evenodd" : "nonzero");
    }
    if (it.stroke) {
      ctx.strokeStyle = css(it.stroke.color);
      ctx.lineWidth = it.stroke.width;
      ctx.stroke(path);
    }
    return true;
  }

  #drawSelection(ctx: Ctx, D: Affine): void {
    const snap = this.#snapshot;
    if (!snap || snap.selection.length === 0) return;
    ctx.save();
    // A dark halo under the lime outline: lime alone is near-invisible on the ivory paper.
    for (const [color, px] of [
      [this.#surface.halo ?? HALO_COLOR, 3.5],
      [this.#surface.selection ?? SELECTION_COLOR, 1.5],
    ] as const) {
      ctx.strokeStyle = color;
      for (const k of snap.selection) {
        const it = snap.drawList[k];
        if (!it) continue;
        const path = this.#path(it.chunkId, it.pathIndex);
        if (!path) continue;
        const M = mul(D, it.transform);
        ctx.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
        const scale = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])) || 1;
        ctx.lineWidth = (px * this.#surface.dpr) / scale;
        ctx.stroke(path);
      }
    }
    ctx.restore();
  }

  #drawExact(): void {
    const token = ++this.#token;
    const snap = this.#snapshot;
    const ctx = this.#ctx;
    const D = device(this.#camera, this.#surface.dpr);
    const t0 = this.#hooks.now();
    const builtAt = this.#built;
    const buildAt = this.#buildMs;
    this.#background(ctx, D);
    if (!snap) {
      this.#hooks.frame({
        camera: this.#camera,
        renderRevision: 0,
        kind: "exact",
        ms: this.#hooks.now() - t0,
        buildMs: 0,
        drawn: 0,
        built: 0,
        complete: true,
      });
      return;
    }
    const items = snap.drawList;
    let k = 0;
    let drawn = 0;
    let busy = 0;
    const step = () => {
      if (token !== this.#token) return; // superseded by a newer snapshot, camera or size
      const s0 = this.#hooks.now();
      let run = -1;
      while (k < items.length) {
        const it = items[k]!;
        if (it.groupRun !== run) {
          if (run >= 0) ctx.restore();
          run = it.groupRun;
          ctx.save();
          const clip = snap.runs[run]?.clip;
          if (clip) {
            ctx.setTransform(D[0], D[1], D[2], D[3], D[4], D[5]);
            ctx.beginPath();
            ctx.rect(clip.x, clip.y, clip.w, clip.h);
            ctx.clip();
          }
        }
        if (this.#drawItem(ctx, k, D)) drawn++;
        k++;
        if (this.#hooks.now() - s0 >= this.#sliceMs) break;
      }
      if (run >= 0) ctx.restore();
      busy += this.#hooks.now() - s0;
      if (k < items.length) {
        this.#hooks.frame({
          camera: this.#camera,
          renderRevision: snap.renderRevision,
          kind: "interaction",
          ms: busy,
          buildMs: this.#buildMs - buildAt,
          drawn,
          built: this.#built - builtAt,
          complete: false,
        });
        this.#hooks.schedule(step);
        return;
      }
      this.#snapshotCache();
      this.#drawSelection(ctx, D);
      this.#hooks.frame({
        camera: this.#camera,
        renderRevision: snap.renderRevision,
        kind: "exact",
        ms: busy,
        buildMs: this.#buildMs - buildAt,
        drawn,
        built: this.#built - builtAt,
        complete: true,
      });
    };
    step();
  }

  #snapshotCache(): void {
    const { width, height } = this.#canvas;
    if (!this.#cache || this.#cache.width !== width || this.#cache.height !== height)
      this.#cache = this.#hooks.createCanvas(width, height);
    const c = this.#cache.getContext("2d") as Ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this.#canvas as CanvasImageSource, 0, 0);
    this.#cacheCamera = this.#camera;
    this.#cacheRevision = this.#snapshot?.renderRevision ?? 0;
  }

  /** A gesture frame: the cached exact frame under the camera change, plus the selection. */
  #blitCache(exactCamera: boolean): void {
    const ctx = this.#ctx;
    const t0 = this.#hooks.now();
    const c0 = this.#cacheCamera!;
    const c1 = this.#camera;
    const dpr = this.#surface.dpr;
    const k = c1.scale / c0.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.#surface.workspace;
    ctx.fillRect(0, 0, this.#canvas.width, this.#canvas.height);
    ctx.setTransform(k, 0, 0, k, dpr * (c1.tx - k * c0.tx), dpr * (c1.ty - k * c0.ty));
    ctx.drawImage(this.#cache as CanvasImageSource, 0, 0);
    this.#drawSelection(ctx, device(c1, dpr));
    this.#hooks.frame({
      camera: this.#camera,
      renderRevision: this.#snapshot?.renderRevision ?? 0,
      kind: exactCamera && k === 1 && c1.tx === c0.tx && c1.ty === c0.ty ? "exact" : "interaction",
      ms: this.#hooks.now() - t0,
      buildMs: 0,
      drawn: 0,
      built: 0,
      complete: true,
    });
  }
}
