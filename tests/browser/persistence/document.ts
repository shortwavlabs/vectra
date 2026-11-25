// Shared by the harness page (browser) and the Playwright specs (Node): one deterministic
// document builder, so engine-vs-Node differences can only come from the engines.
import { GeometryStore } from "../../../src/document/geometry-store.ts";
import {
  type ContainerNode,
  createDocument,
  type DocState,
  type LayerNode,
} from "../../../src/document/model.ts";
import { DocumentSession } from "../../../src/document/session.ts";
import { sceneProvenance } from "../../../src/document/testing/provenance.ts";
import { packetFromScene, type SceneV1 } from "../../../src/geometry/packet/scene.ts";
import { canonicalJson } from "../../../src/persistence/canonical-json.ts";
import { documentJson } from "../../../src/persistence/document-json.ts";

/** circle-bw (tiny), adjacent_colors-limited (palette), thin_strokes-halftone (clip, ~40 KB). */
export const SCENES = ["circle-bw", "adjacent_colors-limited", "thin_strokes-halftone"] as const;
export type SceneTexts = Readonly<Record<(typeof SCENES)[number], string>>;
/** Repository-relative path (the dev server serves the repository root). */
export const scenePath = (name: string) => `src/document/testing/fixtures/${name}.scene.json.raw`;

/**
 * Minimal PNG the intake sniffer accepts (as src/document/review-regressions.test.ts).
 * `salt` changes one byte after the IDAT tag: same type and size, different SHA-256.
 */
export function png(w: number, h: number, salt = 0): Uint8Array {
  const b = new Uint8Array(64);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  b.set([0, 0, 0, 0, 0x49, 0x44, 0x41, 0x54], 33);
  b[50] = salt;
  return b;
}
export const SOURCE_PNG = () => png(64, 64, 7);

const kids = (s: DocState, id: string) => (s.nodesById.get(id) as ContainerNode).orderedChildIds;
const layer = (s: DocState, name: string) =>
  [...s.nodesById.values()].find((n): n is LayerNode => n.kind === "layer" && n.name === name)!;

/** Three traces, then a recolour, a transform, a hidden path, a group and an attached source. */
export async function buildDocument(
  texts: SceneTexts,
  o: { embedded: boolean },
): Promise<DocumentSession> {
  const session = new DocumentSession(new GeometryStore(), {
    state: createDocument({
      documentId: "persistence-qualification",
      width: 256,
      height: 256,
      background: 0xfafafaff,
    }),
  });
  for (const name of SCENES) {
    const scene = JSON.parse(texts[name]) as SceneV1;
    session.dispatch({
      type: "commitTrace",
      packet: packetFromScene(scene),
      provenance: sceneProvenance(scene, name),
      name,
    });
  }
  const s = session.state;
  const limited = layer(s, "adjacent_colors-limited");
  const paths = kids(s, kids(s, limited.id)[0]!);
  session.dispatch({ type: "setFill", ids: [paths[0]!], fill: { color: 0x336699ff } });
  session.dispatch({
    type: "applyTransform",
    ids: [layer(s, "circle-bw").id],
    matrix: [1.5, 0, 0, 1.5, -10.25, 3.1],
  });
  session.dispatch({ type: "setVisible", ids: [paths[1]!], visible: false });
  session.dispatch({ type: "group", ids: [paths[1]!, paths[2]!], name: "grouped ✓" });
  await session.attachSource(SOURCE_PNG(), { embedded: o.embedded });
  return session;
}

export interface Semantic {
  /** Canonical document JSON (C7 document section). */
  doc: string;
  /** Uncompressed geometry section bytes (C3.0 records) by chunk id, base64. */
  geometry: [string, string][];
  /** Source bytes held by the session, by asset id, base64. */
  sources: [string, string][];
}
/** What "semantically equal" compares: canonical document JSON plus geometry record bytes. */
export function semantic(session: DocumentSession): Semantic {
  const st = session.state;
  const chunks = [...session.derivedOf(st)!.chunks.keys()].sort(
    (a, b) => +a.slice(4) - +b.slice(4),
  );
  return {
    doc: canonicalJson(documentJson(st, session.nextId, session.store.nextChunkId)),
    geometry: chunks.map((id) => [id, toB64(session.store.encodeRecord(id))]),
    sources: [...st.sourceAssetsById.keys()].flatMap((id): [string, string][] => {
      const b = session.sourceBytes(id);
      return b ? [[id, toB64(b)]] : [];
    }),
  };
}

// Bytes cross page.evaluate as base64 (atob/btoa exist in browsers and Node).
export function toB64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
