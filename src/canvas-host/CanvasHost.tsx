// The G-R0 vector canvas: implements the agreed canvas-host interface (types.ts) over the
// renderer (worker host or disclosed main-thread fallback). Read only: it reports selection
// gestures and never edits the document.
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { DocumentRenderHost } from "./render-host.ts";
import type { CanvasHostHandle, CanvasHostProps } from "./types.ts";

export interface VectorCanvasProps extends CanvasHostProps {
  /** Use the main-thread renderer (engineering toggle). */
  readonly forceMainThread?: boolean;
  readonly paper?: string;
  readonly workspace?: string;
  /** Selection outline and halo colours. */
  readonly selectionColor?: string;
  readonly haloColor?: string;
  /** Engineering access to the host (qualification API). */
  readonly onHost?: (host: DocumentRenderHost | null) => void;
}

const createWorker = () =>
  new Worker(new URL("../renderer/render.worker.ts", import.meta.url), { type: "module" });

const DRAG_PX = 3;

export const VectorCanvas = forwardRef<CanvasHostHandle, VectorCanvasProps>(
  function VectorCanvas(props, ref) {
    const container = useRef<HTMLDivElement>(null);
    const host = useRef<DocumentRenderHost | null>(null);
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
      const el = container.current!;
      const h = new DocumentRenderHost({
        container: el,
        createWorker,
        ...(latest.current.forceMainThread ? { forceMainThread: true } : {}),
        ...(latest.current.paper ? { paper: latest.current.paper } : {}),
        ...(latest.current.workspace ? { workspace: latest.current.workspace } : {}),
        ...(latest.current.selectionColor ? { selection: latest.current.selectionColor } : {}),
        ...(latest.current.haloColor ? { halo: latest.current.haloColor } : {}),
        onState: (s) => latest.current.onStateChange?.(s),
        onView: (v) => latest.current.onViewChange?.(v),
      });
      host.current = h;
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

      // Pointer: drag pans (a camera gesture); a click selects through the hit-test service.
      let down: {
        x: number;
        y: number;
        id: number;
        panning: boolean;
        last: [number, number];
      } | null = null;
      const local = (e: PointerEvent | WheelEvent): [number, number] => {
        const r = el.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
      };
      const onDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        el.setPointerCapture(e.pointerId);
        const p = local(e);
        down = { x: p[0], y: p[1], id: e.pointerId, panning: false, last: p };
      };
      const onMove = (e: PointerEvent) => {
        if (!down || e.pointerId !== down.id) return;
        const p = local(e);
        if (!down.panning && Math.hypot(p[0] - down.x, p[1] - down.y) > DRAG_PX) {
          down.panning = true;
          h.gesture("start");
        }
        if (down.panning) {
          h.panBy(p[0] - down.last[0], p[1] - down.last[1]);
          down.last = p;
        }
      };
      const onUp = (e: PointerEvent) => {
        if (!down || e.pointerId !== down.id) return;
        const d = down;
        down = null;
        if (d.panning) return h.gesture("end");
        const id = h.hitAt(d.x, d.y);
        latest.current.onSelect(id ? [id] : [], e.shiftKey ? "toggle" : "replace");
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
      el.addEventListener("pointercancel", onUp);
      el.addEventListener("wheel", onWheel, { passive: false });
      return () => {
        ro.disconnect();
        dprQuery.removeEventListener("change", measure);
        el.removeEventListener("pointerdown", onDown);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
        el.removeEventListener("wheel", onWheel);
        if (wheelEnd) clearTimeout(wheelEnd);
        latest.current.onHost?.(null);
        h.dispose();
        host.current = null;
      };
    }, []);

    useEffect(() => {
      host.current?.setSession(props.session);
    }, [props.session]);
    useEffect(() => {
      host.current?.setSelection(props.selection);
    }, [props.selection]);

    return (
      <div
        ref={container}
        className={props.className}
        role="img"
        aria-label={props.label ?? "Vector artwork"}
        data-testid="canvas-host"
        // Positioning comes from the caller's class (the canvases inside are absolutely placed).
        style={{ overflow: "hidden", touchAction: "none" }}
      />
    );
  },
);
