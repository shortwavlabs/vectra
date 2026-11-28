// Persistence qualification in each engine (Chromium, Firefox, Playwright WebKit): the harness
// page runs the production container, session and store; the same document is also built in
// Node here, so every engine is compared against one reference.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { type Browser, chromium, expect, firefox, type Page, test, webkit } from "@playwright/test";
import {
  type Codec,
  loadContainer,
  readHeader,
  saveContainer,
} from "../../../src/persistence/container.ts";
import {
  buildDocument,
  fromB64,
  SCENES,
  type SceneTexts,
  scenePath,
  semantic,
  toB64,
} from "./document.ts";

const HARNESS = "/tests/browser/persistence/harness.html";
const ROOT = resolve(import.meta.dirname, "../../..");
const TEXTS = Object.fromEntries(
  SCENES.map((n) => [n, readFileSync(resolve(ROOT, scenePath(n)), "utf8")]),
) as SceneTexts;
const CODECS: readonly Codec[] = ["none", "deflate-raw"];

async function openHarness(page: Page, url = HARNESS) {
  await page.goto(url);
  await page.waitForFunction(() => window.harness !== undefined);
}
/** The header's canonical part: everything except the codec-dependent offset and length. */
const sectionTable = (b: Uint8Array) =>
  readHeader(b).sections.map((s) => [s.id, s.kind, s.sha256, s.uncompressedLength]);

test.describe("each engine against Node", () => {
  test.beforeEach(async ({ page }) => openHarness(page));

  for (const codec of CODECS) {
    test(`save → strict load is semantically equal, and equal to Node (${codec})`, async ({
      page,
    }) => {
      const r = await page.evaluate((c) => window.harness!.roundTrip(c), codec);
      expect(r.before.geometry).toHaveLength(3);
      expect(r.before.sources).toHaveLength(1);
      expect(r.after).toEqual(r.before);
      expect(r.before).toEqual(semantic(await buildDocument(TEXTS, { embedded: true })));
      expect(r.serializedDirty).toBe(true); // AM-3.4: serialization does not mark saved
      expect(r.savedClean).toBe(true); // after the explicit markSaved
      expect(r.loadedClean).toBe(true);
      expect(r.loadedCanUndo).toBe(false);
      expect(r.resaveIdentical).toBe(true);
    });

    test(`section sha256 and uncompressedLength equal Node's (${codec})`, async ({ page }) => {
      const engine = fromB64(await page.evaluate((c) => window.harness!.save(c), codec));
      const node = await saveContainer(await buildDocument(TEXTS, { embedded: true }), { codec });
      expect(sectionTable(engine)).toEqual(sectionTable(node));
      const identical = Buffer.compare(engine, node) === 0;
      test
        .info()
        .annotations.push({ type: "bytes identical to Node", description: `${identical}` });
      if (codec === "none") expect(identical).toBe(true);
    });

    test(`malformed input fails atomically with a typed ContainerError (${codec})`, async ({
      page,
    }) => {
      const r = await page.evaluate((c) => window.harness!.attempts(c, "malformed"), codec);
      const codes = Object.fromEntries(
        r.results.map((x) => [
          x.name,
          x.error && [x.error.containerError, x.error.code, x.error.detail],
        ]),
      );
      expect(codes).toEqual({
        "truncated: 8 bytes": [true, "truncated", null],
        "truncated: inside the header": [true, "truncated", null],
        "truncated: last byte missing": [true, "truncated", null],
        "bad magic": [true, "magic", null],
        "oversized header": [true, "header", null],
        "SHA mismatch: header sha256": [true, "sha256", null],
        "corrupt geometry record": [true, "packet", "coord"],
        ...(codec === "none"
          ? { "SHA mismatch: flipped section byte": [true, "sha256", null] }
          : {}),
      });
      expect(r.sameSession && r.sameSnapshot && r.sameState).toBe(true);
      expect(r.revision[1]).toBe(r.revision[0]);
      expect(r.sameContent && r.storeIntegrity).toBe(true);
    });
  }

  test("decompression bomb and declared sizes above the caps fail with typed errors", async ({
    page,
  }) => {
    const r = await page.evaluate(() => window.harness!.attempts("deflate-raw", "limits"));
    const [bomb, ...caps] = r.results;
    // Thrown inside the streaming loop ("beyond"), not by the post-stream length check.
    expect(bomb!.error).toMatchObject({ containerError: true, code: "inflate" });
    expect(bomb!.error!.message).toContain("inflates beyond its uncompressedLength");
    test.info().annotations.push({
      type: "bomb",
      description: `${bomb!.storedBytes}-byte container carrying 256 MiB of deflated zeros; refused in ${bomb!.ms.toFixed(1)} ms`,
    });
    // Three per-section caps, then the session budget (load option), each by its own check.
    expect(caps.map((c) => [c.error?.containerError, c.error?.code])).toEqual(
      Array(4).fill([true, "limit"]),
    );
    for (const c of caps.slice(0, 3)) expect(c.error!.message, c.name).toContain("(cap ");
    expect(caps[3]!.error!.message).toContain("exceed the session budget");
    expect(r.sameSession && r.sameSnapshot && r.sameState && r.sameContent).toBe(true);
    expect(r.revision[1]).toBe(r.revision[0]);
  });

  test("geometry ownership: commit detaches, job copies round-trip a Worker, store stays attached", async ({
    page,
  }) => {
    const r = await page.evaluate(() => window.harness!.ownership(5));
    expect(r.sizes.every((n) => n > 0)).toBe(true);
    expect(r.callerDetached).toEqual([true, true, true, true, true, true]);
    expect(r.rounds).toHaveLength(5);
    for (const round of r.rounds)
      expect(round).toEqual({
        sentDetached: true,
        committedReadable: true,
        returnedTypes: [
          "Uint8Array",
          "Float64Array",
          "Uint32Array",
          "Uint32Array",
          "Uint32Array",
          "Uint32Array",
        ],
        returnedIntact: true,
        recordUnchanged: true,
      });
    expect(r.jobCopies).toBe(5);
  });

  test("missing-source relinking is digest-verified and is not a document edit", async ({
    page,
  }) => {
    for (const codec of CODECS) {
      const r = await page.evaluate((c) => window.harness!.relink(c), codec);
      expect(r.sourceSections).toBe(0);
      expect(r.missing).toHaveLength(1);
      expect(r.wrongDigest).toMatchObject({ documentError: true, code: "invalid_argument" });
      expect(r.wrongSize).toMatchObject({ documentError: true, code: "invalid_argument" });
      expect(r.missingAfterWrong).toEqual(r.missing);
      expect(r.right).toBeNull();
      expect(r.missingAfter).toEqual([]);
      expect(r.bytesMatch).toBe(true);
      expect(r.sameSnapshot).toBe(true);
      expect(r.revision[1]).toBe(r.revision[0]);
      expect(r.dirty).toBe(false);
    }
  });
});

// Launches all three engines itself, so it runs once (in the chromium project only).
test("cross-engine interchange: a project saved in any engine loads in every engine and Node", async ({
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "launches all three engines itself");
  const engines = { chromium, firefox, webkit };
  type Engine = keyof typeof engines;
  const names = Object.keys(engines) as Engine[];
  const browsers: Browser[] = [];
  try {
    const pages = {} as Record<Engine, Page>;
    const versions = {} as Record<Engine, string>;
    for (const e of names) {
      const b = await engines[e].launch();
      browsers.push(b);
      versions[e] = b.version();
      pages[e] = await b.newPage();
      await openHarness(pages[e], new URL(HARNESS, baseURL).href);
    }
    const expected = semantic(await buildDocument(TEXTS, { embedded: true }));
    const findings: Record<string, unknown> = { versions };
    for (const codec of CODECS) {
      const node = await saveContainer(await buildDocument(TEXTS, { embedded: true }), { codec });
      const saved = {} as Record<Engine, string>;
      for (const e of names)
        saved[e] = await pages[e].evaluate((c) => window.harness!.save(c), codec);
      const bytes = (e: Engine) => fromB64(saved[e]);
      for (const saver of names) {
        // engine → Node, engine → every engine
        expect
          .soft(semantic(await loadContainer(bytes(saver), {})), `${saver} → node`)
          .toEqual(expected);
        for (const loader of names)
          expect
            .soft(
              await pages[loader].evaluate((b) => window.harness!.loadSemantic(b), saved[saver]),
              `${saver} → ${loader} (${codec})`,
            )
            .toEqual(expected);
      }
      for (const loader of names)
        expect
          .soft(
            await pages[loader].evaluate((b) => window.harness!.loadSemantic(b), toB64(node)),
            `node → ${loader} (${codec})`,
          )
          .toEqual(expected);
      for (const e of names)
        expect
          .soft(sectionTable(bytes(e)), `${e} section table (${codec})`)
          .toEqual(sectionTable(node));
      const identicalToNode = Object.fromEntries(
        names.map((e) => [e, Buffer.compare(bytes(e), node) === 0]),
      );
      if (codec === "none")
        expect(identicalToNode).toEqual({ chromium: true, firefox: true, webkit: true });
      findings[codec] = {
        sizes: { node: node.length, ...Object.fromEntries(names.map((e) => [e, bytes(e).length])) },
        identicalToNode,
        identicalAcrossEngines: names.every((e) => saved[e] === saved.chromium),
        storedSectionLengths: Object.fromEntries(
          [["node", node] as const, ...names.map((e) => [e, bytes(e)] as const)].map(([k, b]) => [
            k,
            readHeader(b).sections.map((s) => s.length),
          ]),
        ),
      };
    }
    const out = resolve(ROOT, "tests/output/persistence/interchange-findings.json");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(findings, null, 2)}\n`);
    await testInfo.attach("interchange-findings.json", {
      path: out,
      contentType: "application/json",
    });
    console.log(JSON.stringify(findings));
  } finally {
    for (const b of browsers) await b.close();
  }
});
