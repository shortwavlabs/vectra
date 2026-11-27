import { describe, expect, test } from "vite-plus/test";
import { encodeRecord } from "../document/packet-port.ts";
import { fixtureProvenance, TEST_PROVENANCE } from "../document/testing/helpers.ts";
import { evaluate } from "../document/evaluate.ts";
import { GeometryStore } from "../document/geometry-store.ts";
import { DEFAULT_DOC_LIMITS } from "../document/invariants.ts";
import { createDocument, type ContainerNode, type DocState } from "../document/model.ts";
import { DocumentSession, sha256Hex } from "../document/session.ts";
import { fixturePacket, FIXTURE_SCENES } from "../document/testing/fixtures.ts";
import { fixtureSession } from "../document/testing/helpers.ts";
const align8 = (x: number) => x + ((8 - (x % 8)) % 8);
import { syntheticPacket } from "../document/testing/synthetic.ts";
import { canonicalJson, canonicalJsonBytes, parseCanonicalJson } from "./canonical-json.ts";
import goldenB64 from "./golden/circle-bw.none.vectra.b64?raw";
import goldenV2B64 from "./golden/circle-bw.v2.none.vectra.b64?raw";
import { saveContainerV1 } from "../document/testing/document-json-v1.ts";

/** SHA-256 of the v2 golden container, re-baselined in G-PRJ-0 (AM-3.2). */
const GOLDEN_V2_SHA256 = "ad62176349e45b3ab409cf3a75e96bfe320a2464f257da0c352a88e04419418b";
import {
  type Codec,
  ContainerError,
  loadContainer,
  MAGIC,
  readHeader,
  readSection,
  saveContainer,
  type SectionKind,
} from "./container.ts";
import { documentJson } from "./document-json.ts";

const load = (bytes: Uint8Array, o = {}) => loadContainer(bytes, { ...o });
const kids = (s: DocState, id: string) => (s.nodesById.get(id) as ContainerNode).orderedChildIds;

/** A document from every fixture, with structural edits, a hidden layer and a palette recolour. */
function editedSession() {
  const session = fixtureSession([...FIXTURE_SCENES.keys()]);
  const s = session.state;
  const [l0, l1, l2] = s.orderedRootIds;
  const g1 = kids(s, l1!)[0]!;
  session.dispatch({ type: "applyTransform", ids: [l0!], matrix: [1.5, 0, 0, 1.5, -10.25, 3] });
  session.dispatch({ type: "rotate90", ids: [g1], turns: 1, pivot: { x: 128, y: 128 } });
  session.dispatch({ type: "duplicate", ids: [l2!] });
  session.dispatch({ type: "setVisible", ids: [l2!], visible: false });
  session.dispatch({ type: "setFill", ids: [kids(s, g1)[0]!], fill: { color: 0x336699ff } });
  session.dispatch({
    type: "setPaletteColor",
    paletteRef: [...s.paletteById.keys()][0]!,
    color: 0x010203ff,
  });
  session.dispatch({ type: "delete", ids: [s.orderedRootIds[3]!] }); // leaves a gap in chunk IDs
  session.dispatch({ type: "rename", id: g1, name: "rotated – ünïcode ✓" });
  return session;
}

interface RawSection {
  id: string;
  kind: SectionKind;
  data: Uint8Array;
}
/** Re-assembles a container from uncompressed sections, with optional header tampering. */
async function assemble(
  sections: RawSection[],
  o: {
    codec?: Codec;
    tamper?: (h: { formatVersion: unknown; sections: Record<string, unknown>[] }) => void;
  } = {},
) {
  const codec = o.codec ?? "none";
  const entries: Record<string, unknown>[] = [];
  const bodies: Uint8Array[] = [];
  let offset = 0;
  for (const s of sections) {
    const body =
      codec === "none"
        ? s.data
        : new Uint8Array(
            await new Response(
              new Blob([s.data as Uint8Array<ArrayBuffer>])
                .stream()
                .pipeThrough(new CompressionStream("deflate-raw")),
            ).arrayBuffer(),
          );
    entries.push({
      id: s.id,
      kind: s.kind,
      codec,
      offset,
      length: body.length,
      uncompressedLength: s.data.length,
      sha256: await sha256Hex(s.data),
    });
    bodies.push(body);
    offset += body.length;
  }
  const h = { formatVersion: 1 as unknown, sections: entries };
  o.tamper?.(h);
  const header = canonicalJsonBytes(h);
  const out = new Uint8Array(12 + header.length + offset);
  out.set(MAGIC);
  new DataView(out.buffer).setUint32(8, header.length, true);
  out.set(header, 12);
  let pos = 12 + header.length;
  for (const b of bodies) {
    out.set(b, pos);
    pos += b.length;
  }
  return out;
}
async function sectionsOf(bytes: Uint8Array): Promise<RawSection[]> {
  const h = readHeader(bytes);
  const out: RawSection[] = [];
  for (const s of h.sections)
    out.push({ id: s.id, kind: s.kind, data: (await readSection(bytes, h, s)).slice() });
  return out;
}
const jsonOf = (b: Uint8Array) => parseCanonicalJson(b)!.value as Record<string, unknown>;
const withJson = (secs: RawSection[], id: string, f: (j: Record<string, unknown>) => void) =>
  secs.map((s) => {
    if (s.id !== id) return s;
    const j = jsonOf(s.data);
    f(j);
    return { ...s, data: canonicalJsonBytes(j) };
  });

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ContainerError) return e.detail ? `${e.code}:${e.detail}` : e.code;
    return `untyped:${String(e)}`;
  }
  return "ok";
}

describe("container v1 round trip and determinism (C7)", () => {
  test("save → load → save is byte-identical (deflate-raw and none); load is semantically equal and clean", async () => {
    for (const codec of ["deflate-raw", "none"] as const) {
      const session = editedSession();
      const a = await saveContainer(session, { codec });
      // AM-3.4: serialization is not a save; only an explicit markSaved (after a verified
      // write, G-PRJ-1) makes the session clean.
      expect(session.getSnapshot().dirty).toBe(true);
      session.markSaved(session.state);
      expect(session.getSnapshot().dirty).toBe(false);
      const loaded = await load(a);
      const b = await saveContainer(loaded, { codec });
      expect(b).toEqual(a);
      expect(loaded.getSnapshot().dirty).toBe(false);
      expect(loaded.getSnapshot().canUndo).toBe(false); // history is not persisted
      expect(
        canonicalJson(documentJson(loaded.state, loaded.nextId, loaded.store.nextChunkId)),
      ).toBe(canonicalJson(documentJson(session.state, session.nextId, session.store.nextChunkId)));
      expect(evaluate(loaded.state)).toEqual(evaluate(session.state));
      expect(loaded.store.chunkIds()).toEqual(
        [...session.derivedOf(session.state)!.chunks.keys()].sort(
          (x, y) => +x.slice(4) - +y.slice(4),
        ),
      );
      for (const id of loaded.store.chunkIds())
        expect(loaded.store.encodeRecord(id)).toEqual(session.store.encodeRecord(id));
      expect(loaded.nextId).toBe(session.nextId);
      expect(loaded.store.nextChunkId).toBe(session.store.nextChunkId);
      // High-water marks keep allocating past the loaded IDs (C1: never reused).
      loaded.dispatch({
        type: "commitTrace",
        provenance: TEST_PROVENANCE,
        packet: fixturePacket("circle-bw"),
      });
      expect(loaded.store.chunkIds().at(-1)).toBe(`chk_${session.store.nextChunkId}`);
      expect(loaded.getSnapshot().dirty).toBe(true);
    }
  });

  test("uncompressed section bytes, sha256 and uncompressedLength are independent of the codec", async () => {
    const session = editedSession();
    const none = await saveContainer(session, { codec: "none" });
    const deflated = await saveContainer(session, { codec: "deflate-raw" });
    expect(deflated.length).toBeLessThan(none.length);
    const hn = readHeader(none).sections;
    const hd = readHeader(deflated).sections;
    expect(hd.map((s) => [s.id, s.sha256, s.uncompressedLength])).toEqual(
      hn.map((s) => [s.id, s.sha256, s.uncompressedLength]),
    );
    expect((await sectionsOf(deflated)).map((s) => s.data)).toEqual(
      (await sectionsOf(none)).map((s) => s.data),
    );
  });

  test("codec none container equals the committed goldens (v2 written, historical v1 kept)", async () => {
    const store = new GeometryStore();
    const session = new DocumentSession(store, {
      state: createDocument({ documentId: "golden-circle-bw", width: 256, height: 256 }),
    });
    session.dispatch({
      type: "commitTrace",
      provenance: fixtureProvenance("circle-bw"),
      packet: fixturePacket("circle-bw"),
      name: "circle-bw",
    });
    const b64 = (s: string) => Uint8Array.from(atob(s.trim()), (c) => c.charCodeAt(0));
    const golden = b64(goldenB64);
    const goldenV2 = b64(goldenV2B64);
    // The historical v1 golden is unchanged (same SHA-256 as the G-DOC artifact
    // docs/research/g-doc/artifacts/circle-bw.none.vectra) and still re-derivable.
    expect(await sha256Hex(golden)).toBe(
      "8beeea92f53f6c81737c00e45c4cbf95faca5788b4f27903e4de77472087c3bc",
    );
    expect(await saveContainerV1(session)).toEqual(golden);
    // The v2 golden, re-baselined explicitly in G-PRJ-0 (AM-3.2).
    const bytes = await saveContainer(session, { codec: "none" });
    expect(bytes).toEqual(goldenV2);
    expect(await sha256Hex(goldenV2)).toBe(GOLDEN_V2_SHA256);
    // v1 → v2 migration: the v1 golden loads and saves as the v2 golden; the v2 golden loads
    // and, written by the independent v1 writer, is the v1 golden again.
    expect(await saveContainer(await load(golden), { codec: "none" })).toEqual(goldenV2);
    expect(await saveContainerV1(await load(goldenV2))).toEqual(golden);
  });

  test("layout: magic, canonical header, contiguous sections in fixed order, no clocks or names", async () => {
    const session = editedSession();
    const bytes = await saveContainer(session, { codec: "none" });
    const h = readHeader(bytes);
    expect(h.sections.map((s) => s.kind)).toEqual([
      "manifest",
      "document",
      ...h.sections.slice(2).map(() => "geometry"),
    ]);
    const secs = await sectionsOf(bytes);
    expect(jsonOf(secs[0]!.data)).toEqual({
      app: "vectra",
      documentSchemaVersion: 2,
      formatVersion: 1,
      packetVersion: 1,
    });
    const doc = jsonOf(secs[1]!.data);
    expect(Object.keys(doc)).toEqual(Object.keys(doc).sort());
    expect(Object.keys(doc.nodesById as object)).toEqual(
      Object.keys(doc.nodesById as object).sort(),
    );
    // Each geometry section is a C3.0 record whose manifest is canonical JSON.
    for (const s of secs.slice(2)) {
      const Lm = new DataView(s.data.buffer, s.data.byteOffset).getUint32(0, true);
      expect(parseCanonicalJson(s.data.subarray(4, 4 + Lm))).not.toBeNull();
      expect(align8(4 + Lm) % 8).toBe(0);
    }
  });

  test("embedded sources round-trip; non-embedded sources write no section", async () => {
    const png = new Uint8Array(64);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 256);
    new DataView(png.buffer).setUint32(20, 256);
    png.set([0, 0, 0, 0, 0x49, 0x44, 0x41, 0x54], 33);
    const session = fixtureSession(["circle-bw"]);
    await session.attachSource(png, { embedded: true });
    const other = png.slice();
    other[40] = 1;
    await session.attachSource(other, { embedded: false });
    const bytes = await saveContainer(session, { codec: "deflate-raw" });
    const h = readHeader(bytes);
    expect(h.sections.filter((s) => s.kind === "source")).toHaveLength(1);
    const loaded = await load(bytes);
    const embedded = [...loaded.state.sourceAssetsById.values()].find((a) => a.embedded)!;
    expect(loaded.sourceBytes(embedded.id)).toEqual(png);
    expect(await saveContainer(loaded, { codec: "deflate-raw" })).toEqual(bytes);
  });

  test("a save runs from the immutable state captured at call time", async () => {
    const session = fixtureSession(["circle-bw"]);
    const saving = saveContainer(session, { codec: "deflate-raw" });
    session.dispatch({
      type: "rename",
      id: session.state.orderedRootIds[0]!,
      name: "edited during save",
    });
    const loaded = await load(await saving);
    expect(loaded.state.nodesById.get(loaded.state.orderedRootIds[0]!)!.name).toBe("circle-bw");
    expect(session.getSnapshot().dirty).toBe(true);
  });
});

describe("container adversarial suite: typed errors, live document unchanged", () => {
  const live = fixtureSession(["adjacent_colors-color"]);
  const liveBefore = () => ({
    snap: live.getSnapshot(),
    chunks: live.store.chunkIds(),
    bytes: live.store.bytes(),
    next: live.store.nextChunkId,
  });
  const before = liveBefore();
  const expectCode = async (bytes: Uint8Array | Promise<Uint8Array>, code: string, o = {}) => {
    expect(await codeOf(load(await bytes, o))).toBe(code);
    expect(liveBefore()).toEqual(before);
  };
  let goodBytes: Uint8Array;
  let good: RawSection[];
  const base = async () => {
    goodBytes ??= await saveContainer(editedSession(), { codec: "none" });
    good ??= await sectionsOf(goodBytes);
    return { bytes: goodBytes.slice(), secs: good.map((s) => ({ ...s, data: s.data.slice() })) };
  };
  /** The same document as a documentSchemaVersion 1 container (the v1 reader stays strict). */
  let goodV1: RawSection[] | undefined;
  const baseV1 = async () => {
    goodV1 ??= await sectionsOf(await saveContainerV1(editedSession()));
    return { secs: goodV1.map((s) => ({ ...s, data: s.data.slice() })) };
  };

  test("truncation at every structural boundary", async () => {
    const { bytes } = await base();
    const h = readHeader(bytes);
    for (const cut of [0, 7, 11, 20, h.dataStart - 1, h.dataStart + 10, bytes.length - 1])
      await expectCode(bytes.subarray(0, cut), "truncated");
  });

  test("bad magic, oversized header, non-canonical header", async () => {
    const { bytes } = await base();
    const bad = bytes.slice();
    bad[1] = 0x46;
    await expectCode(bad, "magic");
    const big = bytes.slice();
    new DataView(big.buffer).setUint32(8, 2 ** 20 + 1, true);
    await expectCode(big, "header");
    const h = readHeader(bytes);
    const text = new TextDecoder()
      .decode(bytes.subarray(12, h.dataStart))
      .replace('{"formatVersion"', '{ "formatVersion"');
    const enc = new TextEncoder().encode(text);
    const out = new Uint8Array(12 + enc.length + bytes.length - h.dataStart);
    out.set(bytes.subarray(0, 12));
    new DataView(out.buffer).setUint32(8, enc.length, true);
    out.set(enc, 12);
    out.set(bytes.subarray(h.dataStart), 12 + enc.length);
    await expectCode(out, "header");
  });

  test("section table: overlap, out of range, gap, trailing bytes, duplicates, order, unknown kind/field/codec/version", async () => {
    const { bytes, secs } = await base();
    const t = (f: (h: { formatVersion: unknown; sections: Record<string, unknown>[] }) => void) =>
      assemble(secs, { tamper: f });
    await expectCode(
      t((h) => (h.sections[2]!.offset = (h.sections[1]!.offset as number) + 1)),
      "section",
    );
    await expectCode(
      t((h) => (h.sections[1]!.length = (h.sections[1]!.length as number) + 1e6)),
      "section",
    );
    const last = (h: { sections: Record<string, unknown>[] }) => h.sections[h.sections.length - 1]!;
    await expectCode(
      t((h) => {
        last(h).length = (last(h).length as number) + 1000;
        last(h).uncompressedLength = last(h).length;
      }),
      "truncated",
    );
    await expectCode(
      t((h) => (last(h).length = (last(h).length as number) - 1)),
      "section",
    );
    const trailing = new Uint8Array(bytes.length + 3);
    trailing.set(bytes);
    await expectCode(trailing, "section");
    await expectCode(
      t((h) => (h.sections[3]!.id = h.sections[2]!.id)),
      "section",
    );
    await expectCode(
      t((h) => h.sections.reverse()),
      "section",
    );
    await expectCode(
      t((h) => ([h.sections[2], h.sections[3]] = [h.sections[3]!, h.sections[2]!])),
      "section",
    );
    await expectCode(
      t((h) => (h.sections[2]!.kind = "thumbnail")),
      "section",
    );
    await expectCode(
      t((h) => (h.sections[2]!.extra = 1)),
      "section",
    );
    await expectCode(
      t((h) => ((h as Record<string, unknown>).created = "2026-11-25")),
      "header",
    );
    await expectCode(
      t((h) => (h.sections[2]!.codec = "zstd")),
      "codec",
    );
    await expectCode(
      t((h) => (h.formatVersion = 2)),
      "version",
    );
    await expectCode(
      t((h) => (h.sections[2]!.id = "pth_3")),
      "section",
    );
  });

  test("declared sizes are capped before allocation", async () => {
    const { secs } = await base();
    const big = await assemble(secs, {
      tamper: (h) => {
        h.sections[1]!.uncompressedLength = 64 * 2 ** 20 + 1;
        h.sections[1]!.codec = "deflate-raw";
      },
    });
    await expectCode(big, "limit");
    await expectCode(assemble(secs), "limit", { sessionBudget: 1000 });
  });

  test("decompression bomb, corrupt stream, short output, SHA mismatch", async () => {
    const { secs } = await base();
    const bomb: RawSection = {
      id: "document",
      kind: "document",
      data: new Uint8Array(32 * 2 ** 20),
    };
    const bombBytes = await assemble([secs[0]!, bomb, ...secs.slice(2)], {
      codec: "deflate-raw",
      tamper: (h) => (h.sections[1]!.uncompressedLength = 4096),
    });
    await expectCode(bombBytes, "inflate");
    const deflated = await assemble(secs, { codec: "deflate-raw" });
    const h = readHeader(deflated);
    const corrupt = deflated.slice();
    corrupt[h.dataStart + h.sections[1]!.offset + 2]! ^= 0xff;
    expect(["inflate", "sha256"]).toContain(await codeOf(load(corrupt)));
    await expectCode(
      assemble(secs, {
        codec: "deflate-raw",
        tamper: (hh) =>
          (hh.sections[1]!.uncompressedLength =
            (hh.sections[1]!.uncompressedLength as number) + 10),
      }),
      "inflate",
    );
    const flipped = (await assemble(secs)).slice();
    const hf = readHeader(flipped);
    flipped[hf.dataStart + hf.sections[2]!.offset + 40]! ^= 1;
    await expectCode(flipped, "sha256");
  });

  test("manifest section: newer versions refused, unknown fields rejected", async () => {
    const { secs } = await base();
    await expectCode(
      assemble(withJson(secs, "manifest", (j) => (j.documentSchemaVersion = 3))),
      "version",
    );
    // The manifest and the document must name the same documentSchemaVersion (1 and 2 read).
    await expectCode(
      assemble(withJson(secs, "manifest", (j) => (j.documentSchemaVersion = 1))),
      "manifest",
    );
    const { secs: v1 } = await baseV1();
    await expectCode(
      assemble(withJson(v1, "manifest", (j) => (j.documentSchemaVersion = 2))),
      "manifest",
    );
    await expectCode(assemble(withJson(secs, "manifest", (j) => (j.packetVersion = 2))), "version");
    await expectCode(assemble(withJson(secs, "manifest", (j) => (j.createdAt = 0))), "manifest");
  });

  test("document section (v1 reader): strict schema, versions, duplicates, dangling references, cycles, transforms", async () => {
    const { secs } = await baseV1();
    const doc = (f: (d: Record<string, unknown>) => void) =>
      assemble(withJson(secs, "document", f));
    const nodes = (d: Record<string, unknown>) =>
      d.nodesById as Record<string, Record<string, unknown>>;
    const firstOf = (d: Record<string, unknown>, kind: string) =>
      Object.values(nodes(d)).find((n) => n.kind === kind)!;
    await expectCode(
      doc((d) => (d.documentSchemaVersion = 3)),
      "version",
    );
    await expectCode(
      doc((d) => (d.camera = { s: 1 })),
      "document",
    );
    await expectCode(
      doc((d) => (firstOf(d, "path").effectStack = [])),
      "document",
    );
    await expectCode(
      doc((d) => (firstOf(d, "group").kind = "text")),
      "document",
    );
    // Duplicate IDs: a repeated JSON member (non-canonical) and a number reused across kinds.
    {
      const s = secs.find((x) => x.id === "document")!;
      const text = new TextDecoder().decode(s.data);
      const dup = text.replace('"nodesById":{', '"nodesById":{"lay_1":{},');
      await expectCode(
        assemble(
          secs.map((x) =>
            x.id === "document" ? { ...x, data: new TextEncoder().encode(dup) } : x,
          ),
        ),
        "document",
      );
    }
    await expectCode(
      doc((d) => {
        const g = firstOf(d, "group");
        const n = String(g.id).slice(4);
        const p = firstOf(d, "path");
        const old = String(p.id);
        p.id = `pth_${n}`;
        nodes(d)[`pth_${n}`] = p;
        delete nodes(d)[old];
        for (const c of Object.values(nodes(d)))
          if (Array.isArray(c.orderedChildIds))
            c.orderedChildIds = (c.orderedChildIds as string[]).map((x) =>
              x === old ? p.id : x,
            ) as never;
      }),
      "document:invariant",
    );
    await expectCode(
      doc((d) => (firstOf(d, "path").geometry = { chunkId: "chk_999", pathIndex: 0 })),
      "document:invariant",
    );
    await expectCode(
      doc((d) => (firstOf(d, "path").styleRef = "sty_999")),
      "document:invariant",
    );
    await expectCode(
      doc((d) => {
        const st = Object.values(d.stylesById as Record<string, Record<string, unknown>>).find(
          (x) => x.paletteRef !== null,
        )!;
        st.paletteRef = "pal_999";
      }),
      "document:invariant",
    );
    await expectCode(
      doc((d) => (d.orderedRootIds as string[]).push("lay_999")),
      "document:invariant",
    );
    await expectCode(
      doc((d) => {
        const g = firstOf(d, "group");
        const layer = Object.values(nodes(d)).find((n) =>
          (n.orderedChildIds as string[] | undefined)?.includes(String(g.id)),
        )!;
        (g.orderedChildIds as string[]).push(String(layer.id)); // a cycle
      }),
      "document:invariant",
    );
    await expectCode(
      doc((d) => (firstOf(d, "path").localTransform = [0, 0, 0, 0, 0, 0])),
      "document:invalid_transform",
    );
    {
      const s = secs.find((x) => x.id === "document")!;
      const text = new TextDecoder()
        .decode(s.data)
        .replace('"localTransform":[1,0,0,1,0,0]', '"localTransform":[1e999,0,0,1,0,0]');
      await expectCode(
        assemble(
          secs.map((x) =>
            x.id === "document" ? { ...x, data: new TextEncoder().encode(text) } : x,
          ),
        ),
        "document",
      );
    }
    await expectCode(
      doc((d) => (firstOf(d, "path").clipRef = { x: 0, y: 0, width: 1, height: 1 })),
      "document:clip_unsupported",
    );
    await expectCode(
      doc((d) => (d.nextId = 2)),
      "document:invariant",
    );
    await expectCode(
      doc((d) => (d.nextChunkId = 1)),
      "document",
    );
  });

  test("document section (v2 reader): compact shapes, dangling references, cycles, transforms", async () => {
    const { secs } = await base();
    const doc = (f: (d: Record<string, unknown>) => void) =>
      assemble(withJson(secs, "document", f));
    const nodes = (d: Record<string, unknown>) =>
      d.nodesById as Record<string, Record<string, unknown>>;
    /** v2 nodes carry no kind: it is the key's prefix. */
    const firstKey = (d: Record<string, unknown>, prefix: string) =>
      Object.keys(nodes(d)).find((k) => k.startsWith(prefix))!;
    const first = (d: Record<string, unknown>, prefix: string) => nodes(d)[firstKey(d, prefix)]!;
    await expectCode(
      doc((d) => (d.documentSchemaVersion = 3)),
      "version",
    );
    // v1 shapes inside a v2 document, and explicit defaults, are not canonical v2.
    await expectCode(
      doc((d) => (first(d, "pth_").kind = "path")),
      "document",
    );
    await expectCode(
      doc((d) => (first(d, "pth_").id = firstKey(d, "pth_"))),
      "document",
    );
    await expectCode(
      doc((d) => (first(d, "pth_").visible = true)),
      "document",
    );
    await expectCode(
      doc((d) => {
        const k = firstKey(d, "grp_");
        nodes(d)[`txt_${k.slice(4)}`] = nodes(d)[k]!;
        delete nodes(d)[k];
      }),
      "document",
    );
    // Semantic forgeries reach validateState, exactly as in v1.
    await expectCode(
      doc((d) => (first(d, "pth_").geometry = { chunkId: "chk_999", pathIndex: 0 })),
      "document:invariant",
    );
    await expectCode(
      doc((d) => (first(d, "pth_").styleRef = "sty_999")),
      "document:invariant",
    );
    await expectCode(
      doc((d) => (d.orderedRootIds as string[]).push("lay_999")),
      "document:invariant",
    );
    await expectCode(
      doc((d) => {
        const g = firstKey(d, "grp_");
        const layer = Object.values(nodes(d)).find((n) =>
          (n.orderedChildIds as string[] | undefined)?.includes(g),
        )!;
        const parentKey = Object.keys(nodes(d)).find((k) => nodes(d)[k] === layer)!;
        (nodes(d)[g]!.orderedChildIds as string[]).push(parentKey); // a cycle
      }),
      "document:invariant",
    );
    await expectCode(
      doc((d) => (first(d, "pth_").localTransform = [0, 0, 0, 0, 0, 0])),
      "document:invalid_transform",
    );
    await expectCode(
      doc((d) => (first(d, "pth_").clipRef = { x: 0, y: 0, width: 1, height: 1 })),
      "document:clip_unsupported",
    );
    await expectCode(
      doc((d) => (d.nextId = 2)),
      "document:invariant",
    );
  });

  test("geometry sections: invalid packets → packet codes; unreferenced chunks; anchor cap", async () => {
    const { secs } = await base();
    const geo = secs.findIndex((s) => s.kind === "geometry");
    const record = secs[geo]!.data;
    const Lm = new DataView(record.buffer, record.byteOffset).getUint32(0, true);
    const head = align8(4 + Lm);
    const m = JSON.parse(new TextDecoder().decode(record.subarray(4, 4 + Lm)));
    const coords = head + align8(m.verbCount);
    const withRecord = (f: (r: Uint8Array) => Uint8Array) =>
      assemble(secs.map((s, i) => (i === geo ? { ...s, data: f(s.data.slice()) } : s)));
    await expectCode(
      withRecord((r) => (new DataView(r.buffer).setFloat64(coords + 8, NaN, true), r)),
      "packet:coord",
    );
    await expectCode(
      withRecord((r) => ((r[head] = 1), r)),
      "packet:grammar",
    );
    await expectCode(
      withRecord((r) => ((r[head + 1] = 9), r)),
      "packet:opcode",
    );
    if (head > 4 + Lm)
      await expectCode(
        withRecord((r) => ((r[4 + Lm] = 1), r)),
        "packet:padding",
      );
    await expectCode(
      withRecord((r) => r.subarray(0, r.length - 8)),
      "packet:length",
    );
    const offsets = coords + align8(8 * m.coordCount);
    await expectCode(
      withRecord((r) => (new DataView(r.buffer).setUint32(offsets + 4, 0, true), r)),
      "packet:offsets",
    );
    const reManifest = (patch: Record<string, unknown>) =>
      withRecord((r) => {
        const mBytes = canonicalJsonBytes({ ...m, ...patch });
        const h2 = align8(4 + mBytes.length);
        const out = new Uint8Array(h2 + r.length - head);
        new DataView(out.buffer).setUint32(0, mBytes.length, true);
        out.set(mBytes, 4);
        out.set(r.subarray(head), h2);
        return out;
      });
    await expectCode(reManifest({ packetVersion: 2 }), "version");
    await expectCode(reManifest({ coordCount: 2 ** 32 - 1 }), "packet:budget");
    await expectCode(reManifest({ styles: [] }), "packet:ref");
    // An extra, unreferenced chunk.
    const extra = encodeRecord(fixturePacket("circle-bw").manifest, fixturePacket("circle-bw"));
    const lastGeo = secs.filter((s) => s.kind === "geometry").at(-1)!.id;
    const extraId = `chk_${+lastGeo.slice(4) + 1}`;
    await expectCode(
      assemble(
        withJson(
          [...secs, { id: extraId, kind: "geometry", data: extra }],
          "document",
          (d) => (d.nextChunkId = +extraId.slice(4) + 1),
        ),
      ),
      "document",
    );
    await expectCode(assemble(secs), "document:budget", {
      limits: { ...DEFAULT_DOC_LIMITS, maxAnchors: 10 },
    });
    // Review finding 6: a geometry section numbered below the store counter (chk_0).
    await expectCode(
      assemble(secs.map((s, i) => (i === geo ? { ...s, id: "chk_0" } : s))),
      "section",
    );
  });

  test("source sections: bad signature, digest mismatch, missing or unexpected sections", async () => {
    const png = new Uint8Array(64);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 32);
    new DataView(png.buffer).setUint32(20, 32);
    png.set([0, 0, 0, 0, 0x49, 0x44, 0x41, 0x54], 33);
    const session = fixtureSession(["circle-bw"]);
    await session.attachSource(png, { embedded: true });
    const secs = await sectionsOf(await saveContainer(session, { codec: "none" }));
    const srcIdx = secs.findIndex((s) => s.kind === "source");
    const notImage = new Uint8Array(64).fill(7);
    const digest = await sha256Hex(notImage);
    await expectCode(
      assemble(
        withJson(
          secs.map((s, i) => (i === srcIdx ? { ...s, data: notImage } : s)),
          "document",
          (d) => {
            for (const a of Object.values(
              d.sourceAssetsById as Record<string, Record<string, unknown>>,
            ))
              a.digest = digest;
          },
        ),
      ),
      "source:unsupported_format",
    );
    const tampered = png.slice();
    tampered[50] = 9;
    await expectCode(
      assemble(secs.map((s, i) => (i === srcIdx ? { ...s, data: tampered } : s))),
      "source",
    );
    await expectCode(assemble(secs.filter((_, i) => i !== srcIdx)), "document");
    await expectCode(
      assemble(
        withJson(secs, "document", (d) => {
          for (const a of Object.values(
            d.sourceAssetsById as Record<string, Record<string, unknown>>,
          ))
            a.embedded = false;
        }),
      ),
      "document",
    );
  });

  test("synthetic multi-group packets survive the container", async () => {
    const session = fixtureSession(["circle-bw"]);
    session.dispatch({
      type: "commitTrace",
      provenance: TEST_PROVENANCE,
      packet: syntheticPacket({ paths: 50, anchorsPerPath: 7, groups: 5, clip: true }),
    });
    const bytes = await saveContainer(session);
    expect(await saveContainer(await load(bytes))).toEqual(bytes);
  });
});
