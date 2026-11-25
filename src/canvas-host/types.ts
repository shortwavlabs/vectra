// Agreed canvas-host interface between G-R0 (renderer) and G-UI (workspace shell), 2026-11-25.
// G-R0 implements a component with these props and handle; G-UI's shell consumes only these
// types (with its own interim host until the G-R1 integration). This file is identical on both
// branches; change it only by agreement recorded in both gate reports.
//
// Boundary: the canvas only reads the document (snapshots of it). It never commits, edits or
// exports; selection is reported to the caller, which owns it.
import type { NodeId } from "../document/model.ts";
import type { DocumentSession } from "../document/session.ts";

export type CanvasHostState =
  | { readonly kind: "empty" }
  | { readonly kind: "starting" }
  | { readonly kind: "rendering"; readonly documentRevision: number }
  | {
      readonly kind: "ready";
      readonly documentRevision: number;
      /** Where frames are drawn: the render worker, or the disclosed main-thread fallback. */
      readonly host: "worker" | "main-thread";
    }
  | { readonly kind: "recovering"; readonly reason: string }
  | { readonly kind: "error"; readonly code: string; readonly message: string };

/** Document → CSS pixel mapping: x_css = scale · x_doc + tx (same for y). */
export interface CanvasView {
  readonly scale: number;
  readonly tx: number;
  readonly ty: number;
}

export interface CanvasHostProps {
  /** The authoritative document, read only. `null` shows the empty state. */
  readonly session: DocumentSession | null;
  /** Selected node IDs; owned by the caller. */
  readonly selection: readonly NodeId[];
  /** A selection gesture on the canvas: the hit node IDs (empty = deselect). */
  onSelect(ids: readonly NodeId[], mode: "replace" | "toggle"): void;
  onStateChange?(state: CanvasHostState): void;
  onViewChange?(view: CanvasView): void;
  /** Accessible name of the canvas region. */
  readonly label?: string;
  readonly className?: string;
}

/** Imperative commands, through a React ref. */
export interface CanvasHostHandle {
  fitToView(): void;
  /** Zooms about the viewport centre. */
  zoomBy(factor: number): void;
  setView(view: CanvasView): void;
}
