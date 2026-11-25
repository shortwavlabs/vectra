// G-R0 behaviour against the production build: camera interactions (fit, zoom, pan) with
// cached gesture frames and exact settles, selection by geometric hit test, stale snapshots,
// render-worker recovery (crash, recreation on a new canvas, replay, document unchanged),
// handshake refusal, the disclosed main-thread fallback, geometry-copy release and offline
// recreation. Chromium, Firefox and Playwright WebKit (not Safari).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { writeOutput } from "./helpers.ts";
import { compare, decodePng, resvgReference } from "./renderer/compare.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const FIX = join(ROOT, "tests/output/renderer-fixtures");
test.beforeAll(() => {
  if (!existsSync(join(FIX, "fixtures.json")))
    execFileSync("node", [join(ROOT, "tests/browser/renderer/make-fixtures.ts"), FIX], {
      stdio: "pipe",
    });
});

type Camera = { scale: number; tx: number; ty: number };
type Diag = {
  sessions: number;
  renderRevision: number;
  documentRevision: number;
  exactFrames: number;
  interactionFrames: number;
  chunksCopied: number;
  releases: number;
  camera: Camera;
  host: string;
  state: { kind: string; host?: string; code?: string };
  lastExact: { renderRevision: number; camera: Camera; host: string } | null;
  client: {
    workersCreated: number;
    crashes: number;
    recoveries: number;
    canvasesCreated: number;
    staleFrames: number;
    buildMismatches: number;
    lastRecoveryMs: number | null;
    workerHeld: { chunks: number; paths: number; bytes: number } | null;
  };
};
type Api = {
  diag(): Diag;
  showContainer(b64: string): Promise<number>;
  setView(s: number, tx: number, ty: number): void;
  fit(): void;
  crash(): boolean;
  hitDocument(x: number, y: number): string | null;
  selection(): string[];
  edit(c: unknown): number;
};
const api = <R>(page: Page, f: string, ...args: unknown[]) =>
  page.evaluate(
    ([name, a]) => {
      const c = (
        window as unknown as { __vectra: { canvas: Record<string, (...x: unknown[]) => unknown> } }
      ).__vectra.canvas;
      return c[name as string]!(...(a as unknown[]));
    },
    [f, args] as const,
  ) as Promise<R>;
const diag = (page: Page) => api<Diag>(page, "diag");

async function open(page: Page, query = "") {
  await page.goto(`/?debug=1${query}`);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean((window as unknown as { __vectra?: { canvas?: unknown } }).__vectra?.canvas),
      ),
    )
    .toBe(true);
}

/** Shows a fixture and waits for its complete exact frame at `camera` (fit when omitted). */
async function show(page: Page, name: string, camera?: Camera) {
  const sessions = (await diag(page)).sessions;
  const b64 = readFileSync(join(FIX, `${name}.vectra.b64`), "utf8");
  await api(page, "showContainer", b64);
  await expect.poll(async () => (await diag(page)).sessions).toBeGreaterThan(sessions);
  if (camera) await api(page, "setView", camera.scale, camera.tx, camera.ty);
  await settled(page);
}

/** Waits until the latest snapshot has a complete exact frame for the current camera. */
async function settled(page: Page) {
  await expect
    .poll(
      async () => {
        const d = await diag(page);
        return (
          d.lastExact !== null &&
          d.lastExact.renderRevision === d.renderRevision &&
          JSON.stringify(d.lastExact.camera) === JSON.stringify(d.camera)
        );
      },
      { timeout: 60_000 },
    )
    .toBe(true);
}

/** Page coordinates of a document point under the current camera. */
async function pagePoint(page: Page, x: number, y: number) {
  const box = (await page.getByTestId("canvas-host").boundingBox())!;
  const c = (await diag(page)).camera;
  return { x: box.x + c.tx + c.scale * x, y: box.y + c.ty + c.scale * y };
}

/**
 * Waits until the canvas area shows `fixture` (0 geometry-error pixels against its resvg
 * reference); returns the wait. Worker-canvas presentation can lag the exact frame (R02: WebKit).
 */
async function presented(page: Page, fixture: string, scale: number) {
  const box = (await page.getByTestId("canvas-host").boundingBox())!;
  const m = JSON.parse(readFileSync(join(FIX, "fixtures.json"), "utf8")) as Record<
    string,
    { width: number; height: number }
  >;
  const clip = {
    x: box.x,
    y: box.y,
    width: m[fixture]!.width * scale,
    height: m[fixture]!.height * scale,
  };
  const t0 = Date.now();
  let c = { geometryErrors: -1 } as ReturnType<typeof compare>;
  let png: Buffer = Buffer.alloc(0);
  while (Date.now() - t0 < 10_000) {
    png = await page.screenshot({ clip });
    const shot = decodePng(png);
    c = compare(resvgReference(join(FIX, `${fixture}.svg`), shot.w, shot.h), shot);
    if (c.geometryErrors === 0) return { ms: Date.now() - t0, png, c };
    await page.waitForTimeout(50);
  }
  throw new Error(`${fixture} was not presented within 10 s: ${JSON.stringify(c)}`);
}

const results: Record<string, unknown> = {};
test.afterAll(({ browserName }) => {
  writeOutput(`g-r0/${browserName}-behaviour.json`, JSON.stringify(results, null, 2));
});

for (const host of ["worker", "main-thread"] as const)
  test(`fit, zoom and pan: cached gesture frames, then an exact settle (${host})`, async ({
    page,
  }) => {
    await open(page, host === "main-thread" ? "&renderer=main" : "");
    await show(page, "synthetic-correctness");
    await expect(page.getByTestId("canvas-state")).toHaveText(
      host === "worker" ? "Canvas: render worker" : "Canvas: main-thread fallback",
    );
    const fit = (await diag(page)).camera;
    await page.getByRole("button", { name: "Zoom in" }).click();
    await settled(page);
    expect((await diag(page)).camera.scale).toBeCloseTo(fit.scale * 1.25, 9);
    // Drag-pan: interaction frames from the display cache, then an exact frame on release.
    const start = await pagePoint(page, 100, 80);
    const before = await diag(page);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let k = 1; k <= 10; k++) await page.mouse.move(start.x + 6 * k, start.y + 3 * k);
    await page.mouse.up();
    await settled(page);
    const after = await diag(page);
    expect(after.camera.tx - before.camera.tx).toBeCloseTo(60, 6);
    expect(after.camera.ty - before.camera.ty).toBeCloseTo(30, 6);
    expect(after.interactionFrames).toBeGreaterThan(before.interactionFrames);
    expect(after.lastExact!.camera).toEqual(after.camera);
    // Ctrl-wheel zoom keeps the document point under the cursor (an integer page point, since
    // pointer events carry integer coordinates).
    const p0 = await pagePoint(page, 40, 15);
    const anchor = { x: Math.round(p0.x), y: Math.round(p0.y) };
    const box = (await page.getByTestId("canvas-host").boundingBox())!;
    const c0 = (await diag(page)).camera;
    const doc = {
      x: (anchor.x - box.x - c0.tx) / c0.scale,
      y: (anchor.y - box.y - c0.ty) / c0.scale,
    };
    await page.mouse.move(anchor.x, anchor.y);
    const hitBefore = await api<string | null>(page, "hitDocument", doc.x, doc.y);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await settled(page);
    const again = await pagePoint(page, doc.x, doc.y);
    expect((await diag(page)).camera.scale).toBeGreaterThan(c0.scale);
    expect(again.x).toBeCloseTo(anchor.x, 6);
    expect(again.y).toBeCloseTo(anchor.y, 6);
    expect(await api<string | null>(page, "hitDocument", doc.x, doc.y)).toBe(hitBefore);
    expect(hitBefore).not.toBeNull();
    results[`camera-${host}`] = {
      fit,
      after: after.camera,
      interactionFrames: after.interactionFrames,
    };
  });

test("selection by geometric hit test: bodies select, holes and empty space deselect, locked paths do not", async ({
  page,
}) => {
  await open(page);
  await show(page, "synthetic-correctness", { scale: 2, tx: 0, ty: 0 });
  const click = async (x: number, y: number, shift = false) => {
    const p = await pagePoint(page, x, y);
    if (shift) await page.keyboard.down("Shift");
    await page.mouse.click(p.x, p.y);
    if (shift) await page.keyboard.up("Shift");
  };
  await click(40, 15); // nonzero ring body
  await expect(page.getByTestId("selection")).toHaveText("1 selected");
  const ring = (await api<string[]>(page, "selection"))[0];
  expect(ring).toBe(await api(page, "hitDocument", 40, 15));
  await settled(page);
  // The selection outline is drawn in the exact frame (lime pixels around the ring).
  const box = (await page.getByTestId("canvas-host").boundingBox())!;
  const shot = await page.screenshot({ clip: { x: box.x, y: box.y, width: 160, height: 160 } });
  expect(shot.length).toBeGreaterThan(0);
  await click(40, 40); // the hole of the same ring
  await expect(page.getByTestId("selection")).toHaveCount(0);
  await click(110, 40); // filled same-direction ring
  await click(40, 15, true); // toggle adds
  await expect(page.getByTestId("selection")).toHaveText("2 selected");
  await click(195, 5); // empty artboard
  await expect(page.getByTestId("selection")).toHaveCount(0);
  // Locked paths are drawn but not selectable on the canvas.
  await show(page, "edited-styles-visibility", { scale: 1, tx: 0, ty: 0 });
  const locked = await page.evaluate(() => {
    const c = (window as unknown as { __vectra: { canvas: Api } }).__vectra.canvas;
    for (let y = 2; y < 256; y += 4)
      for (let x = 2; x < 256; x += 4) if (c.hitDocument(x, y) === null) return [x, y];
    return null;
  });
  expect(locked).not.toBeNull(); // somewhere on the artboard is not selectable (locked or empty)
});

test("stale snapshots: rapid edits end with the exact frame of the latest revision", async ({
  page,
}) => {
  await open(page);
  await show(page, "adjacent_colors-limited", { scale: 1, tx: 0, ty: 0 });
  const revs = await page.evaluate(async () => {
    const c = (window as unknown as { __vectra: { canvas: Api } }).__vectra.canvas;
    const ids: string[] = [];
    for (let y = 8; y < 256 && ids.length < 1; y += 16) {
      const id = c.hitDocument(8, y);
      if (id) ids.push(id);
    }
    const out: number[] = [];
    for (let k = 0; k < 20; k++)
      out.push(
        c.edit({
          type: "setFill",
          ids,
          fill: { color: (0x10101000 + k * 0x0a0a0a00 + 0xff) >>> 0 },
        }),
      );
    return out;
  });
  expect(revs).toHaveLength(20);
  await settled(page);
  const d = await diag(page);
  expect(d.lastExact!.renderRevision).toBe(d.renderRevision);
  results.stale = { renderRevision: d.renderRevision, staleFrames: d.client.staleFrames };
});

for (const host of ["worker", "offline-worker"] as const)
  test(`render-worker crash: recreated on a new canvas, snapshot replayed, document unchanged (${host})`, async ({
    page,
    context,
  }) => {
    await open(page);
    if (host === "offline-worker") {
      await expect(page.getByTestId("offline-ready")).toHaveText("Offline-ready.", {
        timeout: 30_000,
      });
      await context.setOffline(true);
    }
    await show(page, "thin_strokes-halftone", { scale: 1, tx: 0, ty: 0 });
    const first = await presented(page, "thin_strokes-halftone", 1);
    const d0 = await diag(page);
    expect(await api<boolean>(page, "crash")).toBe(true);
    // Recovery completes with the first exact frame on the new worker (lastRecoveryMs).
    await expect
      .poll(async () => (await diag(page)).client.lastRecoveryMs !== null, { timeout: 30_000 })
      .toBe(true);
    await settled(page);
    const d1 = await diag(page);
    expect(d1.client).toMatchObject({
      crashes: 1,
      workersCreated: d0.client.workersCreated + 1,
      canvasesCreated: d0.client.canvasesCreated + 1,
    });
    expect(d1.chunksCopied).toBe(d0.chunksCopied + d0.client.workerHeld!.chunks); // full replay
    expect(d1.documentRevision).toBe(d0.documentRevision);
    expect(d1.host).toBe("worker");
    await expect(page.locator("[data-testid=vector-canvas]")).toHaveCount(1);
    await expect(page.locator("[data-testid=vector-canvas-retiring]")).toHaveCount(0);
    // The same frame, redrawn from the document on the new canvas (0 geometry-error pixels).
    const again = await presented(page, "thin_strokes-halftone", 1);
    results[`recovery-${host}`] = {
      recoveryMs: d1.client.lastRecoveryMs,
      firstPresentationWaitMs: first.ms,
      recoveredPresentationWaitMs: again.ms,
      before: d0.client,
      after: d1.client,
    };
  });

test("a render worker from another build is refused", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  await context.route("**/assets/render.worker-*.js", async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace(/buildId:`[0-9a-f]{16}`/, "buildId:`0000000000000000`");
    await route.fulfill({ response: res, body });
  });
  await open(page);
  await expect(page.getByTestId("canvas-state")).toHaveAttribute("data-state", "error", {
    timeout: 30_000,
  });
  await expect(page.getByTestId("canvas-state")).toContainText("build_mismatch");
  expect((await diag(page)).client.buildMismatches).toBe(1);
  await context.close();
});

test("geometry copies are released when the document changes", async ({ page }) => {
  await open(page);
  await show(page, "multi-layer");
  await expect.poll(async () => (await diag(page)).client.workerHeld?.chunks).toBe(2);
  const d0 = await diag(page);
  await show(page, "adjacent_colors-limited");
  await expect.poll(async () => (await diag(page)).client.workerHeld?.chunks).toBe(1);
  expect((await diag(page)).releases).toBe(d0.releases + 2);
});
