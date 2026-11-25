// G-R1 §6.2 and §6.3 on the integrated workspace (production build, `?debug=1` probes).
// Selection: container identity is never confused with drawable path identity; nested groups,
// hidden and locked descendants, holes, multiple selection, overlay and transform bounds, undo
// and redo, document replacement. Import: a deterministic gate holds the preparation interval
// (decoded, not yet submitted) so rapid repeats, drops, cancellation and document replacement
// are tested without timing.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const ROOT = resolve(import.meta.dirname, "../..");
const FIX = join(ROOT, "tests/output/renderer-fixtures");
const PROCEDURAL = join(ROOT, "tests/fixtures/procedural");
test.beforeAll(() => {
  if (!existsSync(join(FIX, "fixtures.json")))
    execFileSync("node", [join(ROOT, "tests/browser/renderer/make-fixtures.ts"), FIX], {
      stdio: "pipe",
    });
});

type Box = { x: number; y: number; width: number; height: number };
type Tree = {
  id: string;
  kind: string;
  name: string | null;
  locked?: boolean;
  children?: Tree[];
};
type Api = {
  canvas: {
    hitDocument(x: number, y: number): string | null;
    boundsOf(ids: string[]): Box | null;
    itemsOf(id: string): number[];
    diag(): { camera: { scale: number; tx: number; ty: number } } | null;
  };
  workspace: {
    loadContainer(b64: string): Promise<number>;
    tree(): Tree[];
    dispatch(c: unknown): void;
    undo(): void;
    redo(): void;
    selection(): string[];
    select(ids: string[]): void;
    replaceDocument(w: number, h: number): void;
    holdPreparation(): void;
    releasePreparation(): void;
    associated(): boolean;
    jobsSubmitted(): number;
    documentId(): string | null;
    revision(): number | null;
  };
};
// Explicit evaluations only: the production CSP forbids evaluating strings in the page.
const api = (page: Page) => {
  return {
    tree: () =>
      page.evaluate(() => (window as unknown as { __vectra: Api }).__vectra.workspace.tree()),
    items: (id: string) =>
      page.evaluate((i) => (window as unknown as { __vectra: Api }).__vectra.canvas.itemsOf(i), id),
    bounds: (ids: string[]) =>
      page.evaluate(
        (i) => (window as unknown as { __vectra: Api }).__vectra.canvas.boundsOf(i),
        ids,
      ),
    hit: (x: number, y: number) =>
      page.evaluate(
        ([a, b]) => (window as unknown as { __vectra: Api }).__vectra.canvas.hitDocument(a!, b!),
        [x, y],
      ),
    camera: () =>
      page.evaluate(() => (window as unknown as { __vectra: Api }).__vectra.canvas.diag()!.camera),
    dispatch: (c: unknown) =>
      page.evaluate(
        (x) => (window as unknown as { __vectra: Api }).__vectra.workspace.dispatch(x),
        c,
      ),
    undo: () =>
      page.evaluate(() => (window as unknown as { __vectra: Api }).__vectra.workspace.undo()),
    redo: () =>
      page.evaluate(() => (window as unknown as { __vectra: Api }).__vectra.workspace.redo()),
    selection: () =>
      page.evaluate(() => (window as unknown as { __vectra: Api }).__vectra.workspace.selection()),
    select: (ids: string[]) =>
      page.evaluate(
        (i) => (window as unknown as { __vectra: Api }).__vectra.workspace.select(i),
        ids,
      ),
    replace: () =>
      page.evaluate(() =>
        (window as unknown as { __vectra: Api }).__vectra.workspace.replaceDocument(64, 64),
      ),
    hold: () =>
      page.evaluate(() =>
        (window as unknown as { __vectra: Api }).__vectra.workspace.holdPreparation(),
      ),
    release: () =>
      page.evaluate(() =>
        (window as unknown as { __vectra: Api }).__vectra.workspace.releasePreparation(),
      ),
    associated: () =>
      page.evaluate(() => (window as unknown as { __vectra: Api }).__vectra.workspace.associated()),
    jobs: () =>
      page.evaluate(() =>
        (window as unknown as { __vectra: Api }).__vectra.workspace.jobsSubmitted(),
      ),
    documentId: () =>
      page.evaluate(() => (window as unknown as { __vectra: Api }).__vectra.workspace.documentId()),
    revision: () =>
      page.evaluate(() => (window as unknown as { __vectra: Api }).__vectra.workspace.revision()),
  };
};

async function open(page: Page) {
  await page.goto("/workspace.html?debug=1");
  await expect(page.getByRole("navigation", { name: "Tools" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => "__vectra" in window)).toBe(true);
}
const settled = (page: Page) =>
  expect(page.getByTestId("canvas-state")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
async function load(page: Page, fixture: string) {
  const b64 = readFileSync(join(FIX, `${fixture}.vectra.b64`), "utf8");
  await page.evaluate(
    (b) => (window as unknown as { __vectra: Api }).__vectra.workspace.loadContainer(b),
    b64,
  );
  await settled(page);
}
const flat = (t: Tree[]): Tree[] => t.flatMap((n) => [n, ...flat(n.children ?? [])]);
const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
};
const near = (a: Box, b: Box) =>
  expect(
    Math.max(
      Math.abs(a.x - b.x),
      Math.abs(a.y - b.y),
      Math.abs(a.width - b.width),
      Math.abs(a.height - b.height),
    ),
  ).toBeLessThan(1e-6);

/** Clicks a document point on the canvas through the camera (a real pointer click). */
async function clickDoc(page: Page, x: number, y: number, shift = false) {
  const c = await api(page).camera();
  const host = (await page.getByTestId("canvas-host").boundingBox())!;
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.click(host.x + c.tx + x * c.scale, host.y + c.ty + y * c.scale);
  if (shift) await page.keyboard.up("Shift");
}

test("selection: containers resolve to their drawn paths; hidden, locked, holes, clips", async ({
  page,
}) => {
  await open(page);
  await load(page, "synthetic-correctness");
  const a = api(page);
  const all = flat(await a.tree());
  const shapes = all.find((n) => n.kind === "group" && n.name === "shapes")!;
  const clipped = all.find((n) => n.kind === "group" && n.name === "clipped")!;
  const paths = shapes.children!.filter((n) => n.kind === "path");
  expect(paths.length).toBeGreaterThan(6);
  // Nested groups through real commands: G2 ⊃ G1 ⊃ {p0, p1}, G2 ⊃ p2.
  await a.dispatch({ type: "group", ids: [paths[0]!.id, paths[1]!.id], name: "G1" });
  let t = flat(await a.tree());
  const g1 = t.find((n) => n.name === "G1")!;
  await a.dispatch({ type: "group", ids: [g1.id, paths[2]!.id], name: "G2" });
  await settled(page);
  t = flat(await a.tree());
  const g2 = t.find((n) => n.name === "G2")!;
  const [p0, p1, p2] = [paths[0]!.id, paths[1]!.id, paths[2]!.id];
  // A container draws exactly its descendants' items: never its own identity.
  const items = async (id: string) => (await a.items(id)).sort((x, y) => x - y);
  expect(await items(g2.id)).toEqual(
    [...(await items(p0)), ...(await items(p1)), ...(await items(p2))].sort((x, y) => x - y),
  );
  near(
    (await a.bounds([g2.id]))!,
    union(union((await a.bounds([p0]))!, (await a.bounds([p1]))!), (await a.bounds([p2]))!),
  );
  // Hidden descendant: not drawn, so neither in the items nor in the bounds.
  await a.dispatch({ type: "setVisible", ids: [p1], visible: false });
  await settled(page);
  expect(await items(p1)).toEqual([]);
  expect(await items(g2.id)).toEqual(
    [...(await items(p0)), ...(await items(p2))].sort((x, y) => x - y),
  );
  near((await a.bounds([g2.id]))!, union((await a.bounds([p0]))!, (await a.bounds([p2]))!));
  // Locked descendant: still drawn (in items and bounds) but never picked on the canvas.
  await a.dispatch({ type: "setLocked", ids: [p2], locked: true });
  await settled(page);
  expect((await items(p2)).length).toBe(1);
  expect(await a.hit(168, 18)).not.toBe(p2); // the evenodd ring body (path 2) is locked now
  // Holes: no hit inside a nonzero reversed ring or an evenodd ring.
  expect(await a.hit(40, 40)).toBeNull();
  expect(await a.hit(168, 40)).toBeNull();
  // A clip owned by an ancestor does not bound the path; the clipping group's own box does.
  const disc = clipped.children!.find((n) => n.kind === "path")!.id;
  const discBox = (await a.bounds([disc]))!;
  const groupBox = (await a.bounds([clipped.id]))!;
  expect(discBox.height).toBeGreaterThan(groupBox.height);
  expect(groupBox.y).toBeGreaterThanOrEqual(125 - 1e-9); // clip { y: 125, height: 20 }
  expect(groupBox.y + groupBox.height).toBeLessThanOrEqual(145 + 1e-9);

  // The overlay and the inspector use the same box, through the camera.
  await a.select([g2.id]);
  await expect(page.getByTestId("selection-name")).toHaveText("G2");
  const box = (await a.bounds([g2.id]))!;
  const overlay = (await page.getByTestId("selection-bounds").getAttribute("data-bounds"))!
    .split(" ")
    .map(Number);
  near({ x: overlay[0]!, y: overlay[1]!, width: overlay[2]!, height: overlay[3]! }, box);
  const x = Number(await page.getByRole("textbox", { name: "X (px)" }).inputValue());
  expect(Math.abs(x - box.x)).toBeLessThan(0.051);
  const c = await a.camera();
  const host = (await page.getByTestId("canvas-host").boundingBox())!;
  const dom = (await page.getByTestId("selection-bounds").boundingBox())!;
  expect(Math.abs(dom.x - (host.x + c.tx + box.x * c.scale - 1))).toBeLessThan(1.01);
  expect(Math.abs(dom.width - (box.width * c.scale + 2))).toBeLessThan(1.01);
});

test("locks (maintainer review): never moved or deleted, fills skip them, palette edits are disclosed; undo/redo", async ({
  page,
}) => {
  await open(page);
  await load(page, "synthetic-correctness");
  const a = api(page);
  const t0 = await a.tree();
  const layer = t0.find((n) => n.kind === "layer")!;
  const paths = flat(t0)
    .find((n) => n.name === "shapes")!
    .children!.filter((n) => n.kind === "path");
  const [locked, free] = [paths[3]!.id, paths[4]!.id];
  const status = page.getByTestId("status");
  const fill = page.getByRole("button", { name: /^Fill colour: / });
  // Clear first, so the Fill control must disappear and come back for this path (an unchanged
  // "Path N" name would not show that the inspector has re-rendered).
  const hexOf = async (id: string) => {
    await a.select([]);
    await expect(fill).toHaveCount(0);
    await a.select([id]);
    await expect(fill).toHaveCount(1);
    return /#[0-9a-f]{6}/.exec((await fill.getAttribute("aria-label"))!)![0];
  };
  const blur = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // The status bar prefixes alerts with "Error: ".
  const refusal = /Not deleted: ".+" contains 1 locked object\. Unlock it to delete\.$/;
  const lockedHex = await hexOf(locked); // read while unlocked: a locked path has no Fill control
  await a.dispatch({ type: "setLocked", ids: [locked], locked: true });
  await settled(page);
  await a.select([locked]);
  await expect(page.getByText("No unlocked paths in this selection")).toBeVisible();

  // Inspector and pointer: a selection holding a locked object is frozen; a drag pans instead.
  await a.select([layer.id]);
  await expect(page.getByRole("note")).toContainText("Contains locked objects");
  await expect(page.getByRole("textbox", { name: "X (px)" })).toBeDisabled();
  await expect(page.getByTestId("handle-se")).toHaveCount(0);
  const rev0 = await a.revision();
  const box = (await page.getByTestId("selection-bounds").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 20, { steps: 4 });
  await page.mouse.up();
  expect(await a.revision()).toBe(rev0);

  // Keyboard Delete on the layer: refused, explained as an alert; nothing changes.
  await blur();
  await page.keyboard.press("Delete");
  await expect(status).toHaveText(refusal);
  await expect(status).toHaveAttribute("role", "alert");
  expect(await a.revision()).toBe(rev0);
  // The Layers menu's Delete: the same policy.
  await page
    .getByTestId("layer-row")
    .first()
    .getByRole("button", { name: /^More actions for / })
    .click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(status).toHaveText(refusal);
  expect(await a.revision()).toBe(rev0);
  expect((await a.tree()).some((n) => n.id === layer.id)).toBe(true);

  // Inspector fill on the layer: applied to its unlocked paths, never the locked one.
  await a.select([layer.id]);
  await fill.click();
  const hex = page.getByRole("textbox", { name: "Hex" });
  await hex.fill("#2050a0");
  await hex.press("Enter");
  await page.getByRole("button", { name: "Apply" }).click();
  await settled(page);
  expect(await hexOf(free)).toBe("#2050a0");
  // Palette edits do reach locked paths (document semantics, unit-tested); the Recolor panel says so.
  await blur();
  await page.keyboard.press("r");
  await expect(page.getByText(/including locked paths/)).toBeVisible();
  await page.keyboard.press("v");

  // Undo/redo: unlock, delete, then undo both; the lock returns and protects again.
  await a.dispatch({ type: "setLocked", ids: [locked], locked: false });
  expect(await hexOf(locked)).toBe(lockedHex); // the layer fill skipped it while it was locked
  await a.select([layer.id]);
  await blur();
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await a.tree()).some((n) => n.id === layer.id)).toBe(false);
  await page.keyboard.press("ControlOrMeta+z"); // the deletion
  await expect.poll(async () => (await a.tree()).some((n) => n.id === layer.id)).toBe(true);
  await page.keyboard.press("ControlOrMeta+z"); // the unlock
  await expect
    .poll(async () => flat(await a.tree()).find((n) => n.id === locked)!.locked)
    .toBe(true);
  await a.select([layer.id]);
  await blur();
  const rev1 = await a.revision();
  await page.keyboard.press("Delete");
  await expect(status).toHaveText(refusal);
  expect(await a.revision()).toBe(rev1);
  await page.keyboard.press("ControlOrMeta+Shift+z"); // redo the unlock
  await page.keyboard.press("ControlOrMeta+Shift+z"); // redo the deletion
  await expect.poll(async () => (await a.tree()).some((n) => n.id === layer.id)).toBe(false);
});

test("selection: canvas clicks pick paths; shift adds; undo/redo keep it; replacement clears it", async ({
  page,
}) => {
  await open(page);
  await load(page, "synthetic-correctness");
  const a = api(page);
  const ids = flat(await a.tree());
  const shapes = ids.find((n) => n.name === "shapes")!.children!;
  await clickDoc(page, 110, 112); // nonzero pentagram centre: path 4
  await expect(page.getByTestId("selection-name")).toHaveText(/^Path \d+$/);
  await expect.poll(() => a.selection()).toEqual([shapes[4]!.id]);
  await clickDoc(page, 40, 40); // a hole: nothing
  // Hits answer asynchronously (in click order): wait for the answer, not the click.
  await expect.poll(() => a.selection()).toEqual([]);
  await expect(page.getByTestId("selection-bounds")).toHaveCount(0);
  await clickDoc(page, 110, 112);
  await clickDoc(page, 162, 112, true); // topmost translucent disc, added
  const both = [shapes[4]!.id, shapes[7]!.id];
  await expect.poll(() => a.selection()).toEqual(both);
  await expect(page.getByTestId("selection-name")).toHaveText("2 objects");
  near(
    (await a.bounds(both))!,
    union((await a.bounds([both[0]!]))!, (await a.bounds([both[1]!]))!),
  );
  // Undo/redo of an edit keep the selection (IDs survive; the box follows the geometry).
  const before = (await a.bounds(both))!;
  await a.dispatch({ type: "applyTransform", ids: both, matrix: [1, 0, 0, 1, 10, 0] });
  await settled(page);
  expect((await a.bounds(both))!.x).toBeCloseTo(before.x + 10, 9);
  await a.undo();
  await settled(page);
  expect(await a.selection()).toEqual(both);
  near((await a.bounds(both))!, before);
  await a.redo();
  await settled(page);
  expect(await a.selection()).toEqual(both);
  // Delete and undo: the selection comes back with the nodes.
  await a.dispatch({ type: "delete", ids: [both[1]!] });
  await expect(page.getByTestId("selection-name")).toHaveText(/^Path \d+$/);
  await a.undo();
  await expect(page.getByTestId("selection-name")).toHaveText("2 objects");
  // Another document: the selection is cleared. IDs are allocated per document and repeat, so
  // select an ID that the next document also has: a filter on existence alone would keep it.
  const next = JSON.parse(
    Buffer.from(readFileSync(join(FIX, "fixtures.json"))).toString(),
  ) as Record<string, unknown>;
  expect(next["multi-layer"]).toBeTruthy();
  const shared = shapes.map((n) => n.id);
  await a.select(shared);
  await load(page, "multi-layer");
  const inNext = new Set(flat(await a.tree()).map((n) => n.id));
  expect(shared.some((id) => inNext.has(id))).toBe(true); // the check below is not vacuous
  // selection() is the last committed render; `load` can return before React commits the new
  // document (the old one was already "ready"), so wait for it. A kept selection still fails.
  await expect.poll(() => a.selection()).toEqual([]);
  await expect(page.getByTestId("selection-bounds")).toHaveCount(0);
});

// --- import concurrency (§6.3) ------------------------------------------------------------------

async function importFile(page: Page, file: string) {
  await page.getByTestId("import-input").setInputFiles(join(PROCEDURAL, file));
}
async function dropFile(page: Page, file: string) {
  const bytes = readFileSync(join(PROCEDURAL, file)).toString("base64");
  await page.evaluate(
    ({ b, name }) => {
      const dt = new DataTransfer();
      const data = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
      dt.items.add(new File([data], name, { type: "image/png" }));
      document
        .querySelector('[data-testid="canvas-host"]')!
        .dispatchEvent(
          new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }),
        );
    },
    { b: bytes, name: file },
  );
}
const status = (page: Page) => page.getByTestId("status");
const layerNames = (page: Page) =>
  page
    .getByTestId("layer-row")
    .evaluateAll((rows) =>
      rows.map((r) => r.querySelector("button[aria-pressed] span")?.textContent),
    );

test("import: a rapid repeat and a drop during preparation are refused, never interleaved", async ({
  page,
}) => {
  await open(page);
  const a = api(page);
  const jobs0 = await a.jobs();
  await a.hold();
  await importFile(page, "adjacent_colors.png");
  await expect(status(page)).toContainText("Preparing adjacent_colors.png");
  await importFile(page, "nested_rings.png"); // a rapid repeat
  await expect(page.getByTestId("import-refused")).toContainText(
    "nested_rings.png was not imported: another import is in progress",
  );
  await dropFile(page, "circle.png"); // a drop while the first file is still preparing
  await expect(page.getByTestId("import-refused")).toContainText("circle.png was not imported");
  expect(await a.jobs()).toBe(jobs0); // nothing submitted while preparing
  await a.release();
  await expect(status(page)).toContainText("Traced adjacent_colors.png", { timeout: 60_000 });
  await settled(page);
  expect(await layerNames(page)).toEqual(["adjacent_colors"]);
  expect(await a.jobs()).toBe(jobs0 + 1); // exactly one trace
  expect(await a.associated()).toBe(true);
  // After it settles, the next import works.
  await importFile(page, "nested_rings.png");
  await expect(status(page)).toContainText("Traced nested_rings.png", { timeout: 60_000 });
  expect(await layerNames(page)).toEqual(["nested_rings", "adjacent_colors"]);
});

test("import: a failed second import leaves the first document intact", async ({ page }) => {
  await open(page);
  const a = api(page);
  await importFile(page, "adjacent_colors.png");
  await expect(status(page)).toContainText("Traced adjacent_colors.png", { timeout: 60_000 });
  const doc = await a.documentId();
  await page.getByTestId("import-input").setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("not a png"),
  });
  await expect(status(page)).toContainText("Import failed");
  expect(await a.documentId()).toBe(doc);
  expect(await layerNames(page)).toEqual(["adjacent_colors"]);
  expect(await a.associated()).toBe(true);
  await settled(page);
});

test("import: cancelled during preparation, no job and no document", async ({ page }) => {
  await open(page);
  const a = api(page);
  const jobs0 = await a.jobs();
  await a.hold();
  await importFile(page, "adjacent_colors.png");
  await expect(status(page)).toContainText("Preparing adjacent_colors.png");
  await page.getByRole("button", { name: "Cancel import" }).click();
  await a.release();
  await expect(status(page)).toContainText("Import cancelled; the document is unchanged");
  await expect(page.getByTestId("document-title")).toHaveText("No document");
  expect(await a.jobs()).toBe(jobs0);
  expect(await a.associated()).toBe(true);
});

test("import: the document replaced during preparation discards the import", async ({ page }) => {
  await open(page);
  const a = api(page);
  await importFile(page, "adjacent_colors.png");
  await expect(status(page)).toContainText("Traced adjacent_colors.png", { timeout: 60_000 });
  const jobs0 = await a.jobs();
  await a.hold();
  await importFile(page, "nested_rings.png");
  await expect(status(page)).toContainText("Preparing nested_rings.png");
  await a.replace(); // e.g. Open: another document is shown while the file is prepared
  const replaced = await a.documentId();
  await a.release();
  await expect(status(page)).toContainText(
    "The document changed while the image was being prepared",
  );
  expect(await a.documentId()).toBe(replaced);
  await expect(page.getByTestId("layer-row")).toHaveCount(0); // nothing landed anywhere
  expect(await a.jobs()).toBe(jobs0);
  expect(await a.associated()).toBe(true);
});

test("import: a trace whose document is replaced mid-trace is stale and lands nowhere", async ({
  page,
}) => {
  await open(page);
  const a = api(page);
  await importFile(page, "adjacent_colors.png");
  await expect(status(page)).toContainText("Traced adjacent_colors.png", { timeout: 60_000 });
  // A long trace (Full Colour, generated 3000×3000), replaced while the worker runs.
  await page.getByRole("button", { name: "Trace", exact: true }).click();
  await page.getByRole("radio", { name: "Full Colour" }).check();
  await page.evaluate(async () => {
    const c = new OffscreenCanvas(3000, 3000);
    const ctx = c.getContext("2d")!;
    for (let i = 0; i < 600; i++) {
      ctx.fillStyle = `hsl(${(i * 37) % 360} 60% ${25 + (i % 50)}%)`;
      ctx.beginPath();
      ctx.arc(((i * 7919) % 1000) * 3, ((i * 104729) % 1000) * 3, 12 + (i % 25) * 3, 0, 7);
      ctx.fill();
    }
    const dt = new DataTransfer();
    dt.items.add(new File([await c.convertToBlob()], "large.png", { type: "image/png" }));
    document
      .querySelector('[data-testid="canvas-host"]')!
      .dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await expect(status(page)).toContainText("Tracing large.png", { timeout: 30_000 });
  await a.replace();
  const replaced = await a.documentId();
  await expect(status(page)).toContainText("Trace discarded: the document changed", {
    timeout: 120_000,
  });
  expect(await a.documentId()).toBe(replaced);
  await expect(page.getByTestId("layer-row")).toHaveCount(0);
  expect(await a.associated()).toBe(true);
});
