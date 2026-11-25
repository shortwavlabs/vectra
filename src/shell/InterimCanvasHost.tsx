// INTERIM canvas host (G-UI). Implements the agreed CanvasHostProps / CanvasHostHandle
// (src/canvas-host/types.ts) without a renderer: the document is shown as a preview-class SVG
// produced by an export job and displayed as an <img>, with selection outlines from the
// derived path bounds and bounding-box hit testing. It is replaced by the G-R0 renderer host at
// G-R1. It only reads the document; selection is reported to the caller.
import {
  type Ref,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  CanvasHostHandle,
  CanvasHostProps,
  CanvasHostState,
  CanvasView,
} from "../canvas-host/types.ts";
import type { DocumentSession, SessionSnapshot } from "../document/session.ts";
import { type Box, hitTestBoxes, worldBounds } from "./document.ts";

/** Renders the session's current document to SVG bytes (a preview-class export job). */
export type RenderSvg = (session: DocumentSession) => Promise<Uint8Array>;

export interface InterimCanvasHostProps extends CanvasHostProps {
  ref?: Ref<CanvasHostHandle>;
  renderSvg: RenderSvg | null;
}

const MARGIN = 32;
const noSubscribe = () => () => {};
const noSnapshot = () => null;

export function InterimCanvasHost({ ref, ...p }: InterimCanvasHostProps) {
  const { session, selection, renderSvg } = p;
  const snap: SessionSnapshot | null = useSyncExternalStore(
    session?.subscribe ?? noSubscribe,
    session?.getSnapshot ?? noSnapshot,
  );
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setViewState] = useState<CanvasView>({ scale: 1, tx: 0, ty: 0 });
  const [image, setImage] = useState<{ url: string; revision: number } | null>(null);
  const fitted = useRef<DocumentSession | null>(null);
  // Latest props, for effects and handlers (callbacks need not be stable).
  const props = useRef(p);
  useLayoutEffect(() => {
    props.current = p;
  });

  const report = (s: CanvasHostState) => props.current.onStateChange?.(s);
  const setView = (v: CanvasView) => {
    setViewState(v);
    props.current.onViewChange?.(v);
  };
  const artboard = snap?.state.artboard;
  const fit = () => {
    if (!artboard || !size.w || !size.h) return;
    const scale = Math.max(
      0.01,
      Math.min((size.w - 2 * MARGIN) / artboard.width, (size.h - 2 * MARGIN) / artboard.height),
    );
    setView({
      scale,
      tx: (size.w - artboard.width * scale) / 2,
      ty: (size.h - artboard.height * scale) / 2,
    });
  };
  const zoomAbout = (factor: number, cx: number, cy: number) => {
    const scale = Math.min(64, Math.max(0.02, view.scale * factor));
    const f = scale / view.scale;
    setView({ scale, tx: cx - (cx - view.tx) * f, ty: cy - (cy - view.ty) * f });
  };

  useImperativeHandle(ref, () => ({
    fitToView: fit,
    zoomBy: (f) => zoomAbout(f, size.w / 2, size.h / 2),
    setView,
  }));

  useEffect(() => {
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: e!.contentRect.width, h: e!.contentRect.height }),
    );
    ro.observe(viewport.current!);
    return () => ro.disconnect();
  }, []);
  // Fit once per document, as soon as the viewport has a size.
  useEffect(() => {
    if (session && fitted.current !== session && size.w > 0 && size.h > 0) {
      fitted.current = session;
      fit();
    }
  });

  // One preview image per document revision (debounced; superseded results are dropped).
  const revision = snap?.revision ?? 0;
  useEffect(() => {
    if (!session || !renderSvg) return report({ kind: "empty" });
    let live = true;
    report({ kind: "rendering", documentRevision: revision });
    const t = setTimeout(() => {
      renderSvg(session).then(
        (bytes) => {
          if (!live) return;
          const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/svg+xml" });
          setImage({ url: URL.createObjectURL(blob), revision });
          report({ kind: "ready", documentRevision: revision, host: "worker" });
        },
        (e: unknown) => {
          if (!live) return;
          report({
            kind: "error",
            code: (e as { code?: string }).code ?? "render_failed",
            message: e instanceof Error ? e.message : String(e),
          });
        },
      );
    }, 30);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [session, renderSvg, revision]);
  useEffect(() => {
    if (image) return () => URL.revokeObjectURL(image.url);
  }, [image]);

  // Wheel pans; Ctrl/Cmd + wheel (and trackpad pinch) zooms about the pointer.
  useEffect(() => {
    const el = viewport.current!;
    const onWheel = (e: WheelEvent) => {
      if (!session) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey)
        zoomAbout(Math.exp(-e.deltaY / 200), e.clientX - r.left, e.clientY - r.top);
      else setView({ ...view, tx: view.tx - e.deltaX, ty: view.ty - e.deltaY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const s = snap?.state;
  const toCss = (b: Box) => ({
    left: b.x * view.scale + view.tx,
    top: b.y * view.scale + view.ty,
    width: b.width * view.scale,
    height: b.height * view.scale,
  });

  return (
    <div
      ref={viewport}
      role="region"
      aria-label={p.label ?? "Artwork canvas"}
      aria-describedby="canvas-host-help"
      tabIndex={0}
      data-host="interim"
      className={`overflow-hidden bg-canvas-surround ${p.className ?? "relative"}`}
      onClick={(e) => {
        if (!s || !session) return;
        const r = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - r.left - view.tx) / view.scale;
        const y = (e.clientY - r.top - view.ty) / view.scale;
        const hit = hitTestBoxes(s, session.store, x, y);
        p.onSelect(hit ? [hit] : [], e.shiftKey || e.metaKey || e.ctrlKey ? "toggle" : "replace");
      }}
    >
      <p id="canvas-host-help" className="sr-only">
        Interim preview. Click an object to select it (bounding-box hit test); select with the
        keyboard in the Layers panel.
      </p>
      {s && (
        <div
          className="absolute bg-paper shadow-[3px_5px_12px_rgb(0_0_0/0.45)]"
          style={toCss({ x: 0, y: 0, width: s.artboard.width, height: s.artboard.height })}
          data-testid="artboard"
        >
          {image && renderSvg && (
            <img
              src={image.url}
              alt={`Artwork preview, document revision ${image.revision}`}
              draggable={false}
              className="pointer-events-none block size-full select-none"
              data-revision={image.revision}
              data-testid="canvas-image"
            />
          )}
        </div>
      )}
      {s &&
        session &&
        selection.map((id) => {
          const b = worldBounds(s, session.store, id);
          return (
            b && (
              <div
                key={id}
                aria-hidden="true"
                data-testid="selection-outline"
                className="pointer-events-none absolute border border-primary shadow-[0_0_0_1px_var(--background)]"
                style={toCss(b)}
              />
            )
          );
        })}
    </div>
  );
}
