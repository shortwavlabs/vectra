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
import type { ClipRect, DragClip, FrameInfo, Surface } from "../renderer/protocol.ts";
import type { Affine, Camera, RenderPacket, RenderSnapshot } from "../renderer/snapshot.ts";
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

/** Hit-index preparation slice (ms): short enough never to be an attributable long task. */
export const HIT_SLICE_MS = 4;

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
    /** Hit index: total build time, slices, longest slice, evaluation → ready, click waits. */
    hitTestBuildMs: null as number | null,
    hitTestSlices: 0,
    hitTestMaxSliceMs: 0,
    hitTestReadyMs: null as number | null,
    hitTestWaitMs: null as number | null,
    hitTestStaleAnswers: 0,
    /** Drag frames presented, and how the last one was drawn. */
    dragFrames: 0,
    lastDragMode: null as "layers" | "live" | null,
    lastDragMs: null as number | null,
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
  #hitStarted = 0;
  #hitScheduled = false;
  #hitWaiters: (() => void)[] = [];
  readonly #hitChannel = new MessageChannel();
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
  /** A transform gesture in progress: the top-level nodes moved, and the preview matrix. */
  #transform: { ids: NodeId[]; matrix: Affine } | null = null;

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
    this.#hit = null;
    this.#flushHitWaiters();
    this.#hitChannel.port1.onmessage = null;
    this.#hitChannel.port1.close();
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

  // --- transform gestures (G-R1) -----------------------------------------------------------
  /** Selected IDs without a selected ancestor: a transform applies once per subtree. */
  topLevel(ids: readonly NodeId[]): NodeId[] {
    if (!this.#state) return [];
    const set = new Set(ids.filter((id) => this.#state!.nodesById.has(id)));
    const par = parents(this.#state);
    return [...set].filter((id) => {
      for (let p = par.get(id) ?? null; p !== null; p = par.get(p) ?? null)
        if (set.has(p)) return false;
      return true;
    });
  }

  get transforming(): boolean {
    return this.#transform !== null;
  }
  get transformMatrix(): Affine | null {
    return this.#transform?.matrix ?? null;
  }

  /** Starts a display-only preview of moving `ids` (their top-level subtrees). */
  beginTransform(ids: readonly NodeId[]): boolean {
    const top = this.topLevel(ids);
    if (!this.#ev || top.length === 0) return false;
    this.#transform = { ids: top, matrix: [1, 0, 0, 1, 0, 0] };
    this.#sendDragStart();
    return true;
  }

  updateTransform(matrix: Affine): void {
    if (!this.#transform) return;
    this.#transform.matrix = matrix;
    this.client.dragMove(matrix);
  }

  /**
   * Ends the gesture. Committed (and not an identity), the caller's `commit` dispatches one
   * command and the pose stays on screen until that revision's exact frame is complete; if the
   * command is rejected (the revision does not change), the preview is cancelled.
   */
  endTransform(commit: boolean, onCommit?: (ids: readonly NodeId[], matrix: Affine) => void): void {
    const t = this.#transform;
    this.#transform = null;
    if (!t) return;
    const m = t.matrix;
    const identity =
      m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
    if (!commit || identity || !onCommit) return this.client.dragEnd(true);
    this.client.dragEnd(false);
    const rev = this.documentRevision;
    onCommit(t.ids, m);
    if (this.documentRevision === rev) this.client.dragEnd(true);
  }

  /** The draw items of the moving subtrees, with their fixed and moving clips. */
  #sendDragStart(): void {
    const t = this.#transform;
    if (!t || !this.#ev || !this.#state) return;
    const worlds = new Map<NodeId, Matrix>();
    const par = parents(this.#state);
    const items: number[] = [];
    const clips: DragClip[] = [];
    const rect = (r: Rect | null): ClipRect | null =>
      r && { x: r.x, y: r.y, w: r.width, h: r.height };
    for (const owner of t.ids) {
      // Clips above the moved node stay fixed; clips at or below it move with it.
      let fixed: Rect | null = null;
      for (let n = par.get(owner) ?? null; n !== null; n = par.get(n) ?? null) {
        const node = this.#state.nodesById.get(n);
        if (node && "clipRef" in node && node.clipRef)
          fixed = intersectRects(fixed, mapRect(this.#worldOf(n, worlds), node.clipRef));
      }
      for (const k of this.itemsOf(owner)) {
        const it = this.#ev.drawList[k]!;
        const inner = this.#innerClip(it.nodeId, owner, worlds);
        items.push(k);
        clips.push({ fixed: rect(fixed), moving: rect(inner) });
      }
    }
    this.client.dragStart(this.#renderRevision, items, clips);
    const m = t.matrix;
    if (!(m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0))
      this.client.dragMove(m);
  }

  // --- hit testing ----------------------------------------------------------------------------
  /**
   * The topmost selectable node under a CSS point of the canvas, or null; `undefined` when the
   * document changed before the answer was ready (the caller ignores it). The index is prepared
   * in bounded slices after each evaluation; a click that arrives first waits for completion,
   * still in slices, and is never answered by a partial index.
   */
  hitAt(cssX: number, cssY: number): Promise<NodeId | null | undefined> {
    const c = this.#camera;
    const x = (cssX - c.tx) / c.scale;
    const y = (cssY - c.ty) / c.scale;
    const ev = this.#ev;
    const hit = this.#hit;
    if (!ev || !hit) return Promise.resolve(null);
    if (hit.ready) return Promise.resolve(hit.hit(x, y));
    const t0 = performance.now();
    return new Promise((resolve) => {
      this.#hitWaiters.push(() => {
        this.diag.hitTestWaitMs = performance.now() - t0;
        if (this.#ev === ev && this.#hit === hit && hit.ready) resolve(hit.hit(x, y));
        else {
          this.diag.hitTestStaleAnswers++;
          resolve(undefined);
        }
      });
      this.#scheduleHitSlice();
    });
  }

  /** Qualification only: completes the index synchronously and queries it. */
  hitDocument(x: number, y: number): NodeId | null {
    if (!this.#hit) return null;
    if (!this.#hit.ready) {
      this.#hit.step(Infinity);
      this.#hitDone();
    }
    return this.#hit.hit(x, y);
  }

  /** Starts preparing the index of the current evaluation (any older index is dropped). */
  #startHitIndex(): void {
    this.#hit =
      this.#ev && this.#session
        ? new HitTester(this.#ev, this.#session.store, { deferred: true })
        : null;
    this.#hitStarted = performance.now();
    this.diag.hitTestBuildMs = null;
    this.diag.hitTestReadyMs = null;
    this.#flushHitWaiters(); // answers for an older evaluation are stale
    if (this.#hit) this.#scheduleHitSlice();
  }

  #scheduleHitSlice(): void {
    if (this.#hitScheduled || !this.#hit || this.#hit.ready) return;
    this.#hitScheduled = true;
    if (this.#hitWaiters.length) {
      // A click is waiting: run the next slice as soon as the event loop allows.
      this.#hitChannel.port1.onmessage = () => this.#runHitSlice();
      this.#hitChannel.port2.postMessage(0);
    } else setTimeout(() => this.#runHitSlice(), 0);
  }

  #runHitSlice(): void {
    this.#hitScheduled = false;
    const hit = this.#hit;
    if (!hit || hit.ready) return;
    const t0 = performance.now();
    hit.slice(HIT_SLICE_MS, 2048);
    const ms = performance.now() - t0;
    this.diag.hitTestSlices++;
    this.diag.hitTestMaxSliceMs = Math.max(this.diag.hitTestMaxSliceMs, ms);
    if (hit.ready) this.#hitDone();
    else this.#scheduleHitSlice();
  }

  #hitDone(): void {
    if (!this.#hit) return;
    this.diag.hitTestBuildMs = this.#hit.buildMs;
    this.diag.hitTestReadyMs = performance.now() - this.#hitStarted;
    this.#flushHitWaiters();
  }

  #flushHitWaiters(): void {
    for (const w of this.#hitWaiters.splice(0)) w();
  }

  // --- internals ------------------------------------------------------------------------------
  #refresh(): void {
    const state = this.#session?.getSnapshot().state ?? null;
    if (state === this.#state) return;
    this.#state = state;
    if (!state) {
      this.#ev = null;
      this.#itemsUnder = null;
      this.#startHitIndex();
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
      this.#startHitIndex();
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
    // A document change during a transform gesture: the preview restarts on the new snapshot.
    if (this.#transform) this.#sendDragStart();
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
    if (f.drag) {
      this.diag.dragFrames++;
      this.diag.lastDragMode = f.drag;
      this.diag.lastDragMs = f.ms;
    }
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
