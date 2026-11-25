// The document session: a framework-neutral store (useSyncExternalStore-compatible
// subscribe/getSnapshot) over immutable DocStates, with transactions, monotonic revisions,
// bounded undo/redo, keyboard coalescing, chunk ownership and state-identity dirty tracking.

import { sniffImage } from "../vectorization/intake.ts";
import { applyCommand, type Command, type CommandContext } from "./commands.ts";
import type { GeometryStore, OwnerKind } from "./geometry-store.ts";
import {
  DEFAULT_DOC_LIMITS,
  type DocLimits,
  type StateDerived,
  validateState,
} from "./invariants.ts";
import {
  type AssetId,
  type ChunkId,
  type DocState,
  DocumentError,
  IdAllocator,
  type NodeId,
  type SourceMime,
} from "./model.ts";

export interface HistoryLimits {
  maxEntries: number;
  /** History-only bytes: chunks attributed to `history` plus history-only source bytes. */
  maxBytes: number;
}
export const DEFAULT_HISTORY_LIMITS: Readonly<HistoryLimits> = Object.freeze({
  maxEntries: 100,
  maxBytes: 128 * 2 ** 20,
});

export interface SessionSnapshot {
  readonly state: DocState;
  readonly revision: number;
  readonly dirty: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Visible truncation: some history was evicted by the budget. */
  readonly historyTruncated: boolean;
  /** Document anchors, counted per reference. */
  readonly anchors: number;
}

export interface SessionOptions {
  state: DocState;
  /** High-water mark for node IDs (C1); must exceed every ID in `state`. */
  nextId?: number;
  limits?: DocLimits;
  history?: HistoryLimits;
  /** Keyboard coalescing window (A13; provisional until G-UI qualifies it). */
  coalesceWindowMs?: number;
  now?: () => number;
  /** Source bytes for the state's embedded/attached assets. */
  sources?: ReadonlyMap<AssetId, Uint8Array>;
}

export interface DispatchOptions {
  /** Consecutive commits with the same key within the window form one history entry. */
  coalesceKey?: string;
  /** Explicit confirmation to commit a change that cannot fit in the history budget. */
  withoutHistory?: boolean;
}

const MIME: Record<string, SourceMime> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class DocumentSession {
  readonly store: GeometryStore;
  readonly limits: DocLimits;
  readonly historyLimits: HistoryLimits;
  #state: DocState;
  readonly #derived = new WeakMap<DocState, StateDerived>();
  #past: DocState[] = [];
  #future: DocState[] = [];
  #saved: DocState | null;
  #revision = 1;
  #nextId: number;
  #truncated = false;
  #coalesce: { key: string; at: number } | null = null;
  readonly #coalesceWindowMs: number;
  readonly #now: () => number;
  readonly #listeners = new Set<() => void>();
  readonly #sources = new Map<AssetId, Uint8Array>();
  #snapshot: SessionSnapshot;

  /** The initial state is validated, owned as `document`, and counts as saved (clean). */
  constructor(store: GeometryStore, o: SessionOptions) {
    this.store = store;
    this.limits = o.limits ?? DEFAULT_DOC_LIMITS;
    this.historyLimits = o.history ?? DEFAULT_HISTORY_LIMITS;
    this.#coalesceWindowMs = o.coalesceWindowMs ?? 1000;
    this.#now = o.now ?? (() => performance.now());
    const d = validateState(o.state, store, this.limits);
    this.#nextId = o.nextId ?? d.maxIdNumber + 1;
    if (!(Number.isSafeInteger(this.#nextId) && this.#nextId > d.maxIdNumber))
      throw new DocumentError("invariant", "nextId must exceed every node ID");
    for (const [id, bytes] of o.sources ?? []) this.#sources.set(id, bytes);
    this.#derived.set(o.state, d);
    this.#state = o.state;
    this.#saved = o.state;
    this.#own(o.state, "document", 1);
    store.settle();
    this.#snapshot = this.#makeSnapshot();
  }

  // --- external store -----------------------------------------------------------------------
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  getSnapshot = (): SessionSnapshot => this.#snapshot;

  get nextId(): number {
    return this.#nextId;
  }
  get state(): DocState {
    return this.#state;
  }
  /** Read-only view of the undo (`past`, oldest first) and redo stacks. */
  historyStates(): { past: readonly DocState[]; future: readonly DocState[] } {
    return { past: [...this.#past], future: [...this.#future] };
  }
  derivedOf(state: DocState): StateDerived | undefined {
    return this.#derived.get(state);
  }
  sourceBytes(assetId: AssetId): Uint8Array | undefined {
    return this.#sources.get(assetId);
  }

  #makeSnapshot(): SessionSnapshot {
    return Object.freeze({
      state: this.#state,
      revision: this.#revision,
      dirty: this.#state !== this.#saved,
      canUndo: this.#past.length > 0,
      canRedo: this.#future.length > 0,
      historyTruncated: this.#truncated,
      anchors: this.#derived.get(this.#state)!.anchors,
    });
  }
  #emit(): void {
    this.#revision++;
    this.#snapshot = this.#makeSnapshot();
    for (const l of [...this.#listeners]) l();
  }

  #own(s: DocState, kind: OwnerKind, delta: 1 | -1): void {
    for (const id of this.#derived.get(s)!.chunks.keys())
      if (delta > 0) this.store.retain(id, { kind });
      else this.store.release(id, { kind });
  }

  // --- transactions -------------------------------------------------------------------------
  /**
   * Runs one transaction (one or several commands). On any error the document, the revision,
   * `nextId` and the store's live chunks are unchanged, and chunks committed by the failed
   * transaction are freed. The store's `nextChunkId` may have advanced: chunk IDs are never
   * reused, and C1 allows gaps. Returns the new revision.
   */
  dispatch(commands: Command | readonly Command[], o: DispatchOptions = {}): number {
    const list = Array.isArray(commands) ? (commands as readonly Command[]) : [commands as Command];
    const prev = this.#state;
    const ids = new IdAllocator(this.#nextId);
    const store = this.store;
    const ctx: CommandContext = { store, ids, commit: (p) => store.commit(p) };
    let next = prev;
    let d: StateDerived;
    try {
      for (const c of list) next = applyCommand(next, c, ctx);
      if (next === prev) {
        store.settle();
        return this.#revision; // a no-op is not a transaction
      }
      d = validateState(next, store, this.limits);
      if (!o.withoutHistory) {
        const entry = this.#entryBytes(prev, d);
        if (entry > this.historyLimits.maxBytes)
          throw new DocumentError(
            "history_budget",
            `this change would retain ${entry} history bytes (budget ${this.historyLimits.maxBytes}); confirm to commit without history`,
          );
      }
    } catch (e) {
      store.settle();
      throw e;
    }
    // Publish: nothing below throws.
    this.#derived.set(next, d);
    const now = this.#now();
    const coalesce =
      o.coalesceKey !== undefined &&
      this.#coalesce?.key === o.coalesceKey &&
      now - this.#coalesce.at <= this.#coalesceWindowMs &&
      this.#past.length > 0;
    this.#own(next, "document", 1);
    this.#own(prev, "document", -1);
    if (o.withoutHistory) this.#dropHistory();
    if (!coalesce && !o.withoutHistory) {
      this.#own(prev, "history", 1);
      this.#past.push(prev);
    } else if (prev === this.#saved) this.#saved = null; // prev is unreachable from now on
    for (const s of this.#future) this.#own(s, "history", -1);
    this.#future = [];
    this.#coalesce = o.coalesceKey === undefined ? null : { key: o.coalesceKey, at: now };
    this.#nextId = ids.next;
    this.#state = next;
    this.#enforceBudget();
    this.#gcSources();
    store.settle();
    this.#emit();
    return this.#revision;
  }

  /** Bytes the pushed entry alone would hold as history-only (RFC §7 "cannot fit"). */
  #entryBytes(prev: DocState, d: StateDerived): number {
    let n = 0;
    for (const id of this.#derived.get(prev)!.chunks.keys()) {
      if (d.chunks.has(id)) continue;
      const c = this.store.ownerCounts(id);
      if (c.snapshot === 0 && c.job === 0 && c.history === 0) n += this.store.cost(id);
    }
    return n;
  }

  #dropHistory(): void {
    for (const s of [...this.#past, ...this.#future]) {
      this.#own(s, "history", -1);
      if (s === this.#saved) this.#saved = null;
    }
    if (this.#past.length || this.#future.length) this.#truncated = true;
    this.#past = [];
    this.#future = [];
  }

  /** Oldest whole transactions first; the current document is never evicted. */
  #enforceBudget(): void {
    const { maxEntries, maxBytes } = this.historyLimits;
    while (this.#past.length + this.#future.length > maxEntries || this.historyBytes() > maxBytes) {
      const s = this.#past.length ? this.#past.shift()! : this.#future.shift()!;
      if (!s) break;
      this.#own(s, "history", -1);
      if (s === this.#saved) this.#saved = null;
      this.#truncated = true;
    }
  }

  /** Breaks the keyboard coalescing chain (focus change). */
  endCoalescing(): void {
    this.#coalesce = null;
  }

  undo(): boolean {
    const target = this.#past.pop();
    if (!target) return false;
    this.#swap(target, this.#future);
    return true;
  }
  redo(): boolean {
    const target = this.#future.pop();
    if (!target) return false;
    this.#swap(target, this.#past);
    return true;
  }
  #swap(target: DocState, pushTo: DocState[]): void {
    const cur = this.#state;
    this.#own(target, "document", 1);
    this.#own(target, "history", -1);
    this.#own(cur, "history", 1);
    this.#own(cur, "document", -1);
    pushTo.push(cur);
    this.#state = target;
    this.#coalesce = null;
    this.#enforceBudget();
    this.store.settle();
    this.#emit();
  }

  /** C7: `savedState = currentState` after a save (or the state that was saved). */
  markSaved(state: DocState = this.#state): void {
    this.#saved = state;
    this.#snapshot = this.#makeSnapshot();
    for (const l of [...this.#listeners]) l();
  }

  // --- sources ------------------------------------------------------------------------------
  /** Attaches a source image: signature sniffed, SHA-256 digest computed, then one transaction. */
  async attachSource(bytes: Uint8Array, o: { embedded: boolean; name?: string }): Promise<NodeId> {
    const sniffed = sniffImage(bytes); // throws IntakeError on a bad signature
    const owned = bytes.slice();
    const digest = await sha256Hex(owned);
    const assetId = `ast_${this.#nextId}`;
    this.#sources.set(assetId, owned);
    try {
      this.dispatch({
        type: "attachSource",
        asset: {
          digest,
          mime: MIME[sniffed.format]!,
          width: sniffed.width,
          height: sniffed.height,
          embedded: o.embedded,
        },
        ...(o.name === undefined ? {} : { name: o.name }),
      });
    } catch (e) {
      this.#sources.delete(assetId);
      throw e;
    }
    return this.#state.orderedRootIds[0]!;
  }

  #sourceOwners(): { document: Set<AssetId>; history: Set<AssetId> } {
    const document = new Set(this.#state.sourceAssetsById.keys());
    const history = new Set<AssetId>();
    for (const s of [...this.#past, ...this.#future])
      for (const a of s.sourceAssetsById.keys()) if (!document.has(a)) history.add(a);
    return { document, history };
  }
  #gcSources(): void {
    const { document, history } = this.#sourceOwners();
    for (const a of this.#sources.keys())
      if (!document.has(a) && !history.has(a)) this.#sources.delete(a);
  }
  /** Source bytes by owner (ledger, RFC §11.3). */
  sourceByteCounts(): { document: number; history: number } {
    const { document, history } = this.#sourceOwners();
    let doc = 0;
    let hist = 0;
    for (const [a, b] of this.#sources) {
      if (document.has(a)) doc += b.byteLength;
      else if (history.has(a)) hist += b.byteLength;
    }
    return { document: doc, history: hist };
  }
  /** History-only bytes (RFC §7 budget): chunk bytes attributed to history + history-only sources. */
  historyBytes(): number {
    return this.store.bytes().byOwnerKind.history + this.sourceByteCounts().history;
  }
}

// --- narrow selectors (stable references over immutable state) ---------------------------------
export const selectState = (s: SessionSnapshot) => s.state;
export const selectNode = (s: SessionSnapshot, id: NodeId) => s.state.nodesById.get(id);
export const selectRootIds = (s: SessionSnapshot) => s.state.orderedRootIds;
export const selectDirty = (s: SessionSnapshot) => s.dirty;
export const selectChunkIds = (session: DocumentSession): ChunkId[] => [
  ...(session.derivedOf(session.state)?.chunks.keys() ?? []),
];
