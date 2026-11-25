// Resource-ledger skeleton (RFC-002 §11.3): store bytes by owner kind, history bytes and
// source bytes from the session, plus registration hooks for components that report their own
// memory (workers, renderer, caches). Interfaces only: no workers are created here.

import type { OwnerKind } from "./geometry-store.ts";
import type { DocumentSession } from "./session.ts";

export type ReporterKind =
  | "decoded-cache"
  | "compute-worker"
  | "job-copies"
  | "render-worker"
  | "path2d-cache"
  | "display-cache"
  | "export-buffer";

/** A component that reports its own bytes (e.g. worker-reported WASM memory). */
export interface LedgerReporter {
  readonly id: string;
  readonly kind: ReporterKind;
  bytes(): number;
}

export interface LedgerSnapshot {
  readonly store: {
    readonly byOwnerKind: Readonly<Record<OwnerKind, number>>;
    readonly total: number;
  };
  /** RFC §7 budget quantity: history-only chunk bytes plus history-only source bytes. */
  readonly historyBytes: number;
  readonly sources: { readonly document: number; readonly history: number };
  readonly reporters: Readonly<
    Record<string, { readonly kind: ReporterKind; readonly bytes: number }>
  >;
  readonly total: number;
}

export class ResourceLedger {
  readonly #session: DocumentSession;
  readonly #reporters = new Map<string, LedgerReporter>();

  constructor(session: DocumentSession) {
    this.#session = session;
  }

  /** Registers a reporter; returns its unregister function. */
  register(r: LedgerReporter): () => void {
    if (this.#reporters.has(r.id)) throw new Error(`ledger reporter ${r.id} already registered`);
    this.#reporters.set(r.id, r);
    return () => this.#reporters.delete(r.id);
  }

  snapshot(): LedgerSnapshot {
    const store = this.#session.store.bytes();
    const sources = this.#session.sourceByteCounts();
    const reporters: Record<string, { kind: ReporterKind; bytes: number }> = {};
    let total = store.total + sources.document + sources.history;
    for (const r of this.#reporters.values()) {
      const bytes = r.bytes();
      reporters[r.id] = { kind: r.kind, bytes };
      total += bytes;
    }
    return {
      store,
      historyBytes: store.byOwnerKind.history + sources.history,
      sources,
      reporters,
      total,
    };
  }
}
