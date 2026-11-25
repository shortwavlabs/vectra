// The vector canvas: implements the agreed canvas-host interface (types.ts) over the renderer
// (worker host or disclosed main-thread fallback), with its overlay: the artboard frame, the
// selection's box and, when the selection is transformable, eight transform handles. It reads
// the document only: selection and completed transform gestures go to the caller.
//
// Pointer model (G-R1):
// - a click selects through the hit-test service (exact geometry, never a rendered frame);
// - a drag that starts inside the selection's box moves the selection (when transformable);
//   any other drag pans; Space+drag or the middle button always pans;
// - a corner handle scales uniformly about the opposite corner, an edge handle along one axis
//   about the opposite edge; with Alt, about the centre;
// - Escape during a move or scale cancels it: nothing is reported, no history entry.
// The preview is display only (layered drag caches in the renderer); release reports one
// transform, which the caller dispatches as one command.
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { NodeId } from "../document/model.ts";
import type { DocumentSession } from "../document/session.ts";
import type { Affine } from "../renderer/snapshot.ts";
import { type Bounds, DocumentRenderHost } from "./render-host.ts";
import type { CanvasHostHandle, CanvasHostProps, CanvasView } from "./types.ts";

export interface VectorCanvasProps extends CanvasHostProps {
  /** Use the main-thread renderer (engineering toggle). */
  readonly forceMainThread?: boolean;
  readonly paper?: string;
  readonly workspace?: string;
  /** Selection outline and halo colours (renderer outlines and the overlay). */
  readonly selectionColor?: string;
  readonly haloColor?: string;
  /** Engineering access to the host (qualification API). */
  readonly onHost?: (host: DocumentRenderHost | null) => void;
}

const createWorker = () =>
  new Worker(new URL("../renderer/render.worker.ts", import.meta.url), { type: "module" });

const DRAG_PX = 3;
const HANDLE = 9; // CSS px
const LIME = "#b9e87b";
const INK = "#191a1c";

/** A tiny external store (the overlay subscribes; the canvas never re-renders per frame). */
function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (v: T) => {
      value = v;
      for (const l of listeners) l();
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
type Store<T> = ReturnType<typeof store<T>>;

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const CURSOR: Record<Handle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

/** The handle's point and its anchor (the opposite point) on a document box. */
function handleGeometry(h: Handle, b: Bounds, centre: boolean) {
  const x = [b.x, b.x + b.width / 2, b.x + b.width];
  const y = [b.y, b.y + b.height / 2, b.y + b.height];
  const col = h.includes("w") ? 0 : h.includes("e") ? 2 : 1;
  const row = h.includes("n") ? 0 : h.includes("s") ? 2 : 1;
  const point: [number, number] = [x[col]!, y[row]!];
  const anchor: [number, number] = centre ? [x[1]!, y[1]!] : [x[2 - col]!, y[2 - row]!];
  return { point, anchor, col, row };
}

/** The scale about the handle's anchor that brings the handle to document point `q`. */
function scaleFor(h: Handle, b: Bounds, q: [number, number], centre: boolean): Affine {
  const { point, anchor, col, row } = handleGeometry(h, b, centre);
  const [ax, ay] = anchor;
  const clamp = (f: number) => (Number.isFinite(f) ? Math.max(0.01, f) : 1);
  let fx = 1;
  let fy = 1;
  if (col !== 1 && row !== 1) {
    // Corner: uniform, by projection onto the anchor → handle diagonal.
    const dx = point[0] - ax;
    const dy = point[1] - ay;
    fx = fy = clamp(((q[0] - ax) * dx + (q[1] - ay) * dy) / (dx * dx + dy * dy));
  } else if (col !== 1) fx = clamp((q[0] - ax) / (point[0] - ax));
  else fy = clamp((q[1] - ay) / (point[1] - ay));
  return [fx, 0, 0, fy, ax - fx * ax, ay - fy * ay];
}

const mapBounds = (m: Affine, b: Bounds): Bounds => {
  const xs = [b.x, b.x + b.width].map((x) => m[0] * x + m[4]);
  const ys = [b.y, b.y + b.height].map((y) => m[3] * y + m[5]);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.abs(xs[1]! - xs[0]!),
    height: Math.abs(ys[1]! - ys[0]!),
  };
};

const noSubscribe = () => () => {};
const noSnapshot = () => null;

function CanvasOverlay(p: {
  host: DocumentRenderHost | null;
  session: DocumentSession | null;
  selection: readonly NodeId[];
  transformable: boolean;
  views: Store<CanvasView | null>;
  pose: Store<Affine | null>;
  color: string;
  halo: string;
}) {
  const view = useSyncExternalStore(p.views.subscribe, p.views.get);
  const pose = useSyncExternalStore(p.pose.subscribe, p.pose.get);
  const snap = useSyncExternalStore(
    p.session?.subscribe ?? noSubscribe,
    p.session?.getSnapshot ?? noSnapshot,
  );
  const state = snap?.state;
  if (!p.host || !view || !state) return null;
  const art = state.artboard;
  const base = p.selection.length ? p.host.boundsOf(p.selection) : null;
  const b = base && pose ? mapBounds(pose, base) : base;
  const css = (x: number, y: number) => [x * view.scale + view.tx, y * view.scale + view.ty];
  const box =
    b &&
    (() => {
      const [x0, y0] = css(b.x, b.y);
      const [x1, y1] = css(b.x + b.width, b.y + b.height);
      return { left: x0!, top: y0!, width: x1! - x0!, height: y1! - y0! };
    })();
  return (
    <div
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}
    >
      <div
        data-testid="artboard"
        style={{
          position: "absolute",
          left: view.tx,
          top: view.ty,
          width: art.width * view.scale,
          height: art.height * view.scale,
        }}
      />
      {b && box && (
        <div
          data-testid="selection-bounds"
          data-bounds={`${b.x} ${b.y} ${b.width} ${b.height}`}
          data-transformable={p.transformable ? "true" : "false"}
          style={{
            position: "absolute",
            left: box.left - 1,
            top: box.top - 1,
            width: box.width + 2,
            height: box.height + 2,
            border: `1px solid ${p.color}`,
            boxShadow: `0 0 0 1px ${p.halo}`,
          }}
        />
      )}
      {b &&
        box &&
        p.transformable &&
        HANDLES.map((h) => {
          const { point } = handleGeometry(h, b, false);
          const [cx, cy] = css(point[0], point[1]);
          return (
            <div
              key={h}
              data-handle={h}
              data-testid={`handle-${h}`}
              style={{
                position: "absolute",
                left: cx! - HANDLE / 2,
                top: cy! - HANDLE / 2,
                width: HANDLE,
                height: HANDLE,
                background: p.halo,
                border: `1.5px solid ${p.color}`,
                borderRadius: 2,
                pointerEvents: "auto",
                cursor: CURSOR[h],
              }}
            />
          );
        })}
    </div>
  );
}

export const VectorCanvas = forwardRef<CanvasHostHandle, VectorCanvasProps>(
  function VectorCanvas(props, ref) {
    const outer = useRef<HTMLDivElement>(null);
    const surface = useRef<HTMLDivElement>(null);
    const host = useRef<DocumentRenderHost | null>(null);
    const [hostObj, setHostObj] = useState<DocumentRenderHost | null>(null);
    const [views] = useState(() => store<CanvasView | null>(null));
    const [pose] = useState(() => store<Affine | null>(null));
    const latest = useRef(props);
    useEffect(() => {
      latest.current = props;
    });

    useImperativeHandle(ref, () => ({
      fitToView: () => host.current?.fitToView(),
      zoomBy: (f) => host.current?.zoomBy(f),
      setView: (v) => host.current?.setView(v),
    }));

    // One host per mounted canvas (React StrictMode remounts are handled by disposing and
    // recreating: the document is untouched either way).
    useEffect(() => {
      const el = outer.current!;
      const h = new DocumentRenderHost({
        container: surface.current!,
        createWorker,
        ...(latest.current.forceMainThread ? { forceMainThread: true } : {}),
        ...(latest.current.paper ? { paper: latest.current.paper } : {}),
        ...(latest.current.workspace ? { workspace: latest.current.workspace } : {}),
        ...(latest.current.selectionColor ? { selection: latest.current.selectionColor } : {}),
        ...(latest.current.haloColor ? { halo: latest.current.haloColor } : {}),
        onState: (s) => latest.current.onStateChange?.(s),
        onView: (v) => {
          views.set(v);
          latest.current.onViewChange?.(v);
        },
      });
      host.current = h;
      setHostObj(h);
      h.start();
      h.setSession(latest.current.session);
      h.setSelection(latest.current.selection);
      latest.current.onHost?.(h);
      const measure = () => {
        const r = el.getBoundingClientRect();
        h.resize(
          Math.max(1, Math.round(r.width)),
          Math.max(1, Math.round(r.height)),
          window.devicePixelRatio || 1,
        );
      };
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      measure();
      const dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      dprQuery.addEventListener("change", measure);

      type Gesture =
        | { kind: "pending"; id: number; x: number; y: number; move: boolean }
        | { kind: "pan"; id: number; last: [number, number] }
        | { kind: "move"; id: number; x: number; y: number }
        | { kind: "scale"; id: number; handle: Handle; box: Bounds };
      let g: Gesture | null = null;
      let space = false;
      const local = (e: PointerEvent | WheelEvent): [number, number] => {
        const r = el.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
      };
      const toDoc = ([x, y]: [number, number]): [number, number] => {
        const c = h.camera;
        return [(x - c.tx) / c.scale, (y - c.ty) / c.scale];
      };
      const insideSelection = (p: [number, number]) => {
        const b = latest.current.selection.length ? h.boundsOf(latest.current.selection) : null;
        if (!b) return false;
        const [x, y] = toDoc(p);
        return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
      };
      const finish = (commit: boolean) => {
        h.endTransform(commit, (ids, m) =>
          latest.current.onTransform?.(ids, m as [number, number, number, number, number, number]),
        );
        pose.set(null);
      };
      const onDown = (e: PointerEvent) => {
        if (g) return;
        const p = local(e);
        if (e.button === 1 || (e.button === 0 && space)) {
          e.preventDefault();
          el.setPointerCapture(e.pointerId);
          g = { kind: "pan", id: e.pointerId, last: p };
          h.gesture("start");
          return;
        }
        if (e.button !== 0) return;
        el.setPointerCapture(e.pointerId);
        const handle = (e.target as Element | null)
          ?.closest?.("[data-handle]")
          ?.getAttribute("data-handle") as Handle | null | undefined;
        if (handle && latest.current.transformable) {
          const box = h.boundsOf(latest.current.selection);
          if (box && h.beginTransform(latest.current.selection)) {
            g = { kind: "scale", id: e.pointerId, handle, box };
            return;
          }
        }
        g = {
          kind: "pending",
          id: e.pointerId,
          x: p[0],
          y: p[1],
          move: Boolean(latest.current.transformable) && insideSelection(p),
        };
      };
      const onMove = (e: PointerEvent) => {
        if (!g || e.pointerId !== g.id) return;
        const p = local(e);
        if (g.kind === "pending") {
          if (Math.hypot(p[0] - g.x, p[1] - g.y) <= DRAG_PX) return;
          if (g.move && h.beginTransform(latest.current.selection))
            g = { kind: "move", id: g.id, x: g.x, y: g.y };
          else {
            g = { kind: "pan", id: g.id, last: [g.x, g.y] };
            h.gesture("start");
          }
        }
        if (g.kind === "pan") {
          h.panBy(p[0] - g.last[0], p[1] - g.last[1]);
          g.last = p;
        } else if (g.kind === "move") {
          const s = h.camera.scale;
          const m: Affine = [1, 0, 0, 1, (p[0] - g.x) / s, (p[1] - g.y) / s];
          h.updateTransform(m);
          pose.set(m);
        } else if (g.kind === "scale") {
          const m = scaleFor(g.handle, g.box, toDoc(p), e.altKey);
          h.updateTransform(m);
          pose.set(m);
        }
      };
      const onUp = (e: PointerEvent) => {
        if (!g || e.pointerId !== g.id) return;
        const d = g;
        g = null;
        if (d.kind === "pan") return h.gesture("end");
        if (d.kind === "move" || d.kind === "scale") return finish(true);
        const mode = e.shiftKey ? "toggle" : "replace";
        void h.hitAt(d.x, d.y).then((id) => {
          // Dropped when the document changed, or this canvas was replaced, before the answer.
          if (id === undefined || host.current !== h) return;
          latest.current.onSelect(id ? [id] : [], mode);
        });
      };
      const onCancel = (e: PointerEvent) => {
        if (!g || e.pointerId !== g.id) return;
        const d = g;
        g = null;
        if (d.kind === "pan") h.gesture("end");
        else if (d.kind === "move" || d.kind === "scale") finish(false);
      };
      // Capture phase, so the cancelling Escape does not also reach page shortcuts.
      const onKey = (e: KeyboardEvent) => {
        if (e.key === " ") space = e.type === "keydown";
        if (e.type !== "keydown" || e.key !== "Escape" || !g) return;
        if (g.kind !== "move" && g.kind !== "scale") return;
        e.preventDefault();
        e.stopPropagation();
        if (el.hasPointerCapture(g.id)) el.releasePointerCapture(g.id);
        g = null;
        finish(false);
      };
      let wheelEnd: ReturnType<typeof setTimeout> | null = null;
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        if (wheelEnd === null) h.gesture("start");
        else clearTimeout(wheelEnd);
        wheelEnd = setTimeout(() => {
          wheelEnd = null;
          h.gesture("end");
        }, 150);
        if (e.ctrlKey || e.metaKey) {
          const [x, y] = local(e);
          h.zoomBy(Math.exp(-e.deltaY * 0.01), x, y);
        } else h.panBy(-e.deltaX, -e.deltaY);
      };
      el.addEventListener("pointerdown", onDown);
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onCancel);
      el.addEventListener("wheel", onWheel, { passive: false });
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("keyup", onKey, true);
      return () => {
        ro.disconnect();
        dprQuery.removeEventListener("change", measure);
        el.removeEventListener("pointerdown", onDown);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onCancel);
        el.removeEventListener("wheel", onWheel);
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("keyup", onKey, true);
        if (wheelEnd) clearTimeout(wheelEnd);
        latest.current.onHost?.(null);
        h.dispose();
        host.current = null;
        setHostObj(null);
      };
    }, [views, pose]);

    useEffect(() => {
      host.current?.setSession(props.session);
    }, [props.session]);
    useEffect(() => {
      host.current?.setSelection(props.selection);
    }, [props.selection]);

    return (
      <div
        ref={outer}
        className={props.className}
        role="img"
        aria-label={props.label ?? "Vector artwork"}
        data-testid="canvas-host"
        // Positioning comes from the caller's class; the layers inside are absolutely placed.
        style={{ overflow: "hidden", touchAction: "none" }}
      >
        <div ref={surface} style={{ position: "absolute", inset: 0 }} />
        <CanvasOverlay
          host={hostObj}
          session={props.session}
          selection={props.selection}
          transformable={Boolean(props.transformable)}
          views={views}
          pose={pose}
          color={props.selectionColor ?? LIME}
          halo={props.haloColor ?? INK}
        />
      </div>
    );
  },
);
