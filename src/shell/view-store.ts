// The canvas camera as a tiny external store: the selection overlay subscribes to it, so a pan
// re-renders the overlay and not the whole workspace.
import type { CanvasView } from "../canvas-host/types.ts";

export interface ViewStore {
  readonly get: () => CanvasView | null;
  readonly set: (view: CanvasView) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

export function createViewStore(): ViewStore {
  let view: CanvasView | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => view,
    set: (v) => {
      view = v;
      for (const l of listeners) l();
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
