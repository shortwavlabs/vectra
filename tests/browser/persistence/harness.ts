// Browser side of the persistence qualification: real production modules, driven through
// `window.harness` by persistence.pw.ts and interchange.pw.ts. Identity checks (same session,
// same state reference) run here, because object identity cannot cross page.evaluate.
import { GeometryStore } from "../../../src/document/geometry-store.ts";
import { createDocument, DocumentError } from "../../../src/document/model.ts";
import { SECTION_KEYS } from "../../../src/document/packet-port.ts";
import { DocumentSession, sha256Hex } from "../../../src/document/session.ts";
import { sceneProvenance } from "../../../src/document/testing/provenance.ts";
import { packetFromScene, type SceneV1 } from "../../../src/geometry/packet/scene.ts";
import { canonicalJson, canonicalJsonBytes } from "../../../src/persistence/canonical-json.ts";
import {
  type Codec,
  ContainerError,
  type LoadOptions,
  loadContainer,
  MAGIC,
  readHeader,
  readSection,
  saveContainer,
  type SectionEntry,
} from "../../../src/persistence/container.ts";
import {
  buildDocument,
  fromB64,
  png,
  SCENES,
  type SceneTexts,
  scenePath,
  semantic,
  SOURCE_PNG,
  toB64,
} from "./document.ts";

const texts = Object.fromEntries(
  await Promise.all(
    SCENES.map(async (n) => [n, await (await fetch(`/${scenePath(n)}`)).text()] as const),
  ),
) as SceneTexts;

const build = (embedded = true) => buildDocument(texts, { embedded });

function errorInfo(e: unknown) {
  const err = e as Error & { code?: string };
  return {
    containerError: e instanceof ContainerError,
    documentError: e instanceof DocumentError,
    name: err.name,
    code: err.code ?? null,
    detail: e instanceof ContainerError ? (e.detail ?? null) : null,
    message: String(err.message),
  };
}
export type ErrorInfo = ReturnType<typeof errorInfo>;

const deflateRaw = async (data: Uint8Array) =>
  new Uint8Array(
    await new Response(
      new Blob([data as Uint8Array<ArrayBuffer>])
        .stream()
        .pipeThrough(new CompressionStream("deflate-raw")),
    ).arrayBuffer(),
  );

/** `total` zero bytes through CompressionStream, streamed 1 MiB at a time (never held whole). */
async function deflatedZeros(total: number): Promise<Uint8Array> {
  let sent = 0;
  const zeros = new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(c) {
      if (sent >= total) c.close();
      else {
        c.enqueue(new Uint8Array(2 ** 20));
        sent += 2 ** 20;
      }
    },
  });
  const out = zeros.pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(out).arrayBuffer());
}

interface Parts {
  entries: SectionEntry[];
  bodies: Uint8Array[];
  /** Uncompressed, SHA-verified bytes of section i (production readSection). */
  raw: (i: number) => Promise<Uint8Array>;
}
/** Re-assembles a container after editing its stored bodies and table; offsets and `length`
 *  follow the bodies, everything else (sha256, uncompressedLength, codec) is as edited. */
async function rebuild(bytes: Uint8Array, edit: (p: Parts) => Promise<void> | void) {
  const h = readHeader(bytes);
  const entries = h.sections.map((s) => ({ ...s }));
  const bodies = h.sections.map((s) =>
    bytes.slice(h.dataStart + s.offset, h.dataStart + s.offset + s.length),
  );
  await edit({ entries, bodies, raw: async (i) => readSection(bytes, h, h.sections[i]!) });
  let offset = 0;
  entries.forEach((e, i) => {
    e.offset = offset;
    e.length = bodies[i]!.length;
    offset += e.length;
  });
  const header = canonicalJsonBytes({ formatVersion: 1, sections: entries });
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

/** A C3.0 record with its first coordinate's second value set to NaN (production layout). */
function nanCoordinate(record: Uint8Array): Uint8Array {
  const r = record.slice();
  const align8 = (x: number) => x + ((8 - (x % 8)) % 8);
  const dv = new DataView(r.buffer);
  const lm = dv.getUint32(0, true);
  const m = JSON.parse(new TextDecoder().decode(r.subarray(4, 4 + lm))) as { verbCount: number };
  dv.setFloat64(align8(4 + lm) + align8(m.verbCount) + 8, NaN, true);
  return r;
}

type Case = { name: string; bytes: Uint8Array; options?: LoadOptions };

async function malformedCases(good: Uint8Array, codec: Codec): Promise<Case[]> {
  const h = readHeader(good);
  const geo = h.sections.findIndex((s) => s.kind === "geometry");
  const flip = (at: number) => {
    const b = good.slice();
    b[at]! ^= 0xff;
    return b;
  };
  const header = good.slice();
  new DataView(header.buffer).setUint32(8, 2 ** 20 + 1, true);
  const cases: Case[] = [
    { name: "truncated: 8 bytes", bytes: good.subarray(0, 8) },
    { name: "truncated: inside the header", bytes: good.subarray(0, h.dataStart - 1) },
    { name: "truncated: last byte missing", bytes: good.subarray(0, good.length - 1) },
    { name: "bad magic", bytes: flip(1) },
    { name: "oversized header", bytes: header },
    {
      name: "SHA mismatch: header sha256",
      bytes: await rebuild(good, ({ entries }) => {
        entries[geo]!.sha256 = "0".repeat(64);
      }),
    },
    {
      // SHA recomputed, so the record reaches the geometry decoder and validator.
      name: "corrupt geometry record",
      bytes: await rebuild(good, async ({ entries, bodies, raw }) => {
        const bad = nanCoordinate(await raw(geo));
        entries[geo]!.sha256 = await sha256Hex(bad);
        bodies[geo] = codec === "none" ? bad : await deflateRaw(bad);
      }),
    },
  ];
  if (codec === "none")
    cases.push({
      name: "SHA mismatch: flipped section byte",
      bytes: flip(h.dataStart + h.sections[geo]!.offset + 40),
    });
  return cases;
}

const BOMB_BYTES = 256 * 2 ** 20;

async function limitCases(good: Uint8Array): Promise<Case[]> {
  const h = readHeader(good);
  const last = h.sections.length - 1;
  const geo = h.sections.findIndex((s) => s.kind === "geometry");
  const declare = (i: number, n: number) =>
    rebuild(good, ({ entries }) => {
      entries[i]!.uncompressedLength = n;
    });
  return [
    {
      name: "decompression bomb (256 MiB of zeros in the document section)",
      bytes: await rebuild(good, async ({ bodies }) => {
        bodies[1] = await deflatedZeros(BOMB_BYTES);
      }),
    },
    { name: "document declares 64 MiB + 1", bytes: await declare(1, 64 * 2 ** 20 + 1) },
    { name: "source declares 20 MiB + 1", bytes: await declare(last, 20 * 2 ** 20 + 1) },
    { name: "geometry declares 8 GiB", bytes: await declare(geo, 2 ** 33) },
    { name: "session budget of 1,000 bytes", bytes: good, options: { sessionBudget: 1000 } },
  ];
}

/**
 * Loads `good` as the page's current session (as the app would), then tries every case. A
 * success would replace the current session; a failure must leave it exactly as it was.
 */
async function attempts(codec: Codec, group: "malformed" | "limits") {
  const good = await saveContainer(await build(), { codec });
  const original = await loadContainer(good, {});
  let current = original;
  const snap = current.getSnapshot();
  const before = canonicalJson(semantic(current));
  const cases = group === "malformed" ? await malformedCases(good, codec) : await limitCases(good);
  const results: { name: string; ms: number; error: ErrorInfo | null; storedBytes: number }[] = [];
  for (const c of cases) {
    const t0 = performance.now();
    try {
      current = await loadContainer(c.bytes, c.options ?? {});
      results.push({ name: c.name, ms: 0, error: null, storedBytes: c.bytes.length });
    } catch (e) {
      const ms = performance.now() - t0;
      results.push({ name: c.name, ms, error: errorInfo(e), storedBytes: c.bytes.length });
    }
  }
  return {
    results,
    sameSession: current === original,
    sameSnapshot: current.getSnapshot() === snap,
    sameState: current.state === snap.state,
    revision: [snap.revision, current.getSnapshot().revision],
    sameContent: canonicalJson(semantic(current)) === before,
    storeIntegrity: current.store.checkIntegrity(),
  };
}

/** C2 ownership: commit detaches the caller's arrays; jobCopy buffers make a Worker round trip
 *  while the committed buffers stay attached and readable. */
async function ownership(rounds: number) {
  const scene = JSON.parse(texts["thin_strokes-halftone"]) as SceneV1;
  const session = new DocumentSession(new GeometryStore(), {
    state: createDocument({ documentId: "ownership", width: 256, height: 256 }),
  });
  const packet = packetFromScene(scene);
  const callerArrays = SECTION_KEYS.map((k) => packet[k]);
  const expected = callerArrays.map((a) => new Uint8Array(a.buffer.slice(0)));
  const expectedCoords = packet.coords.slice();
  const sizes = callerArrays.map((a) => a.byteLength);
  session.dispatch({
    type: "commitTrace",
    packet,
    provenance: sceneProvenance(scene, "ownership"),
    name: "ownership",
  });
  const id = session.store.chunkIds()[0]!;
  const view = session.store.view(id);
  const record = toB64(session.store.encodeRecord(id));
  const keys = JSON.stringify(SECTION_KEYS);
  const echo = `const K=${keys};onmessage=(e)=>postMessage(e.data,e.data.packets.flatMap((p)=>K.map((k)=>p[k].buffer)));`;
  const url = URL.createObjectURL(new Blob([echo], { type: "text/javascript" }));
  const worker = new Worker(url);
  const sameBytes = (a: Uint8Array, b: Uint8Array) =>
    a.length === b.length && a.every((x, i) => x === b[i]);
  const out = [];
  try {
    for (let r = 0; r < rounds; r++) {
      const { packets, transfer } = session.store.jobCopy([id]);
      const reply = new Promise<{ packets: typeof packets }>((resolve, reject) => {
        worker.onmessage = (e) => resolve(e.data as { packets: typeof packets });
        worker.onerror = (e) => reject(new Error(e.message));
      });
      worker.postMessage({ packets }, transfer);
      const sentDetached = transfer.every((b) => b.byteLength === 0);
      const coords = Array.from({ length: view.coordCount }, (_, i) => view.coord(i));
      const committedReadable =
        session.store.checkIntegrity() &&
        coords.length === expectedCoords.length &&
        coords.every((c, i) => Object.is(c, expectedCoords[i]));
      const back = (await reply).packets[0]!;
      out.push({
        sentDetached,
        committedReadable,
        returnedTypes: SECTION_KEYS.map((k) => back[k].constructor.name),
        returnedIntact:
          SECTION_KEYS.every((k, i) => sameBytes(new Uint8Array(back[k].buffer), expected[i]!)) &&
          canonicalJson(back.manifest) === canonicalJson(view.manifest),
        recordUnchanged: toB64(session.store.encodeRecord(id)) === record,
      });
    }
  } finally {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
  return {
    sizes,
    callerDetached: callerArrays.map((a) => a.buffer.byteLength === 0 && a.length === 0),
    rounds: out,
    jobCopies: session.store.stats.jobCopies,
  };
}

async function relink(codec: Codec) {
  const bytes = await saveContainer(await build(false), { codec });
  const sourceSections = readHeader(bytes).sections.filter((s) => s.kind === "source").length;
  const loaded = await loadContainer(bytes, {});
  const missing = loaded.missingSources();
  const asset = missing[0]!;
  const snap = loaded.getSnapshot();
  const attempt = (b: Uint8Array) =>
    loaded.relinkSource(asset, b).then(
      () => null,
      (e: unknown) => errorInfo(e),
    );
  const wrongDigest = await attempt(png(64, 64, 8)); // same type and size, other bytes
  const wrongSize = await attempt(png(32, 64, 7));
  const missingAfterWrong = loaded.missingSources();
  const right = await attempt(SOURCE_PNG());
  const after = loaded.getSnapshot();
  return {
    sourceSections,
    missing,
    wrongDigest,
    wrongSize,
    missingAfterWrong,
    right,
    missingAfter: loaded.missingSources(),
    sameSnapshot: after === snap,
    revision: [snap.revision, after.revision],
    dirty: after.dirty,
    bytesMatch: toB64(loaded.sourceBytes(asset) ?? new Uint8Array()) === toB64(SOURCE_PNG()),
  };
}

const harness = {
  save: async (codec: Codec) => toB64(await saveContainer(await build(), { codec })),
  loadSemantic: async (b64: string) => semantic(await loadContainer(fromB64(b64), {})),
  roundTrip: async (codec: Codec) => {
    const session = await build();
    const before = semantic(session);
    const bytes = await saveContainer(session, { codec });
    // AM-3.4: serialization is not a save; only an explicit markSaved makes the session clean.
    const serializedDirty = session.getSnapshot().dirty;
    session.markSaved(session.state);
    const loaded = await loadContainer(bytes, {});
    return {
      before,
      after: semantic(loaded),
      serializedDirty,
      savedClean: !session.getSnapshot().dirty,
      loadedClean: !loaded.getSnapshot().dirty,
      loadedCanUndo: loaded.getSnapshot().canUndo,
      resaveIdentical: toB64(await saveContainer(loaded, { codec })) === toB64(bytes),
    };
  },
  attempts,
  ownership,
  relink,
};

declare global {
  interface Window {
    harness?: typeof harness;
  }
}
window.harness = harness;
