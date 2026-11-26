// G-R1, RFC-002 §8.4: layered drag caches qualified against exact frames. For each case the
// drag frame (cached static layers below/between/above the selection; moving layers blitted for
// a translation, moving items redrawn as vectors for a scale) is captured, then the same
// transform is committed and the renderer's exact frame of that document is captured. The two
// must not differ by a single geometry-error pixel (difference > 48 outside the reference's
// antialiasing band: the G-R0 metric). Translations are exact at integer device pixels;
// fractional translations and scales are held to the same 0 geometry errors (measured, reported).
// Pointer-driven tests cover move, handles, Escape and the lock rule through the real UI.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { writeOutput } from "./helpers.ts";
import { compare, decodePng } from "./renderer/compare.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const FIX = join(ROOT, "tests/output/renderer-fixtures");
test.beforeAll(() => {
  if (!existsSync(join(FIX, "fixtures.json")))
    execFileSync("node", [join(ROOT, "tests/browser/renderer/make-fixtures.ts"), FIX], {
      stdio: "pipe",
    });
});
test.use({ deviceScaleFactor: 2, viewport: { width: 1200, height: 820 } });

type M6 = [number, number, number, number, number, number];
type Tree = { id: string; kind: string; name: string | null; children?: Tree[] };
type Diag = {
  state: { kind: string };
  renderRevision: number;
  documentRevision: number;
  lastExact: { renderRevision: number } | null;
  dragFrames: number;
  lastDragMode: string | null;
  lastDragMs: number | null;
  camera: { scale: number; tx: number; ty: number };
};
type Api = {
  canvas: {
    diag(): Diag;
    beginDrag(ids: string[]): boolean;
    dragTo(m: M6): void;
    endDrag(commit: boolean): void;
  };
  workspace: {
    loadContainer(b64: string): Promise<number>;
    tree(): Tree[];
    dispatch(c: unknown): void;
    undo(): void;
    select(ids: string[]): void;
    revision(): number;
  };
};
const V = "__vectra";
const diag = (p: Page) =>
  p.evaluate((v) => (window as unknown as Record<string, Api>)[v]!.canvas.diag(), V);
const tree = (p: Page) =>
  p.evaluate((v) => (window as unknown as Record<string, Api>)[v]!.workspace.tree(), V);
const dispatch = (p: Page, c: unknown) =>
  p.evaluate(
    ([v, x]) => (window as unknown as Record<string, Api>)[v as string]!.workspace.dispatch(x),
    [V, c] as const,
  );
const revision = (p: Page) =>
  p.evaluate((v) => (window as unknown as Record<string, Api>)[v]!.workspace.revision(), V);
const flat = (t: Tree[]): Tree[] => t.flatMap((n) => [n, ...flat(n.children ?? [])]);

async function settled(p: Page) {
  await expect
    .poll(
      async () => {
        const d = await diag(p);
        return d.state.kind === "ready" && d.lastExact?.renderRevision === d.renderRevision;
      },
      { timeout: 60_000 },
    )
    .toBe(true);
}
async function open(p: Page, fixture: string) {
  await p.goto("/workspace.html?debug=1");
  await expect.poll(() => p.evaluate((v) => v in window, V)).toBe(true);
  const b64 = readFileSync(join(FIX, `${fixture}.vectra.b64`), "utf8");
  await p.evaluate(
    ([v, b]) =>
      (window as unknown as Record<string, Api>)[v as string]!.workspace.loadContainer(b as string),
    [V, b64] as const,
  );
  await settled(p);
}
/** The visible canvas, once two consecutive captures agree (presentation can lag a frame). */
async function stableShot(p: Page) {
  const canvas = p.locator('[data-testid="vector-canvas"]').last();
  let prev = await canvas.screenshot();
  for (let i = 0; i < 20; i++) {
    await p.waitForTimeout(60);
    const next = await canvas.screenshot();
    if (next.equals(prev)) return decodePng(next);
    prev = next;
  }
  return decodePng(prev);
}
/** Device pixels → document units at the current camera (DPR 2). */
const dev = async (p: Page, px: number) => px / ((await diag(p)).camera.scale * 2);

interface Case {
  name: string;
  fixture: string;
  setup?: (p: Page) => Promise<void>;
  ids: (p: Page) => Promise<string[]>;
  pose: (p: Page) => Promise<M6>;
}
const shapes = async (p: Page) => flat(await tree(p)).find((n) => n.name === "shapes")!.children!;
const clipped = async (p: Page) => flat(await tree(p)).find((n) => n.name === "clipped")!;
const translate = (kx: number, ky: number) => async (p: Page) =>
  [1, 0, 0, 1, await dev(p, kx), await dev(p, ky)] as M6;

const CASES: Case[] = [
  {
    name: "bottom of paint order",
    fixture: "synthetic-correctness",
    ids: async (p) => [(await shapes(p))[0]!.id],
    pose: translate(37, 23),
  },
  {
    name: "middle of paint order",
    fixture: "synthetic-correctness",
    ids: async (p) => [(await shapes(p))[4]!.id],
    pose: translate(-41, 16),
  },
  {
    name: "top of paint order",
    fixture: "synthetic-correctness",
    ids: async (p) => [(await shapes(p)).at(-1)!.id],
    pose: translate(-30, -45),
  },
  {
    name: "non-contiguous multi-selection",
    fixture: "synthetic-correctness",
    ids: async (p) => {
      const s = await shapes(p);
      return [s[1]!.id, s[6]!.id];
    },
    pose: translate(52, 31),
  },
  {
    name: "translucent overlap: the middle disc moves between the others",
    fixture: "synthetic-correctness",
    ids: async (p) => [(await shapes(p))[6]!.id],
    pose: translate(18, -12),
  },
  {
    name: "clip owned outside the selection stays fixed",
    fixture: "synthetic-correctness",
    ids: async (p) => [(await clipped(p)).children!.find((n) => n.kind === "path")!.id],
    pose: translate(25, 19),
  },
  {
    name: "clip owned by the selection moves with it",
    fixture: "synthetic-correctness",
    ids: async (p) => [(await clipped(p)).id],
    pose: translate(-27, -33),
  },
  {
    name: "nested groups (a group inside a moved group, and a hidden descendant)",
    fixture: "synthetic-correctness",
    setup: async (p) => {
      const s = await shapes(p);
      await dispatch(p, { type: "group", ids: [s[0]!.id, s[1]!.id], name: "G1" });
      const g1 = flat(await tree(p)).find((n) => n.name === "G1")!;
      await dispatch(p, { type: "group", ids: [g1.id, s[5]!.id], name: "G2" });
      await dispatch(p, { type: "setVisible", ids: [s[1]!.id], visible: false });
      await settled(p);
    },
    ids: async (p) => [flat(await tree(p)).find((n) => n.name === "G2")!.id],
    pose: translate(44, -18),
  },
  {
    name: "layer transforms (multi-layer, a scaled top layer)",
    fixture: "multi-layer",
    ids: async (p) => [(await tree(p)).at(-1)!.id],
    pose: translate(-60, 40),
  },
  {
    name: "fractional device-pixel translation",
    fixture: "synthetic-correctness",
    ids: async (p) => {
      const s = await shapes(p);
      return [s[2]!.id, s[7]!.id];
    },
    pose: translate(13.37, -7.61),
  },
  {
    name: "scale about a corner (handle pose: vectors redrawn live)",
    fixture: "synthetic-correctness",
    ids: async (p) => [(await shapes(p))[3]!.id],
    pose: async () => [1.35, 0, 0, 1.35, -40, -30],
  },
  {
    name: "one-axis scale of a non-contiguous selection",
    fixture: "synthetic-correctness",
    ids: async (p) => {
      const s = await shapes(p);
      return [s[0]!.id, s[7]!.id];
    },
    pose: async () => [0.7, 0, 0, 1, 25, 0],
  },
];

const results: Record<string, unknown>[] = [];
test.afterAll(({ browserName }) => {
  writeOutput(`g-r1/drag-correctness-${browserName}.json`, JSON.stringify(results, null, 2));
});

for (const c of CASES)
  test(`drag frame = exact frame: ${c.name}`, async ({ page, browserName }) => {
    await open(page, c.fixture);
    await c.setup?.(page);
    const ids = await c.ids(page);
    const m = await c.pose(page);
    const rev0 = await revision(page);
    const frames = (await diag(page)).dragFrames;
    expect(
      await page.evaluate(
        ([v, i]) =>
          (window as unknown as Record<string, Api>)[v as string]!.canvas.beginDrag([
            ...(i as readonly string[]),
          ]),
        [V, ids] as const,
      ),
    ).toBe(true);
    await page.evaluate(
      ([v, x]) => (window as unknown as Record<string, Api>)[v as string]!.canvas.dragTo(x as M6),
      [V, m] as const,
    );
    await expect.poll(async () => (await diag(page)).dragFrames).toBeGreaterThan(frames);
    const drag = await stableShot(page);
    const d = await diag(page);
    expect(await revision(page)).toBe(rev0); // the preview is display only
    await page.evaluate(
      (v) => (window as unknown as Record<string, Api>)[v]!.canvas.endDrag(true),
      V,
    );
    await expect.poll(() => revision(page)).toBe(rev0 + 1); // one command
    await settled(page);
    const exact = await stableShot(page);
    const r = compare(exact, drag);
    results.push({
      browser: browserName,
      case: c.name,
      mode: d.lastDragMode,
      dragMs: d.lastDragMs,
      ...r,
    });
    test.info().annotations.push({
      type: "comparison",
      description: JSON.stringify({ mode: d.lastDragMode, ...r }),
    });
    expect(r.geometryErrors, JSON.stringify(r)).toBe(0);
  });

test("an edit during a drag invalidates the layers: the drag frame shows it", async ({ page }) => {
  await open(page, "synthetic-correctness");
  const s = await shapes(page);
  const m: M6 = [1, 0, 0, 1, await dev(page, 30), await dev(page, 20)];
  await page.evaluate(
    ([v, i]) =>
      (window as unknown as Record<string, Api>)[v as string]!.canvas.beginDrag([
        ...(i as readonly string[]),
      ]),
    [V, [s[6]!.id]] as const,
  );
  await page.evaluate(
    ([v, x]) => (window as unknown as Record<string, Api>)[v as string]!.canvas.dragTo(x as M6),
    [V, m] as const,
  );
  await expect.poll(async () => (await diag(page)).dragFrames).toBeGreaterThan(0);
  const frames = (await diag(page)).dragFrames;
  // A fill change of an unselected path below the moving one, mid-drag.
  await dispatch(page, { type: "setFill", ids: [s[5]!.id], fill: { color: 0x2266ccff } });
  await expect.poll(async () => (await diag(page)).dragFrames).toBeGreaterThan(frames);
  const drag = await stableShot(page);
  await page.evaluate(
    (v) => (window as unknown as Record<string, Api>)[v]!.canvas.endDrag(true),
    V,
  );
  await settled(page);
  const exact = await stableShot(page);
  const r = compare(exact, drag);
  expect(r.geometryErrors, JSON.stringify(r)).toBe(0);
});

// --- the real pointer path ----------------------------------------------------------------------

async function boxCenter(page: Page) {
  const b = (await page.getByTestId("selection-bounds").boundingBox())!;
  return [b.x + b.width / 2, b.y + b.height / 2] as const;
}

test("pointer: a drag inside the selection moves it (one undo step); Escape cancels", async ({
  page,
}) => {
  await open(page, "synthetic-correctness");
  const layer = (await tree(page))[0]!.id;
  await page.evaluate(
    ([v, i]) =>
      (window as unknown as Record<string, Api>)[v as string]!.workspace.select([i as string]),
    [V, layer] as const,
  );
  await expect(page.getByTestId("selection-bounds")).toHaveAttribute("data-transformable", "true");
  const before = (await page.getByTestId("selection-bounds").getAttribute("data-bounds"))!;
  const rev0 = await revision(page);
  const scale = (await diag(page)).camera.scale;
  // Escape during a drag: nothing committed, no history entry.
  let [x, y] = await boxCenter(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 20, y + 10, { steps: 4 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await revision(page)).toBe(rev0);
  await expect(page.getByTestId("selection-bounds")).toHaveAttribute("data-bounds", before);
  // A completed drag: one command, the box moved by the pointer delta in document units.
  [x, y] = await boxCenter(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 24, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => revision(page)).toBe(rev0 + 1);
  await settled(page);
  const after = (await page.getByTestId("selection-bounds").getAttribute("data-bounds"))!
    .split(" ")
    .map(Number);
  const b0 = before.split(" ").map(Number);
  expect(after[0]! - b0[0]!).toBeCloseTo(40 / scale, 6);
  expect(after[1]! - b0[1]!).toBeCloseTo(24 / scale, 6);
  await page.evaluate((v) => (window as unknown as Record<string, Api>)[v]!.workspace.undo(), V);
  await expect(page.getByTestId("selection-bounds")).toHaveAttribute("data-bounds", before);
});

test("pointer: a corner handle scales uniformly about the opposite corner", async ({ page }) => {
  await open(page, "synthetic-correctness");
  const layer = (await tree(page))[0]!.id;
  await page.evaluate(
    ([v, i]) =>
      (window as unknown as Record<string, Api>)[v as string]!.workspace.select([i as string]),
    [V, layer] as const,
  );
  const b0 = (await page.getByTestId("selection-bounds").getAttribute("data-bounds"))!
    .split(" ")
    .map(Number);
  const rev0 = await revision(page);
  const h = (await page.getByTestId("handle-se").boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  // Inside the viewport: Playwright's Firefox delivers no pointerup outside it.
  await page.mouse.move(h.x + h.width / 2 + 60, h.y + h.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => revision(page)).toBe(rev0 + 1);
  await settled(page);
  const b1 = (await page.getByTestId("selection-bounds").getAttribute("data-bounds"))!
    .split(" ")
    .map(Number);
  expect(b1[0]).toBeCloseTo(b0[0]!, 6); // the opposite (top-left) corner is fixed
  expect(b1[1]).toBeCloseTo(b0[1]!, 6);
  expect(b1[2]! / b0[2]!).toBeCloseTo(b1[3]! / b0[3]!, 6); // uniform
  expect(b1[2]! / b0[2]!).toBeGreaterThan(1);
});

// Found by the G-UI-R closure (Firefox): a handle drag left a text-selection range over the
// canvas overlay, and Firefox turned the next handle drag starting inside it into a native drag
// (pointercancel), losing the transform. The canvas host is never a text selection.
test("pointer: consecutive handle drags each commit; a drag leaves no text selection", async ({
  page,
}) => {
  await open(page, "synthetic-correctness");
  const layer = (await tree(page))[0]!.id;
  await page.evaluate(
    ([v, i]) =>
      (window as unknown as Record<string, Api>)[v as string]!.workspace.select([i as string]),
    [V, layer] as const,
  );
  const drag = async (dir: string, dx: number) => {
    const h = (await page.getByTestId(`handle-${dir}`).boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2 + dx, h.y + h.height / 2, { steps: 8 });
    await page.mouse.up();
  };
  const rev0 = await revision(page);
  await drag("w", -30);
  await expect.poll(() => revision(page)).toBe(rev0 + 1);
  expect(await page.evaluate(() => getSelection()?.toString() ?? "")).toBe("");
  await settled(page);
  await drag("e", 30);
  await expect.poll(() => revision(page)).toBe(rev0 + 2);
  expect(await page.evaluate(() => getSelection()?.toString() ?? "")).toBe("");
});

test("lock: a selection containing a locked object has no handles and does not move", async ({
  page,
}) => {
  await open(page, "synthetic-correctness");
  const s = await shapes(page);
  const layer = (await tree(page))[0]!.id;
  await dispatch(page, { type: "setLocked", ids: [s[3]!.id], locked: true });
  await page.evaluate(
    ([v, i]) =>
      (window as unknown as Record<string, Api>)[v as string]!.workspace.select([i as string]),
    [V, layer] as const,
  );
  await expect(page.getByTestId("selection-bounds")).toHaveAttribute("data-transformable", "false");
  await expect(page.getByTestId("handle-se")).toHaveCount(0);
  await expect(page.getByRole("note")).toContainText("Contains locked objects");
  const rev0 = await revision(page);
  const cam0 = (await diag(page)).camera;
  const [x, y] = await boxCenter(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 30, y + 30, { steps: 4 });
  await page.mouse.up();
  expect(await revision(page)).toBe(rev0); // not moved
  expect((await diag(page)).camera.tx).not.toBe(cam0.tx); // the drag panned instead
});
