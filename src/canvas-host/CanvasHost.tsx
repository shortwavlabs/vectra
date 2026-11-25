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
// Keyboard (G-R1 §9): the canvas is focusable and navigable without a DOM node per object.
// Arrow keys walk the document tree in the Layers panel's order (Up/Down: siblings, Right: into
// a group or layer, Left: its parent; Home/End, PageUp/PageDown jump), Enter or Space selects the
// object under the keyboard cursor (with Shift: toggles it). A polite live region announces the
// object, its position and state; the cursor's box is drawn dashed; the view follows it.
// Keyboard focus is shown by the host's own ring, its last layer (canvas-host.css): the host's
// outline would be painted under the absolutely placed canvases and overlay. It follows the
// browser's :focus-visible (keyboard focus, not a pointer click) and takes no pointer input.
// The preview is display only (layered drag caches in the renderer); release reports one
// transform, which the caller dispatches as one command.
import {
  type CSSProperties,
  forwardRef,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { isContainer, type DocState, type NodeId } from "../document/model.ts";
import type { DocumentSession } from "../document/session.ts";
import type { Affine } from "../renderer/snapshot.ts";
import { type Bounds, DocumentRenderHost } from "./render-host.ts";
import type { CanvasHostHandle, CanvasHostProps, CanvasView } from "./types.ts";
import "./canvas-host.css";

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
  /** Spoken description of a node for keyboard navigation (name, kind, state). */
  readonly describe?: (id: NodeId) => string;
}

/** The siblings of a node in display order (top-most first, as the Layers panel lists them). */
function siblings(s: DocState, parent: NodeId | null): NodeId[] {
  const list =
    parent === null
      ? s.orderedRootIds
      : (() => {
          const n = s.nodesById.get(parent);
          return isContainer(n) ? n.orderedChildIds : [];
        })();
  return [...list].reverse();
}
function parentOf(s: DocState, id: NodeId): NodeId | null {
  for (const n of s.nodesById.values())
    if (isContainer(n) && n.orderedChildIds.includes(id)) return n.id;
  return null;
}

const createWorker = () =>
  new Worker(new URL("../renderer/render.worker.ts", import.meta.url), { type: "module" });

const DRAG_PX = 3;
/** Visually hidden, still announced (the workbench has no utility classes). */
const SR_ONLY = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;
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
  cursor: NodeId | null;
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
  const cb = p.cursor && state.nodesById.has(p.cursor) ? p.host.boundsOf([p.cursor]) : null;
  const cursorBox =
    cb &&
    (() => {
      const [x0, y0] = css(cb.x, cb.y);
      const [x1, y1] = css(cb.x + cb.width, cb.y + cb.height);
      return { left: x0! - 4, top: y0! - 4, width: x1! - x0! + 8, height: y1! - y0! + 8 };
    })();
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
      {cursorBox && (
        <div
          data-testid="keyboard-cursor"
          style={{
            position: "absolute",
            ...cursorBox,
            outline: `2px dashed ${p.color}`,
            boxShadow: `0 0 0 2px ${p.halo}`,
            borderRadius: 2,
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
    const hintId = useId();
    const [hostObj, setHostObj] = useState<DocumentRenderHost | null>(null);
    const [views] = useState(() => store<CanvasView | null>(null));
    const [pose] = useState(() => store<Affine | null>(null));
    // The keyboard cursor belongs to one document (node IDs are per document).
    const [cursorOf, setCursorOf] = useState<{ session: DocumentSession; id: NodeId } | null>(null);
    const cursor = cursorOf && cursorOf.session === props.session ? cursorOf.id : null;
    const [spoken, setSpoken] = useState("");
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

    /** Keyboard navigation over the document tree; announces through the live region. */
    const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const s = props.session?.getSnapshot().state;
      if (!s || e.target !== outer.current || e.altKey || e.ctrlKey || e.metaKey) return;
      const say = (id: NodeId, extra = "") => {
        const sib = siblings(s, parentOf(s, id));
        const what = props.describe?.(id) ?? String(id);
        const selected = props.selection.includes(id) ? ", selected" : "";
        setSpoken(`${what}, ${sib.indexOf(id) + 1} of ${sib.length}${selected}${extra}`);
      };
      const move = (id: NodeId | null | undefined) => {
        if (!id || !props.session) return;
        setCursorOf({ session: props.session, id });
        say(id);
        // Keep the cursor's object in view (centre it when it is outside the viewport).
        const h = host.current;
        const b = h?.boundsOf([id]);
        const r = outer.current!.getBoundingClientRect();
        const c = h?.camera;
        if (h && b && c) {
          const x0 = b.x * c.scale + c.tx;
          const y0 = b.y * c.scale + c.ty;
          const x1 = (b.x + b.width) * c.scale + c.tx;
          const y1 = (b.y + b.height) * c.scale + c.ty;
          if (x1 < 0 || y1 < 0 || x0 > r.width || y0 > r.height)
            h.setView({
              scale: c.scale,
              tx: r.width / 2 - (b.x + b.width / 2) * c.scale,
              ty: r.height / 2 - (b.y + b.height / 2) * c.scale,
            });
        }
      };
      const cur = cursor && s.nodesById.has(cursor) ? cursor : null;
      const start = () => props.selection.find((id) => s.nodesById.has(id)) ?? siblings(s, null)[0];
      const keys = [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Home",
        "End",
        "PageUp",
        "PageDown",
        "Enter",
        " ",
      ];
      if (!keys.includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (!cur) return move(start());
      const sib = siblings(s, parentOf(s, cur));
      const i = sib.indexOf(cur);
      switch (e.key) {
        case "ArrowDown":
          return move(sib[Math.min(sib.length - 1, i + 1)]);
        case "ArrowUp":
          return move(sib[Math.max(0, i - 1)]);
        case "PageDown":
          return move(sib[Math.min(sib.length - 1, i + 10)]);
        case "PageUp":
          return move(sib[Math.max(0, i - 10)]);
        case "Home":
          return move(sib[0]);
        case "End":
          return move(sib.at(-1));
        case "ArrowRight": {
          const n = s.nodesById.get(cur);
          if (isContainer(n) && n.orderedChildIds.length) return move(siblings(s, cur)[0]);
          return say(cur, ", no objects inside");
        }
        case "ArrowLeft":
          return move(parentOf(s, cur) ?? undefined);
        default: {
          // Enter or Space: select (Shift: toggle).
          const mode = e.shiftKey ? "toggle" : "replace";
          props.onSelect([cur], mode);
          const now = mode === "replace" || !props.selection.includes(cur);
          setSpoken(
            `${props.describe?.(cur) ?? cur} ${now ? "selected" : "removed from the selection"}`,
          );
        }
      }
    };
    useEffect(() => {
      host.current?.setSelection(props.selection);
    }, [props.selection]);

    return (
      <div
        ref={outer}
        className={props.className ? `vx-canvas-host ${props.className}` : "vx-canvas-host"}
        role="application"
        aria-roledescription="canvas"
        aria-label={props.label ?? "Vector artwork"}
        aria-describedby={hintId}
        tabIndex={0}
        onKeyDown={onKeyDown}
        data-testid="canvas-host"
        // Positioning comes from the caller's class; the layers inside are absolutely placed.
        style={{ overflow: "hidden", touchAction: "none" }}
      >
        <span id={hintId} hidden>
          Arrow keys move between objects: up and down between siblings, right into a group or
          layer, left to its parent. Enter or Space selects; with Shift, adds or removes.
        </span>
        <span
          role="status"
          aria-live="polite"
          data-testid="canvas-announcer"
          className="sr-only"
          style={SR_ONLY}
        >
          {spoken}
        </span>
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
          cursor={cursor}
        />
        <div
          aria-hidden="true"
          className="vx-canvas-focus-ring"
          data-testid="canvas-focus-ring"
          style={
            {
              "--vx-focus": props.selectionColor ?? LIME,
              "--vx-focus-halo": props.haloColor ?? INK,
            } as CSSProperties
          }
        />
      </div>
    );
  },
);
