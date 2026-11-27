// TEST-ONLY: the documentSchemaVersion 1 encoder, exactly as production wrote it until G-PRJ-0
// (C10 r1). Production now writes v2 and still reads v1. Kept as an independent oracle: two
// states are semantically equal when their v1 encodings are equal, whichever encoding they
// were read from, and the historical v1 golden containers can still be re-derived.
import { canonicalJsonBytes } from "../../persistence/canonical-json.ts";
import { MAGIC } from "../../persistence/container.ts";
import { type DocState, idNumber } from "../model.ts";
import { type DocumentSession, sha256Hex } from "../session.ts";

type J = Record<string, unknown>;

/**
 * The codec-`none` container the pre-G-PRJ-0 writer produced for the session's current state:
 * a documentSchemaVersion 1 manifest and document, then geometry and embedded sources in the
 * fixed order (C7). Used to re-derive the historical v1 goldens and frozen hashes, which stay
 * as they were (AM-3.2: historical evidence is preserved, never overwritten).
 */
export async function saveContainerV1(session: DocumentSession): Promise<Uint8Array> {
  const state = session.state;
  const byNumber = (a: string, b: string) => idNumber(a) - idNumber(b);
  const manifest = { app: "vectra", formatVersion: 1, documentSchemaVersion: 1, packetVersion: 1 };
  const sections = [
    { id: "manifest", kind: "manifest", data: canonicalJsonBytes(manifest) },
    {
      id: "document",
      kind: "document",
      data: canonicalJsonBytes(documentJsonV1(state, session.nextId, session.store.nextChunkId)),
    },
    ...[...session.derivedOf(state)!.chunks.keys()]
      .sort(byNumber)
      .map((id) => ({ id, kind: "geometry", data: session.store.encodeRecord(id) })),
    ...[...state.sourceAssetsById.values()]
      .filter((a) => a.embedded)
      .map((a) => a.id)
      .sort(byNumber)
      .map((id) => ({ id, kind: "source", data: session.sourceBytes(id)! })),
  ];
  const entries = [];
  let offset = 0;
  for (const s of sections) {
    const len = s.data.length;
    entries.push({
      id: s.id,
      kind: s.kind,
      codec: "none",
      offset,
      length: len,
      uncompressedLength: len,
      sha256: await sha256Hex(s.data),
    });
    offset += len;
  }
  const header = canonicalJsonBytes({ formatVersion: 1, sections: entries });
  const out = new Uint8Array(12 + header.length + offset);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(8, header.length, true);
  out.set(header, 12);
  let pos = 12 + header.length;
  for (const s of sections) {
    out.set(s.data, pos);
    pos += s.data.length;
  }
  return out;
}

/** The canonical JSON value of a document state in v1 form (optional members omitted). */
export function documentJsonV1(s: DocState, nextId: number, nextChunkId: number): J {
  const nodes: J = {};
  for (const [k, n] of s.nodesById) nodes[k] = { ...n, localTransform: [...n.localTransform] };
  return {
    documentSchemaVersion: 1,
    documentId: s.documentId,
    nextId,
    nextChunkId,
    artboard: { ...s.artboard },
    orderedRootIds: [...s.orderedRootIds],
    nodesById: nodes,
    stylesById: Object.fromEntries(s.stylesById),
    paletteById: Object.fromEntries(s.paletteById),
    sourceAssetsById: Object.fromEntries(s.sourceAssetsById),
  };
}
