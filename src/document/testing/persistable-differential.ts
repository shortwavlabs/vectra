// TEST-ONLY differential harness for G-PRJ-0 persistability accounting (AM-3.3). Seeded random
// transactions (the G-DOC-R command mix), undo, redo, keyboard coalescing, commits without
// history and history branching, against an oracle that shares nothing with the incremental
// accounting: it serializes the whole document, re-encodes every geometry record and reads
// every embedded source. Every accepted state must agree to the byte and lie within the
// session's limits; every rejected transaction must leave the session exactly as it was.
// Shared by src/persistence/persistable-differential.test.ts and
// scripts/g-prj-0/persistability-corpus.mjs (the broader corpus, with a committed record).
// Node-importable: no import.meta.glob.

import { canonicalJsonBytes } from "../../persistence/canonical-json.ts";
import { documentJson } from "../../persistence/document-json.ts";
import { MANIFEST_BYTES, MARK_DIGITS } from "../../persistence/persistable.ts";
import type { Command } from "../commands.ts";
import { GeometryStore } from "../geometry-store.ts";
import { DEFAULT_DOC_LIMITS } from "../invariants.ts";
import { createDocument, DocumentError } from "../model.ts";
import { DocumentSession, type ValidationMode } from "../session.ts";
import { randomCommand } from "./incremental-differential.ts";
import { TEST_PROVENANCE } from "./provenance.ts";
import { randomPacket, rng, type Rng, syntheticPacket } from "./synthetic.ts";

export interface OracleSizes {
  documentBytes: number;
  body: number;
  geometryBytes: number;
  sourceBytes: number;
  sections: number;
  totalBytes: number;
}
const digits = (n: number) => String(n).length;

/** The container's sizes for the session's current state, by full serialization. */
export function oracleSizes(session: DocumentSession): OracleSizes {
  const s = session.state;
  const doc = canonicalJsonBytes(documentJson(s, session.nextId, session.store.nextChunkId));
  const chunks = [...session.derivedOf(s)!.chunks.keys()];
  let geometryBytes = 0;
  for (const id of chunks) geometryBytes += session.store.encodeRecord(id).length;
  let sourceBytes = 0;
  let embedded = 0;
  for (const a of s.sourceAssetsById.values())
    if (a.embedded) {
      sourceBytes += session.sourceBytes(a.id)!.length;
      embedded++;
    }
  return {
    documentBytes: doc.length,
    body: doc.length - digits(session.nextId) - digits(session.store.nextChunkId),
    geometryBytes,
    sourceBytes,
    sections: 2 + chunks.length + embedded,
    totalBytes: MANIFEST_BYTES + doc.length + geometryBytes + sourceBytes,
  };
}

export interface PersistDifferentialSummary {
  seed: number;
  transactions: number;
  accepted: number;
  rejected: number;
  rejectedByCode: Record<string, number>;
  undos: number;
  redos: number;
  coalesced: number;
  withoutHistory: number;
  branches: number;
  checks: number;
  maxDocumentBytes: number;
  disagreements: string[];
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
/** A minimal PNG the intake sniffer accepts (signature, IHDR size, IDAT marker), `n` bytes. */
export function tinyPng(w: number, h: number, n = 64, salt = 0): Uint8Array {
  const b = new Uint8Array(Math.max(n, 48));
  b.set([...PNG_SIG, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  b.set([0, 0, 0, 0, 0x49, 0x44, 0x41, 0x54], 33);
  b[b.length - 1] = salt & 0xff;
  return b;
}

const NAMES = ["", "a", "é✓", 'q"u\\o\n', "\u{1F600}x", "z".repeat(200), "layer 10"];

function episode(r: Rng, validation: ValidationMode): DocumentSession {
  const session = new DocumentSession(new GeometryStore(), {
    state: createDocument({ documentId: `pd-${r.int(1000)}`, width: 512, height: 512 }),
    // A start just below a digit rollover of nextId in some episodes (9 → 10, 99 → 100, ...).
    nextId: r.pick([1, 1, 8, 98, 998, 999_999_999_998]),
    limits: { ...DEFAULT_DOC_LIMITS, maxAnchors: r.pick([400, 20_000, 1_000_000]) },
    history: { maxEntries: 2 + r.int(30), maxBytes: 128 * 2 ** 20 },
    validation,
  });
  for (let i = 1 + r.int(3); i > 0; i--)
    try {
      session.dispatch({
        type: "commitTrace",
        provenance: TEST_PROVENANCE,
        packet: randomPacket(r),
      });
    } catch (e) {
      if (!(e instanceof DocumentError)) throw e;
    }
  if (r.bool(0.1))
    try {
      session.dispatch({
        type: "commitTrace",
        provenance: TEST_PROVENANCE,
        packet: syntheticPacket({
          paths: 600 + r.int(1200),
          anchorsPerPath: 2,
          seed: r.int(2 ** 31),
        }),
      });
    } catch (e) {
      if (!(e instanceof DocumentError)) throw e;
    }
  return session;
}

/** Tight limits for a third of the episodes, so transactions cross every persistence limit. */
function tighten(r: Rng, session: DocumentSession): void {
  const info = session.persistInfo();
  session.setPersistLimits({
    ...session.persistLimits,
    maxDocumentBytes: info.documentBound + r.int(3000),
    maxSections: info.sections + r.int(3),
    sessionBudget: info.totalBound + r.int(40_000),
  });
}

/**
 * Runs `transactions` steps from `seed`. `checkEvery` sets how often an accepted state is
 * compared with the full oracle (1 = every step). Async only for the occasional real
 * container serialization (`saveEvery`), whose declared sizes must match too.
 */
export async function runPersistDifferential(o: {
  seed: number;
  transactions: number;
  checkEvery?: number;
  saveEvery?: number;
  validation?: ValidationMode;
  save?: (s: DocumentSession) => Promise<{ total: number; sections: number; document: number }>;
}): Promise<PersistDifferentialSummary> {
  const r = rng(o.seed);
  const out: PersistDifferentialSummary = {
    seed: o.seed,
    transactions: o.transactions,
    accepted: 0,
    rejected: 0,
    rejectedByCode: {},
    undos: 0,
    redos: 0,
    coalesced: 0,
    withoutHistory: 0,
    branches: 0,
    checks: 0,
    maxDocumentBytes: 0,
    disagreements: [],
  };
  const validation = o.validation ?? "incremental";
  let session = episode(r, validation);
  let undoneSinceEdit = false;
  const check = async (i: number, label: string) => {
    const info = session.persistInfo();
    const want = oracleSizes(session);
    out.checks++;
    out.maxDocumentBytes = Math.max(out.maxDocumentBytes, want.documentBytes);
    const got = {
      documentBytes: info.documentBytes,
      body: info.body,
      geometryBytes: info.geometryBytes,
      sourceBytes: info.sourceBytes,
      sections: info.sections,
      totalBytes: info.totalBytes,
    };
    if (JSON.stringify(got) !== JSON.stringify(want))
      out.disagreements.push(
        `#${i} ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`,
      );
    const L = session.persistLimits;
    if (
      want.body + 2 * MARK_DIGITS > L.maxDocumentBytes ||
      want.sections > L.maxSections ||
      want.totalBytes - want.documentBytes + want.body + 2 * MARK_DIGITS > L.sessionBudget
    )
      out.disagreements.push(`#${i} ${label}: a published state exceeds a persistence limit`);
    if (o.save && o.saveEvery && i % o.saveEvery === 0) {
      const saved = await o.save(session);
      if (
        saved.total !== want.totalBytes ||
        saved.sections !== want.sections ||
        saved.document !== want.documentBytes
      )
        out.disagreements.push(`#${i} ${label}: container sizes ${JSON.stringify(saved)}`);
    }
  };

  for (let i = 0; i < o.transactions; i++) {
    if (i % 60 === 0) {
      session = episode(r, validation);
      if (r.bool(0.33)) tighten(r, session);
      undoneSinceEdit = false;
    }
    const roll = r.int(100);
    if (roll < 10) {
      if (session.undo()) {
        out.undos++;
        undoneSinceEdit = true;
      }
    } else if (roll < 20) {
      if (session.redo()) out.redos++;
    } else {
      const n = 1 + (r.bool(0.8) ? 0 : r.int(3));
      const commands: Command[] = [];
      for (let k = 0; k < n; k++) commands.push(randomCommand(r, session.state));
      if (r.bool(0.08)) {
        const id = [...session.state.nodesById.keys()][0];
        if (id) commands.push({ type: "rename", id, name: r.pick(NAMES) });
      }
      if (r.bool(0.04))
        try {
          await session.attachSource(tinyPng(1 + r.int(64), 1 + r.int(64), 48 + r.int(4000), i), {
            embedded: r.bool(0.7),
          });
        } catch (e) {
          if (!(e instanceof DocumentError)) throw e;
          out.rejected++;
          out.rejectedByCode[e.code] = (out.rejectedByCode[e.code] ?? 0) + 1;
        }
      const coalesceKey = r.bool(0.1) ? "typing" : undefined;
      const withoutHistory = r.bool(0.02);
      const before = {
        state: session.state,
        revision: session.getSnapshot().revision,
        nextId: session.nextId,
        chunks: session.store.chunkIds().sort().join(),
      };
      try {
        const revision = session.dispatch(commands, {
          ...(coalesceKey ? { coalesceKey } : {}),
          ...(withoutHistory ? { withoutHistory } : {}),
        });
        if (revision !== before.revision) {
          out.accepted++;
          if (coalesceKey) out.coalesced++;
          if (withoutHistory) out.withoutHistory++;
          if (undoneSinceEdit) out.branches++;
          undoneSinceEdit = false;
        }
      } catch (e) {
        if (!(e instanceof DocumentError)) throw e;
        out.rejected++;
        out.rejectedByCode[e.code] = (out.rejectedByCode[e.code] ?? 0) + 1;
        if (
          session.state !== before.state ||
          session.getSnapshot().revision !== before.revision ||
          session.nextId !== before.nextId ||
          session.store.chunkIds().sort().join() !== before.chunks
        )
          out.disagreements.push(`#${i}: rejected ${e.code} transaction changed the session`);
        // Still checked below: a refused commit may have advanced nextChunkId (C1 gaps).
      }
    }
    if (i % (o.checkEvery ?? 1) === 0) await check(i, "step");
  }
  return out;
}
