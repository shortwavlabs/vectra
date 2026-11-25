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
import type { ClipRect, DragClip, FrameInfo, Surface } from "./protocol.ts";
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

/**
 * Drag layer caches are display-only memory, capped in total. Over the cap, or above
 * DRAG_MAX_LAYERS segments, a drag keeps only the static ranges below and above the selection and
 * redraws the moving range exactly on every frame: slower, never wrong.
 */
export const DRAG_LAYER_BUDGET = 192 * 1024 * 1024;
export const DRAG_MAX_LAYERS = 10;

interface DragLayer {
  readonly moving: boolean;
  /** Draw-list range [from, to). */
  readonly from: number;
  readonly to: number;
  /** A moving layer's clip owned outside the selection (applied, fixed, when compositing). */
  readonly fixed: ClipRect | null;
  /** Device-pixel origin and size of a moving layer (static layers cover the canvas). */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  canvas: Canvas | null;
}
interface DragState {
  readonly items: ReadonlySet<number>;
  readonly clips: ReadonlyMap<number, DragClip>;
  readonly first: number;
  readonly last: number;
  matrix: Affine;
  mode: "layers" | "live";
  layers: DragLayer[];
  bytes: number;
  /** Released: the last pose stays on screen until the next exact frame is complete. */
  ended: boolean;
}
const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];
const sameClip = (a: ClipRect | null, b: ClipRect | null) =>
  a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);
const invertAffine = (m: Affine): Affine => {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
};
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
  #drag: DragState | null = null;
  /** Off-screen target for exact frames drawn while a drag pose is held on screen. */
  #buffer: Canvas | null = null;

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
    return {
      chunks: this.#held.size,
      paths,
      bytes,
      built: this.#built,
      dragLayers: this.#drag?.layers.filter((l) => l.canvas).length ?? 0,
      dragLayerBytes: this.#drag?.bytes ?? 0,
    };
  }

  resize(surface: Surface): void {
    this.#surface = surface;
    this.#applySize();
    this.#invalidateCache();
    if (this.#drag && !this.#drag.ended) return this.#rebuildDrag();
    this.#drawExact(this.#drag !== null);
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
    // A drag pose on screen stays there until this snapshot's exact frame is complete. An
    // active drag's layers belong to the old snapshot: the host restarts it on this one.
    const holding = this.#drag !== null;
    if (this.#drag && !this.#drag.ended) this.#drag = null;
    this.#drawExact(holding);
  }

  setSelection(renderRevision: number, selection: readonly number[]): void {
    if (!this.#snapshot) return;
    this.#snapshot = { ...this.#snapshot, renderRevision, selection };
    // During a drag the pose is re-presented under the new revision (its frames would otherwise
    // be stale); a held pose waits for the next exact frame.
    if (this.#drag) {
      if (!this.#drag.ended) this.#composeDrag();
      return;
    }
    if (this.#cache && this.#cacheRevision >= 0) {
      // The cache holds the frame without the selection: re-present it with the new outline.
      this.#cacheRevision = renderRevision;
      this.#blitCache(true);
    } else this.#drawExact();
  }

  setCamera(camera: Camera): void {
    this.#camera = camera;
    if (this.#drag && !this.#drag.ended) return this.#rebuildDrag();
    if (this.#gesture && this.#cache) this.#blitCache(false);
    else this.#drawExact(this.#drag !== null);
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
    this.#drag = null;
    this.#buffer = null;
  }

  // --- drags (G-R1 layered caches, RFC §8.4) ------------------------------------------------
  /** Starts a drag of draw items `items` (of `renderRevision`), with their clips. */
  dragStart(renderRevision: number, items: readonly number[], clips: readonly DragClip[]): void {
    const snap = this.#snapshot;
    if (!snap || snap.renderRevision !== renderRevision || items.length === 0) {
      this.#drag = null;
      return;
    }
    const clipOf = new Map<number, DragClip>();
    items.forEach((k, i) => clipOf.set(k, clips[i] ?? { fixed: null, moving: null }));
    const sorted = [...items].sort((a, b) => a - b);
    this.#drag = {
      items: new Set(sorted),
      clips: clipOf,
      first: sorted[0]!,
      last: sorted.at(-1)!,
      matrix: IDENTITY,
      mode: "layers",
      layers: [],
      bytes: 0,
      ended: false,
    };
    this.#rebuildDrag();
  }

  /** Poses the moving items with a document-space affine (display only). */
  dragMove(matrix: Affine): void {
    const d = this.#drag;
    if (!d || d.ended) return;
    d.matrix = matrix;
    this.#composeDrag();
  }

  /** Released: the pose stays until the next snapshot's exact frame is complete. */
  dragEnd(): void {
    if (this.#drag) this.#drag.ended = true;
  }

  /** Cancelled: back to the exact frame of the unchanged snapshot. */
  dragCancel(): void {
    if (!this.#drag) return;
    this.#drag.ended = true;
    this.#drawExact(true);
  }

  #rebuildDrag(): void {
    const d = this.#drag!;
    const snap = this.#snapshot!;
    this.#token++; // abandon any progressive exact frame
    const n = snap.drawList.length;
    const { width: W, height: H } = this.#canvas;
    const D = device(this.#camera, this.#surface.dpr);
    const full = W * H * 4;
    const pieces: { moving: boolean; from: number; to: number; fixed: ClipRect | null }[] = [
      { moving: false, from: 0, to: d.first, fixed: null },
    ];
    for (let k = d.first; k <= d.last;) {
      const moving = d.items.has(k);
      const fixed = moving ? (d.clips.get(k)?.fixed ?? null) : null;
      let j = k + 1;
      while (
        j <= d.last &&
        d.items.has(j) === moving &&
        (!moving || sameClip(d.clips.get(j)?.fixed ?? null, fixed))
      )
        j++;
      pieces.push({ moving, from: k, to: j, fixed });
      k = j;
    }
    pieces.push({ moving: false, from: d.last + 1, to: n, fixed: null });
    let bytes = 0;
    let fits = pieces.length <= DRAG_MAX_LAYERS;
    const layers: DragLayer[] = pieces.map((p) => {
      if (!p.moving) {
        bytes += full;
        return { ...p, x: 0, y: 0, w: W, h: H, canvas: null };
      }
      const b = this.#movingBounds(p.from, p.to, D);
      if (!b) return { ...p, x: 0, y: 0, w: 0, h: 0, canvas: null };
      if (b.w > 8192 || b.h > 8192 || b.w * b.h > 4 * W * H) fits = false;
      bytes += b.w * b.h * 4;
      return { ...p, ...b, canvas: null };
    });
    if (!fits || bytes > DRAG_LAYER_BUDGET) {
      // Live: cache the static ranges below and above; redraw the moving range every frame.
      d.mode = "live";
      const pre = layers[0]!;
      const post = layers.at(-1)!;
      pre.canvas = this.#staticLayer(pre.from, pre.to, D, true);
      post.canvas = this.#staticLayer(post.from, post.to, D, false);
      d.layers = [pre, post];
      d.bytes = 2 * full;
    } else {
      d.mode = "layers";
      layers.forEach((l, i) => {
        if (l.moving) l.canvas = l.w > 0 ? this.#movingLayer(l, D) : null;
        else l.canvas = this.#staticLayer(l.from, l.to, D, i === 0);
      });
      d.layers = layers;
      d.bytes = bytes;
    }
    this.#composeDrag();
  }

  /** Device bounds of moving items [from, to) under their moving clips, padded for AA. */
  #movingBounds(from: number, to: number, D: Affine) {
    const snap = this.#snapshot!;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let k = from; k < to; k++) {
      const it = snap.drawList[k]!;
      const h = this.#held.get(it.chunkId);
      if (!h) continue;
      const b = h.bounds;
      const j = 4 * it.pathIndex;
      const M = mul(D, it.transform);
      const pad = 2 + (it.stroke ? it.stroke.width * Math.hypot(M[0], M[1]) : 0);
      let ix0 = Infinity;
      let iy0 = Infinity;
      let ix1 = -Infinity;
      let iy1 = -Infinity;
      for (const [x, y] of [
        [b[j]!, b[j + 1]!],
        [b[j + 2]!, b[j + 1]!],
        [b[j]!, b[j + 3]!],
        [b[j + 2]!, b[j + 3]!],
      ] as const) {
        const X = M[0] * x + M[2] * y + M[4];
        const Y = M[1] * x + M[3] * y + M[5];
        ix0 = Math.min(ix0, X - pad);
        iy0 = Math.min(iy0, Y - pad);
        ix1 = Math.max(ix1, X + pad);
        iy1 = Math.max(iy1, Y + pad);
      }
      const c = this.#drag!.clips.get(k)?.moving;
      if (c) {
        const cx0 = D[0] * c.x + D[4];
        const cy0 = D[3] * c.y + D[5];
        const cx1 = D[0] * (c.x + c.w) + D[4];
        const cy1 = D[3] * (c.y + c.h) + D[5];
        ix0 = Math.max(ix0, Math.min(cx0, cx1) - 1);
        iy0 = Math.max(iy0, Math.min(cy0, cy1) - 1);
        ix1 = Math.min(ix1, Math.max(cx0, cx1) + 1);
        iy1 = Math.min(iy1, Math.max(cy0, cy1) + 1);
        if (ix1 <= ix0 || iy1 <= iy0) continue;
      }
      x0 = Math.min(x0, ix0);
      y0 = Math.min(y0, iy0);
      x1 = Math.max(x1, ix1);
      y1 = Math.max(y1, iy1);
    }
    if (!(x1 > x0 && y1 > y0)) return null;
    const x = Math.floor(x0);
    const y = Math.floor(y0);
    return { x, y, w: Math.ceil(x1) - x, h: Math.ceil(y1) - y };
  }

  /** Items [from, to) drawn as in an exact frame (run clips), onto a transparent layer. */
  #staticLayer(from: number, to: number, D: Affine, background: boolean): Canvas {
    const { width, height } = this.#canvas;
    const c = this.#hooks.createCanvas(width, height);
    const ctx = c.getContext("2d") as Ctx;
    if (background) this.#background(ctx, D);
    this.#drawRange(ctx, from, to, D);
    return c;
  }

  /** Moving items [from, to), unposed, with their moving clips, onto a layer at its origin. */
  #movingLayer(l: DragLayer, D: Affine): Canvas {
    const c = this.#hooks.createCanvas(l.w, l.h);
    const ctx = c.getContext("2d") as Ctx;
    const T = mul([1, 0, 0, 1, -l.x, -l.y], D);
    for (let k = l.from; k < l.to; k++) this.#paintMoving(ctx, k, T, T);
    return c;
  }

  /** One moving item: its moving clip under `clipM`, the item under `M` (both device). */
  #paintMoving(ctx: Ctx, k: number, M: Affine, clipM: Affine): void {
    const it = this.#snapshot!.drawList[k]!;
    const path = this.#path(it.chunkId, it.pathIndex);
    if (!path) return;
    const c = this.#drag!.clips.get(k)?.moving;
    ctx.save();
    if (c) {
      ctx.setTransform(clipM[0], clipM[1], clipM[2], clipM[3], clipM[4], clipM[5]);
      ctx.beginPath();
      ctx.rect(c.x, c.y, c.w, c.h);
      ctx.clip();
    }
    const N = mul(M, it.transform);
    ctx.setTransform(N[0], N[1], N[2], N[3], N[4], N[5]);
    if (it.fill !== null) {
      ctx.fillStyle = css(it.fill);
      ctx.fill(path, it.evenOdd ? "evenodd" : "nonzero");
    }
    if (it.stroke) {
      ctx.strokeStyle = css(it.stroke.color);
      ctx.lineWidth = it.stroke.width;
      ctx.stroke(path);
    }
    ctx.restore();
  }

  /** Items [from, to) with their run clips, as the exact frame draws them. */
  #drawRange(ctx: Ctx, from: number, to: number, D: Affine): void {
    const snap = this.#snapshot!;
    let run = -1;
    for (let k = from; k < to; k++) {
      const it = snap.drawList[k]!;
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
      this.#drawItem(ctx, k, D);
    }
    if (run >= 0) ctx.restore();
  }

  /** A drag frame: the layers in paint order, moving layers under the drag transform. */
  #composeDrag(): void {
    const d = this.#drag;
    if (!d) return;
    const ctx = this.#ctx;
    const t0 = this.#hooks.now();
    const D = device(this.#camera, this.#surface.dpr);
    const DM = mul(D, d.matrix);
    const G = mul(DM, invertAffine(D)); // device-space drag transform
    const blit = (c: Canvas) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(c as CanvasImageSource, 0, 0);
    };
    const clipFixed = (f: ClipRect | null) => {
      if (!f) return;
      ctx.setTransform(D[0], D[1], D[2], D[3], D[4], D[5]);
      ctx.beginPath();
      ctx.rect(f.x, f.y, f.w, f.h);
      ctx.clip();
    };
    // A pure translation blits the moving layers (exact at integer device pixels); any other
    // pose (a scale) redraws the moving items as vectors between the cached static layers.
    const m = d.matrix;
    const translation = m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1;
    if (d.mode === "layers") {
      for (const l of d.layers) {
        if (!l.moving) {
          if (l.canvas) blit(l.canvas);
          continue;
        }
        ctx.save();
        clipFixed(l.fixed);
        if (translation && l.canvas) {
          ctx.setTransform(G[0], G[1], G[2], G[3], G[4], G[5]);
          ctx.drawImage(l.canvas as CanvasImageSource, l.x, l.y);
        } else if (!translation)
          for (let k = l.from; k < l.to; k++) this.#paintMoving(ctx, k, DM, DM);
        ctx.restore();
      }
    } else {
      blit(d.layers[0]!.canvas!);
      for (let k = d.first; k <= d.last; k++) {
        if (!d.items.has(k)) {
          this.#drawRange(ctx, k, k + 1, D);
          continue;
        }
        ctx.save();
        clipFixed(d.clips.get(k)?.fixed ?? null);
        this.#paintMoving(ctx, k, DM, DM);
        ctx.restore();
      }
      blit(d.layers[1]!.canvas!);
    }
    this.#hooks.frame({
      camera: this.#camera,
      renderRevision: this.#snapshot?.renderRevision ?? 0,
      kind: "interaction",
      ms: this.#hooks.now() - t0,
      buildMs: 0,
      drawn: 0,
      built: 0,
      complete: true,
      drag: d.mode === "layers" && translation ? "layers" : "live",
    });
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

  /** The exact frame, progressively. With `hold` (a drag pose is on screen), it is drawn
   *  off-screen and presented only when complete, so no partial frame replaces the pose. */
  #drawExact(hold = false): void {
    const token = ++this.#token;
    const snap = this.#snapshot;
    if (hold) {
      const { width, height } = this.#canvas;
      if (!this.#buffer || this.#buffer.width !== width || this.#buffer.height !== height)
        this.#buffer = this.#hooks.createCanvas(width, height);
    }
    const ctx = hold ? (this.#buffer!.getContext("2d") as Ctx) : this.#ctx;
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
      if (hold) {
        this.#ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.#ctx.drawImage(this.#buffer as CanvasImageSource, 0, 0);
        this.#drag = null; // the exact frame replaces the held pose
      }
      this.#snapshotCache();
      this.#drawSelection(this.#ctx, D);
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
