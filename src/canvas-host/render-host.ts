// Document → renderer bridge (the "renderer host" of C2 rule 9 and C8). Lives outside
// src/renderer, so the renderer imports nothing from the document. It:
// - evaluates the document once per state (the single evaluation shared with hit testing and
//   export) into an immutable RenderSnapshot;
// - sends render copies (`GeometryStore.renderCopy`) only of chunks the renderer does not hold,
//   and tells it which chunks to release; structural edits of held chunks copy nothing;
// - maps selection to draw-list indices, hit-tests on the vector data, and drives the camera;
// - keeps per-stage timings so document preparation, geometry transfer and drawing are reported
//   separately (C9).
import { type Evaluation, evaluate } from "../document/evaluate.ts";
import {
  type DocState,
  intersectRects,
  isContainer,
  mapRect,
  type Matrix,
  multiply,
  type NodeId,
  type Rect,
} from "../document/model.ts";
import type { DocumentSession } from "../document/session.ts";
import { HitTester } from "../hit-test/index.ts";
import { type ClientState, type HostMode, RenderClient } from "../renderer/client.ts";
import type { FrameInfo, Surface } from "../renderer/protocol.ts";
import type { Camera, RenderPacket, RenderSnapshot } from "../renderer/snapshot.ts";
import type { CanvasHostState, CanvasView } from "./types.ts";

export interface RenderHostOptions {
  container: HTMLElement;
  createWorker(): Worker;
  forceMainThread?: boolean;
  paper?: string;
  workspace?: string;
  /** Selection outline and halo colours (defaults: the renderer's). */
  selection?: string;
  halo?: string;
  onState(state: CanvasHostState): void;
  onView?(view: CanvasView): void;
  onFrame?(frame: FrameInfo & { host: HostMode }): void;
}

/** Parent of every node, per immutable state (read-only; the canvas host imports no commands). */
const parentMaps = new WeakMap<DocState, Map<NodeId, NodeId | null>>();
function parents(s: DocState): Map<NodeId, NodeId | null> {
  let m = parentMaps.get(s);
  if (!m) {
    m = new Map();
    for (const id of s.orderedRootIds) m.set(id, null);
    for (const n of s.nodesById.values())
      if (isContainer(n)) for (const c of n.orderedChildIds) m.set(c, n.id);
    parentMaps.set(s, m);
  }
  return m;
}

/** Selected paths outlined by the renderer, at most (beyond it: the bounds overlay only). A
 *  selected container is never outlined path by path: its bounds are drawn by the caller. */
export const OUTLINE_LIMIT = 2000;

export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Pending {
  readonly renderRevision: number;
  readonly documentRevision: number;
  readonly sentAt: number;
  firstFrameMs: number | null;
}

export class DocumentRenderHost {
  readonly client: RenderClient;
  readonly diag = {
    snapshots: 0,
    selections: 0,
    /** Chunks copied for the renderer, and their bytes (C2 render copies). */
    chunksCopied: 0,
    bytesCopied: 0,
    releases: 0,
    /** Last snapshot: document evaluation + snapshot build, render copy, post (main thread). */
    lastPrepareMs: 0,
    lastCopyMs: 0,
    lastPostMs: 0,
    /** Last document revision: snapshot sent → first (progressive) frame, → first exact frame. */
    lastFirstFrameMs: null as number | null,
    lastExactFrameMs: null as number | null,
    lastExactDrawMs: null as number | null,
    hitTestBuildMs: null as number | null,
    exactFrames: 0,
    interactionFrames: 0,
    /** Increments whenever a different document session is shown. */
    sessions: 0,
    /** The last complete exact frame: its render revision and camera. */
    lastExact: null as { renderRevision: number; camera: Camera; host: HostMode } | null,
  };
  readonly #o: RenderHostOptions;
  #surface: Surface;
  #camera: Camera = { scale: 1, tx: 0, ty: 0 };
  #session: DocumentSession | null = null;
  #unsubscribe: (() => void) | null = null;
  #state: DocState | null = null;
  #ev: Evaluation | null = null;
  #hit: HitTester | null = null;
  #renderRevision = 0;
  #selection: readonly NodeId[] = [];
  /** Draw-list indices per PathObject (a path can draw more than once only if duplicated). */
  #itemsOf = new Map<NodeId, number[]>();
  /** Draw-list indices per container (its visible descendants), built on the first query. */
  #itemsUnder: Map<NodeId, number[]> | null = null;
  #fitOnNext = true;
  #pending: Pending | null = null;
  /** The session whose chunks the renderer holds: chunk IDs are unique only within one store. */
  #copiedFrom: DocumentSession | null = null;
  #lastState: CanvasHostState = { kind: "starting" };

  constructor(o: RenderHostOptions) {
    this.#o = o;
    this.#surface = {
      cssWidth: 1,
      cssHeight: 1,
      dpr: 1,
      workspace: o.workspace ?? "#2b2b2b",
      paper: o.paper ?? "#ffffff",
      ...(o.selection ? { selection: o.selection } : {}),
      ...(o.halo ? { halo: o.halo } : {}),
    };
    this.client = new RenderClient({
      container: o.container,
      surface: this.#surface,
      createWorker: () => o.createWorker(),
      ...(o.forceMainThread ? { forceMainThread: true } : {}),
      onFrame: (f) => this.#onFrame(f),
      onState: (s) => this.#onClientState(s),
      onNeedReplay: () => this.#push(true),
    });
  }

  get camera(): Camera {
    return this.#camera;
  }
  get documentRevision(): number {
    return this.#session?.getSnapshot().revision ?? 0;
  }
  get renderRevision(): number {
    return this.#renderRevision;
  }

  start(): void {
    this.client.start();
  }

  dispose(): void {
    this.#unsubscribe?.();
    this.client.dispose();
  }

  setSession(session: DocumentSession | null): void {
    if (session === this.#session) return;
    this.#unsubscribe?.();
    this.#session = session;
    this.diag.sessions++;
    this.#state = null;
    this.#fitOnNext = true;
    this.#unsubscribe = session ? session.subscribe(() => this.#refresh()) : null;
    this.#refresh();
  }

  setSelection(ids: readonly NodeId[]): void {
    this.#selection = ids;
    if (!this.#ev) return;
    this.diag.selections++;
    this.client.selection(++this.#renderRevision, this.#selectionIndices());
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    const changed =
      cssWidth !== this.#surface.cssWidth ||
      cssHeight !== this.#surface.cssHeight ||
      dpr !== this.#surface.dpr;
    if (!changed) return;
    const first = this.#surface.cssWidth <= 1;
    this.#surface = { ...this.#surface, cssWidth, cssHeight, dpr };
    this.client.resize(this.#surface);
    if (first || this.#fitOnNext) this.fitToView();
  }

  // --- camera ---------------------------------------------------------------------------------
  setView(view: CanvasView): void {
    this.#camera = { scale: view.scale, tx: view.tx, ty: view.ty };
    this.client.camera(this.#camera);
    this.#o.onView?.(this.#camera);
  }

  /** Fits the artboard into the viewport with a margin. */
  fitToView(): void {
    const a = this.#state?.artboard;
    if (!a || this.#surface.cssWidth <= 1) return;
    const margin = 24;
    const s = Math.min(
      (this.#surface.cssWidth - 2 * margin) / a.width,
      (this.#surface.cssHeight - 2 * margin) / a.height,
    );
    const scale = s > 0 ? s : 1;
    this.setView({
      scale,
      tx: (this.#surface.cssWidth - a.width * scale) / 2,
      ty: (this.#surface.cssHeight - a.height * scale) / 2,
    });
    this.#fitOnNext = false;
  }

  /** Zooms by `factor` about the CSS point (cx, cy), the viewport centre by default. */
  zoomBy(factor: number, cx = this.#surface.cssWidth / 2, cy = this.#surface.cssHeight / 2): void {
    const c = this.#camera;
    const scale = Math.min(256, Math.max(1 / 256, c.scale * factor));
    const k = scale / c.scale;
    this.setView({ scale, tx: cx - k * (cx - c.tx), ty: cy - k * (cy - c.ty) });
  }

  panBy(dx: number, dy: number): void {
    const c = this.#camera;
    this.setView({ scale: c.scale, tx: c.tx + dx, ty: c.ty + dy });
  }

  gesture(phase: "start" | "end"): void {
    this.client.gesture(phase);
  }

  // --- hit testing ----------------------------------------------------------------------------
  /** The topmost selectable node under a CSS point of the canvas, or null. */
  hitAt(cssX: number, cssY: number): NodeId | null {
    const c = this.#camera;
    return this.hitDocument((cssX - c.tx) / c.scale, (cssY - c.ty) / c.scale);
  }

  hitDocument(x: number, y: number): NodeId | null {
    if (!this.#ev || !this.#session) return null;
    if (!this.#hit) {
      this.#hit = new HitTester(this.#ev, this.#session.store);
      this.diag.hitTestBuildMs = this.#hit.buildMs;
    }
    return this.#hit.hit(x, y);
  }

  // --- internals ------------------------------------------------------------------------------
  #refresh(): void {
    const state = this.#session?.getSnapshot().state ?? null;
    if (state === this.#state) return;
    this.#state = state;
    this.#hit = null;
    if (!state) {
      this.#ev = null;
      this.#itemsUnder = null;
      this.#itemsOf.clear();
      this.#emit({ kind: "empty" });
      return;
    }
    this.#push(false);
    if (this.#fitOnNext) this.fitToView();
  }

  /** Outlined items: those of selected PathObjects only (containers are shown by bounds). */
  #selectionIndices(): number[] {
    const out: number[] = [];
    for (const id of this.#selection) for (const k of this.#itemsOf.get(id) ?? []) out.push(k);
    return out.length > OUTLINE_LIMIT ? [] : out;
  }

  /** Draw-list indices of everything a node draws: itself (a path) or its visible descendants. */
  itemsOf(id: NodeId): readonly number[] {
    const own = this.#itemsOf.get(id);
    if (own) return own;
    if (!this.#ev || !this.#state) return [];
    if (!this.#itemsUnder) {
      const under = new Map<NodeId, number[]>();
      const par = parents(this.#state);
      this.#ev.drawList.forEach((it, k) => {
        for (let n = par.get(it.nodeId) ?? null; n !== null; n = par.get(n) ?? null) {
          const l = under.get(n);
          if (l) l.push(k);
          else under.set(n, [k]);
        }
      });
      this.#itemsUnder = under;
    }
    return this.#itemsUnder.get(id) ?? [];
  }

  /** Composed (document-space) matrix of a container, cached per evaluated state. */
  #worldOf(id: NodeId, cache: Map<NodeId, Matrix>): Matrix {
    const hit = cache.get(id);
    if (hit) return hit;
    const state = this.#state!;
    const p = parents(state).get(id) ?? null;
    const local = state.nodesById.get(id)!.localTransform;
    const m = p === null ? local : multiply(this.#worldOf(p, cache), local);
    cache.set(id, m);
    return m;
  }

  /** The clip a node's own subtree applies to path `pathId` (its clips, not its ancestors'). */
  #innerClip(pathId: NodeId, owner: NodeId, cache: Map<NodeId, Matrix>): Rect | null {
    if (pathId === owner) return null;
    const state = this.#state!;
    const par = parents(state);
    let clip: Rect | null = null;
    for (let n = par.get(pathId) ?? null; n !== null; n = par.get(n) ?? null) {
      const node = state.nodesById.get(n);
      if (node && "clipRef" in node && node.clipRef)
        clip = intersectRects(clip, mapRect(this.#worldOf(n, cache), node.clipRef));
      if (n === owner) break;
    }
    return clip;
  }

  /**
   * Document-space bounds of what the nodes draw: each visible item's control-point box under
   * its composed transform. Hidden descendants are excluded. Clips owned inside a selected
   * subtree bound it; a clip owned by an ancestor of the selection does not (it stays fixed when
   * the selection moves). This box is the one the overlay, the handles and the inspector use.
   */
  boundsOf(ids: readonly NodeId[]): Bounds | null {
    const ev = this.#ev;
    const session = this.#session;
    if (!ev || !session) return null;
    const worlds = new Map<NodeId, Matrix>();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const seen = new Set<number>();
    for (const owner of ids)
      for (const k of this.itemsOf(owner)) {
        if (seen.has(k)) continue;
        seen.add(k);
        const it = ev.drawList[k]!;
        const [bx0, by0, bx1, by1] = session.store.derived(it.chunkId).bounds(it.pathIndex);
        const m = it.transform;
        let ix0 = Infinity;
        let iy0 = Infinity;
        let ix1 = -Infinity;
        let iy1 = -Infinity;
        for (const [px, py] of [
          [bx0, by0],
          [bx1, by0],
          [bx0, by1],
          [bx1, by1],
        ] as const) {
          const X = m[0] * px + m[2] * py + m[4];
          const Y = m[1] * px + m[3] * py + m[5];
          ix0 = Math.min(ix0, X);
          iy0 = Math.min(iy0, Y);
          ix1 = Math.max(ix1, X);
          iy1 = Math.max(iy1, Y);
        }
        const clip = this.#innerClip(it.nodeId, owner, worlds);
        if (clip) {
          ix0 = Math.max(ix0, clip.x);
          iy0 = Math.max(iy0, clip.y);
          ix1 = Math.min(ix1, clip.x + clip.width);
          iy1 = Math.min(iy1, clip.y + clip.height);
          if (ix1 < ix0 || iy1 < iy0) continue;
        }
        x0 = Math.min(x0, ix0);
        y0 = Math.min(y0, iy0);
        x1 = Math.max(x1, ix1);
        y1 = Math.max(y1, iy1);
      }
    return x0 <= x1 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
  }

  /** Sends the current document as a snapshot; `full` re-sends every chunk (after a restart). */
  #push(full: boolean): void {
    const state = this.#state;
    const session = this.#session;
    if (!state || !session) return;
    const t0 = performance.now();
    if (!this.#ev || full === false) {
      this.#ev = evaluate(state);
      this.#itemsUnder = null;
    }
    const ev = this.#ev;
    this.#itemsOf = new Map();
    ev.drawList.forEach((it, k) => {
      const l = this.#itemsOf.get(it.nodeId);
      if (l) l.push(k);
      else this.#itemsOf.set(it.nodeId, [k]);
    });
    const documentRevision = session.getSnapshot().revision;
    const snapshot: RenderSnapshot = {
      renderRevision: ++this.#renderRevision,
      documentRevision,
      artboard: {
        width: state.artboard.width,
        height: state.artboard.height,
        background: state.artboard.background,
      },
      runs: ev.runs.map((r) => ({ id: r.id, clip: r.clip })),
      drawList: ev.drawList.map((it) => ({
        chunkId: it.chunkId,
        pathIndex: it.pathIndex,
        transform: it.transform,
        fill: it.fill,
        ...(it.stroke ? { stroke: it.stroke } : {}),
        evenOdd: it.evenOdd,
        groupRun: it.groupRun,
      })),
      selection: this.#selectionIndices(),
    };
    const needed = new Set(ev.drawList.map((it) => it.chunkId));
    const held = this.client.held;
    // Another document: its `chk_1` is not this one's `chk_1`. Replace every render copy.
    const replace = full || this.#copiedFrom !== session;
    const copy = [...needed].filter((id) => replace || !held.has(id));
    const release = full ? [] : replace ? [...held] : [...held].filter((id) => !needed.has(id));
    this.#copiedFrom = session;
    const t1 = performance.now();
    const { packets } = session.store.renderCopy(copy);
    const render: RenderPacket[] = packets.map((p, i) => ({
      chunkId: copy[i]!,
      verbs: p.verbs,
      coords: p.coords,
      verbOffsets: p.verbOffsets,
      coordOffsets: p.coordOffsets,
    }));
    const t2 = performance.now();
    // Counted before sending: the buffers are transferred (detached) by the send.
    const bytes = render.reduce(
      (n, p) =>
        n +
        p.verbs.byteLength +
        p.coords.byteLength +
        p.verbOffsets.byteLength +
        p.coordOffsets.byteLength,
      0,
    );
    this.client.send(snapshot, render, release);
    const t3 = performance.now();
    this.diag.snapshots++;
    this.diag.chunksCopied += copy.length;
    this.diag.bytesCopied += bytes;
    this.diag.releases += release.length;
    this.diag.lastPrepareMs = t1 - t0;
    this.diag.lastCopyMs = t2 - t1;
    this.diag.lastPostMs = t3 - t2;
    this.#pending = {
      renderRevision: snapshot.renderRevision,
      documentRevision,
      sentAt: t0,
      firstFrameMs: null,
    };
    this.#emit({ kind: "rendering", documentRevision });
  }

  #onFrame(f: FrameInfo & { host: HostMode }): void {
    if (f.kind === "exact") {
      this.diag.exactFrames++;
      if (f.complete)
        this.diag.lastExact = { renderRevision: f.renderRevision, camera: f.camera, host: f.host };
    } else this.diag.interactionFrames++;
    const p = this.#pending;
    if (p && f.renderRevision >= p.renderRevision) {
      const ms = performance.now() - p.sentAt;
      p.firstFrameMs ??= ms;
      if (f.kind === "exact" && f.complete) {
        this.diag.lastFirstFrameMs = p.firstFrameMs;
        this.diag.lastExactFrameMs = ms;
        this.diag.lastExactDrawMs = f.ms;
        this.#pending = null;
        this.#emit({ kind: "ready", documentRevision: p.documentRevision, host: f.host });
      }
    }
    this.#o.onFrame?.(f);
  }

  #onClientState(s: ClientState): void {
    if (s.kind === "starting") this.#emit({ kind: "starting" });
    else if (s.kind === "recovering") this.#emit({ kind: "recovering", reason: s.reason });
    else if (s.kind === "error") this.#emit({ kind: "error", code: s.code, message: s.message });
    else if (!this.#state) this.#emit({ kind: "empty" });
  }

  #emit(s: CanvasHostState): void {
    this.#lastState = s;
    this.#o.onState(s);
  }

  get state(): CanvasHostState {
    return this.#lastState;
  }
}
