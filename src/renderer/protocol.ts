// Render-worker protocol v2 (C5 r2): handshake identity like the compute worker, generation on
// every message, and render revisions on snapshots and frames so stale frames are rejected.
import type { Affine, Camera, RenderPacket, RenderSnapshot } from "./snapshot.ts";

export const RENDER_PROTOCOL_VERSION = 2;

export interface RenderIdentity {
  readonly protocolVersion: number;
  readonly buildId: string;
  readonly packetVersion: number;
}

export interface Surface {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly dpr: number;
  /** CSS colours of the area outside the artboard and of a transparent artboard. */
  readonly workspace: string;
  readonly paper: string;
  /** Selection outline colour, drawn over a darker halo so it reads on any artwork. */
  readonly selection?: string;
  readonly halo?: string;
}

export type RenderRequest =
  | { type: "init"; generation: number; canvas: OffscreenCanvas; surface: Surface }
  | {
      type: "snapshot";
      generation: number;
      snapshot: RenderSnapshot;
      /** Render copies of chunks the worker does not hold (transferred). */
      packets: RenderPacket[];
      /** Chunks the worker may drop. */
      releaseChunks: string[];
    }
  /** A selection change only: the draw list is unchanged, so it is not sent again. */
  | { type: "selection"; generation: number; renderRevision: number; selection: number[] }
  | { type: "camera"; generation: number; camera: Camera }
  | { type: "gesture"; generation: number; phase: "start" | "end" }
  | { type: "resize"; generation: number; surface: Surface }
  /** A transform drag (G-R1): display only, the document is not touched. `start` names the
   *  moving draw items of `renderRevision` and their clips; `move` poses them with a
   *  document-space affine; `end` keeps the last pose on screen until the next snapshot's exact
   *  frame is complete; `cancel` restores the exact frame. */
  | {
      type: "drag";
      generation: number;
      phase: "start";
      renderRevision: number;
      items: number[];
      clips: DragClip[];
    }
  | { type: "drag"; generation: number; phase: "move"; matrix: Affine }
  | { type: "drag"; generation: number; phase: "end" | "cancel" }
  | { type: "debug-crash"; generation: number }
  | { type: "release"; generation: number };

/** A moving item's clips, in document space: `fixed` is owned outside the moving subtree (it
 *  stays put), `moving` inside it (it moves with the item). */
export interface DragClip {
  readonly fixed: ClipRect | null;
  readonly moving: ClipRect | null;
}
export interface ClipRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export type FrameKind = "interaction" | "exact";

export interface FrameInfo {
  readonly renderRevision: number;
  /** The camera the frame was drawn with (exact frames are evidence only for their camera). */
  readonly camera: Camera;
  readonly kind: FrameKind;
  /** Main/worker time spent on this frame: Path2D construction (`buildMs`) plus drawing. */
  readonly ms: number;
  readonly buildMs: number;
  /** Items drawn (after viewport culling) and Path2D objects built for this frame. */
  readonly drawn: number;
  readonly built: number;
  /** Progressive frames: the frame is a prefix of the exact frame. */
  readonly complete: boolean;
  /** A drag frame: composited from layer caches, or drawn live (over the layer budget). */
  readonly drag?: "layers" | "live";
}

export type RenderResponse =
  | ({ type: "ready"; workerRaf: boolean } & RenderIdentity)
  | ({ type: "frame"; generation: number } & FrameInfo)
  | {
      type: "stats";
      generation: number;
      chunks: number;
      paths: number;
      bytes: number;
      /** Drag layer caches currently held: count and backing-store bytes. */
      dragLayers?: number;
      dragLayerBytes?: number;
    }
  | { type: "error"; generation: number; code: string; message: string; fatal: boolean };
