// G-R0 renderer correctness against the production build: exact settled frames of the vector
// canvas (render worker and main-thread fallback, DPR 1 and 2) compared with the independent
// resvg reference of the engine's SVG export of the same document. 0 geometry-error pixels.
// Interaction (cached) frames are never used as evidence: frames are taken after an exact frame
// for the current view and revision.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { writeOutput } from "./helpers.ts";
import { compare, decodePng, resvgReference } from "./renderer/compare.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const FIX = join(ROOT, "tests/output/renderer-fixtures");
type Manifest = Record<string, { width: number; height: number }>;
let manifest: Manifest = {};

test.beforeAll(() => {
  execFileSync("node", [join(ROOT, "tests/browser/renderer/make-fixtures.ts"), FIX], {
    stdio: "pipe",
  });
  // render_compare is built by tests/browser/global-setup.ts.
  manifest = JSON.parse(readFileSync(join(FIX, "fixtures.json"), "utf8")) as Manifest;
});

const results: unknown[] = [];
test.afterAll(({ browserName }) => {
  writeOutput(`g-r0/${browserName}-correctness.json`, JSON.stringify(results, null, 2));
});

type CanvasApi = {
  diag(): {
    exactFrames: number;
    state: { kind: string; documentRevision?: number; host?: string };
    camera: { scale: number };
  };
  showContainer(b64: string): Promise<number>;
  setView(s: number, tx: number, ty: number): void;
};

type Diag = {
  sessions: number;
  renderRevision: number;
  documentRevision: number;
  state: { kind: string; documentRevision?: number; host?: string };
  lastExact: {
    renderRevision: number;
    camera: { scale: number; tx: number; ty: number };
    host: string;
  } | null;
};
const diagOf = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __vectra: { canvas: { diag(): Diag } } }).__vectra.canvas.diag(),
  );

/** Waits for the complete exact frame of the latest snapshot, drawn with `camera`. */
async function exactFrame(
  page: Page,
  documentRevision: number,
  camera: { scale: number; tx: number; ty: number },
) {
  await expect
    .poll(
      async () => {
        const d = await diagOf(page);
        return (
          d.documentRevision === documentRevision &&
          d.lastExact !== null &&
          d.lastExact.renderRevision === d.renderRevision &&
          d.lastExact.camera.scale === camera.scale &&
          d.lastExact.camera.tx === camera.tx &&
          d.lastExact.camera.ty === camera.ty
        );
      },
      { timeout: 60_000 },
    )
    .toBe(true);
}

for (const host of ["worker", "main-thread"] as const)
  for (const dpr of [1, 2])
    test(`exact frames match the resvg reference: ${host}, DPR ${dpr}`, async ({ browser }) => {
      const context = await browser.newContext({
        deviceScaleFactor: dpr,
        viewport: { width: 1280, height: 900 },
      });
      const page = await context.newPage();
      await page.goto(`/?debug=1${host === "main-thread" ? "&renderer=main" : ""}`);
      await expect
        .poll(() =>
          page.evaluate(() =>
            Boolean((window as unknown as { __vectra?: { canvas?: unknown } }).__vectra?.canvas),
          ),
        )
        .toBe(true);
      const box = (await page.getByTestId("canvas-host").boundingBox())!;
      for (const [name, f] of Object.entries(manifest)) {
        const b64 = readFileSync(join(FIX, `${name}.vectra.b64`), "utf8");
        const sessions = (await diagOf(page)).sessions;
        const revision = await page.evaluate(
          (b) =>
            (
              window as unknown as { __vectra: { canvas: CanvasApi } }
            ).__vectra.canvas.showContainer(b),
          b64,
        );
        // The largest integer scale (≤ 2) that fits, at the canvas origin: integer pixel bounds.
        const scale = Math.max(
          1,
          Math.min(2, Math.floor(Math.min(box.width / f.width, box.height / f.height))),
        );
        // The canvas has the new document (React hands it over asynchronously).
        await expect.poll(async () => (await diagOf(page)).sessions).toBeGreaterThan(sessions);
        await page.evaluate(
          (s) =>
            (window as unknown as { __vectra: { canvas: CanvasApi } }).__vectra.canvas.setView(
              s,
              0,
              0,
            ),
          scale,
        );
        await exactFrame(page, revision, { scale, tx: 0, ty: 0 });
        const d = await page.evaluate(() =>
          (window as unknown as { __vectra: { canvas: CanvasApi } }).__vectra.canvas.diag(),
        );
        expect(d.state).toMatchObject({ kind: "ready", host, documentRevision: revision });
        // Presentation of a worker canvas can lag its exact frame (R02, WebKit): wait until two
        // consecutive captures agree.
        const clip = { x: box.x, y: box.y, width: f.width * scale, height: f.height * scale };
        let png = await page.screenshot({ clip });
        for (let k = 0; k < 20; k++) {
          await page.waitForTimeout(100);
          const next = await page.screenshot({ clip });
          if (next.equals(png)) break;
          png = next;
        }
        writeOutput(`g-r0/frames/${host}-dpr${dpr}-${name}.png`, png);
        const shot = decodePng(png);
        const ref = resvgReference(join(FIX, `${name}.svg`), shot.w, shot.h);
        const c = compare(ref, shot);
        results.push({ host, dpr, name, scale, ...c });
        expect(
          c.geometryErrors,
          `${name} (${host}, DPR ${dpr}, scale ${scale}): ${JSON.stringify(c)}`,
        ).toBe(0);
      }
      await context.close();
    });
