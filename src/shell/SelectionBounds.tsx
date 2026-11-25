// The selection's bounds over the canvas, drawn on the main thread from vector data: the box of
// what the selection draws (DocumentRenderHost.boundsOf: visible items, clips owned inside the
// selection), positioned with the camera. Display only; it never edits the document. The camera
// arrives through a small store, so a pan re-renders this box and not the whole workspace.
import { useSyncExternalStore } from "react";
import type { DocumentRenderHost } from "../canvas-host/render-host.ts";
import type { DocState, NodeId } from "../document/model.ts";
import type { ViewStore } from "./view-store.ts";

export function SelectionBounds(p: {
  host: DocumentRenderHost | null;
  /** The document state shown (a new state re-evaluates the bounds). */
  state: DocState | null;
  ids: readonly NodeId[];
  views: ViewStore;
}) {
  const view = useSyncExternalStore(p.views.subscribe, p.views.get);
  if (!p.host || !p.state || !view || p.ids.length === 0) return null;
  const b = p.host.boundsOf(p.ids);
  if (!b) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="selection-bounds"
      data-bounds={`${b.x} ${b.y} ${b.width} ${b.height}`}
      className="pointer-events-none absolute border border-primary shadow-[0_0_0_1px_var(--background)]"
      style={{
        left: b.x * view.scale + view.tx - 1,
        top: b.y * view.scale + view.ty - 1,
        width: b.width * view.scale + 2,
        height: b.height * view.scale + 2,
      }}
    />
  );
}

/** The artboard's on-screen rectangle (invisible): a stable reference for the overlay layer and
 *  for tests that click artboard positions. */
export function ArtboardFrame(p: {
  artboard: { width: number; height: number } | null;
  views: ViewStore;
}) {
  const view = useSyncExternalStore(p.views.subscribe, p.views.get);
  if (!p.artboard || !view) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="artboard"
      className="pointer-events-none absolute"
      style={{
        left: view.tx,
        top: view.ty,
        width: p.artboard.width * view.scale,
        height: p.artboard.height * view.scale,
      }}
    />
  );
}
