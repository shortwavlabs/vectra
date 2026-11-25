// G-R1 §6.4: the renderer lifecycle in the integrated workspace. Worker start-up, crash
// recovery, generation and build validation, stale-frame rejection and geometry-copy release.
// Covered on the production build, and in React development StrictMode (the dev server
// double-invokes effects), including repeated mount/unmount of the canvas. Live workers are
// counted by wrapping the Worker constructor in an init script: injected by the automation
// protocol, not an inline page script.
import { type ChildProcess, spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

const ROOT = resolve(import.meta.dirname, "../..");
const FIX = join(ROOT, "tests/output/renderer-fixtures");
test.beforeAll(() => {
  if (!existsSync(join(FIX, "fixtures.json")))
    execFileSync("node", [join(ROOT, "tests/browser/renderer/make-fixtures.ts"), FIX], {
      stdio: "pipe",
    });
});

type Workers = { render: { created: number; terminated: number } };
const countWorkers = (context: BrowserContext) =>
  context.addInitScript(() => {
    const W = window.Worker;
    const tally = { render: { created: 0, terminated: 0 }, compute: { created: 0, terminated: 0 } };
    (window as unknown as { __workers: typeof tally }).__workers = tally;
    window.Worker = class extends W {
      #kind: "render" | "compute";
      constructor(url: string | URL, o?: WorkerOptions) {
        super(url, o);
        this.#kind = String(url).includes("render.worker") ? "render" : "compute";
        tally[this.#kind].created++;
      }
      override terminate() {
        tally[this.#kind].terminated++;
        super.terminate();
      }
    };
  });

type Diag = {
  held: number;
  state: { kind: string };
  renderRevision: number;
  lastExact: { renderRevision: number } | null;
  client: {
    workersCreated: number;
    crashes: number;
    recoveries: number;
    staleFrames: number;
    buildMismatches: number;
    lastRecoveryMs: number | null;
    fallbackReason: string | null;
  };
};
type Api = {
  canvas: { diag(): Diag | null; crash(): boolean; remount(): void; documentChunks(): number };
  workspace: { loadContainer(b64: string): Promise<number>; dispatch(c: unknown): void };
};
const diag = (page: Page) =>
  page.evaluate(() => (window as unknown as { __vectra: Api }).__vectra.canvas.diag());
const chunks = (page: Page) =>
  page.evaluate(() => (window as unknown as { __vectra: Api }).__vectra.canvas.documentChunks());
const workers = (page: Page) =>
  page.evaluate(() => (window as unknown as { __workers: Workers }).__workers.render);
const liveRender = async (page: Page) => {
  const w = await workers(page);
  return w.created - w.terminated;
};
const canvases = (page: Page) => page.locator('[data-testid="vector-canvas"]').count();
const settled = (page: Page) =>
  expect
    .poll(
      async () => {
        const d = await diag(page);
        return (
          d !== null && d.state.kind === "ready" && d.lastExact?.renderRevision === d.renderRevision
        );
      },
      { timeout: 60_000 },
    )
    .toBe(true);
async function load(page: Page, fixture: string) {
  const b64 = readFileSync(join(FIX, `${fixture}.vectra.b64`), "utf8");
  await page.evaluate(
    (b) => (window as unknown as { __vectra: Api }).__vectra.workspace.loadContainer(b),
    b64,
  );
  await settled(page);
}

/** One live render worker and one canvas; the worker holds exactly the drawn chunks. */
async function steady(page: Page) {
  await settled(page);
  await expect.poll(() => liveRender(page)).toBe(1);
  await expect.poll(() => canvases(page)).toBe(1);
  await expect.poll(async () => (await diag(page))!.held).toBe(await chunks(page));
}

async function lifecycle(page: Page) {
  await load(page, "synthetic-correctness");
  await steady(page);
  // Repeated mount/unmount: each canvas disposes its host (worker terminated, canvas removed).
  // Each remount is waited for (React may merge state updates that arrive before a commit).
  for (let i = 0; i < 12; i++) {
    const n = (await workers(page)).created;
    await page.evaluate(() => (window as unknown as { __vectra: Api }).__vectra.canvas.remount());
    await expect.poll(() => workers(page).then((w) => w.created)).toBeGreaterThan(n);
  }
  await steady(page);
  // A document switch releases the old copies: the worker holds only the new document's.
  await load(page, "multi-layer");
  await steady(page);
  // Crash recovery: a new worker (new generation) on a new canvas; the old one is removed.
  const before = (await diag(page))!.client;
  expect(
    await page.evaluate(() => (window as unknown as { __vectra: Api }).__vectra.canvas.crash()),
  ).toBe(true);
  await expect
    .poll(async () => (await diag(page))!.client.recoveries, { timeout: 30_000 })
    .toBeGreaterThan(before.recoveries);
  await steady(page);
  const after = (await diag(page))!.client;
  expect(after.buildMismatches).toBe(0);
  expect(after.fallbackReason).toBeNull();
  // Rapid edits: frames of superseded revisions are dropped, the last exact frame is current.
  for (let i = 0; i < 20; i++)
    await page.evaluate(
      (k) =>
        (window as unknown as { __vectra: Api }).__vectra.workspace.dispatch({
          type: "setArtboard",
          width: 300 + k,
          height: 200,
        }),
      i,
    );
  await steady(page);
  return (await diag(page))!;
}

test("renderer lifecycle in the production workspace: remounts, switch, crash, rapid edits", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await countWorkers(context);
  const page = await context.newPage();
  await page.goto("/workspace.html?debug=1");
  await expect.poll(() => page.evaluate(() => "__vectra" in window)).toBe(true);
  const d = await lifecycle(page);
  test.info().annotations.push({ type: "client", description: JSON.stringify(d.client) });
  await context.close();
});

// Maintainer review of G-UI-R: the status bar says nothing while the renderer is healthy, and
// shows a recovery and the main-thread fallback in its live region (`canvas-state`).
test("renderer disclosure: a recovery and the crash fallback are shown; healthy is silent", async ({
  page,
}) => {
  await page.goto("/workspace.html?debug=1");
  await expect.poll(() => page.evaluate(() => "__vectra" in window)).toBe(true);
  await load(page, "adjacent_colors-limited");
  const state = page.getByTestId("canvas-state");
  await expect(state).toHaveAttribute("data-host", "worker");
  await expect(state).toHaveAttribute("role", "status");
  await expect(state).toHaveText("");
  // Every text the live region shows is recorded: a recovery can be brief.
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="canvas-state"]')!;
    const seen: string[] = [];
    (window as unknown as { __seen: string[] }).__seen = seen;
    new MutationObserver(() => seen.push(el.textContent ?? "")).observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  const crash = async () => {
    const before = (await diag(page))!.client.crashes;
    expect(
      await page.evaluate(() => (window as unknown as { __vectra: Api }).__vectra.canvas.crash()),
    ).toBe(true);
    await expect.poll(async () => (await diag(page))!.client.crashes).toBeGreaterThan(before);
  };
  // One crash: a recovery, then a healthy worker again and silence.
  await crash();
  await settled(page);
  await expect(state).toHaveAttribute("data-host", "worker");
  await expect(state).toHaveText("");
  const seen = () => page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
  expect((await seen()).some((t) => t.startsWith("Renderer: recovering ("))).toBe(true);
  // More than three crashes in 30 s: the client falls back to the main thread, disclosed with
  // its reason, and it stays disclosed while that renderer draws. Each replacement worker is
  // crashed only once it presents (a crash request before its start-up is ignored).
  for (let i = 0; i < 2; i++) {
    await crash();
    await settled(page);
  }
  await crash();
  await expect(state).toHaveAttribute("role", "status");
  await expect(state).toBeVisible();
  await expect(state).toHaveText(
    /^Renderer: main thread \(fallback: the render worker crashed repeatedly \(.+\)\)$/,
  );
  // The fallback renderer's exact frame settles the host: ready, on the main thread.
  await expect(state).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(state).toHaveAttribute("data-host", "main");
  test
    .info()
    .annotations.push({ type: "canvas-state texts", description: JSON.stringify(await seen()) });
});

test.describe("React development StrictMode (dev server)", () => {
  // One dev server per browser project (projects may run in parallel worker processes).
  const PORTS: Record<string, number> = { chromium: 4295, firefox: 4296, webkit: 4297 };
  let PORT = 0;
  let dev: ChildProcess | null = null;
  test.beforeAll(async ({ browserName }) => {
    PORT = PORTS[browserName]!;
    // Its own process group, so the whole tree (pnpm → vp dev) is stopped afterwards.
    dev = spawn(
      "pnpm",
      ["exec", "vp", "dev", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
      { cwd: ROOT, stdio: "ignore", detached: true },
    );
    for (let i = 0; i < 200; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${PORT}/workspace.html`)).ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("dev server did not start");
  });
  test.afterAll(() => {
    if (dev?.pid) process.kill(-dev.pid, "SIGTERM");
  });

  test("StrictMode double effects leave one renderer; remounts, switch and crash stay clean", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext();
    await countWorkers(context);
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/workspace.html?debug=1`);
    await expect
      .poll(() => page.evaluate(() => "__vectra" in window), { timeout: 60_000 })
      .toBe(true);
    // StrictMode mounted the canvas twice: the first host was disposed, its worker terminated.
    await expect.poll(() => workers(page).then((w) => w.created), { timeout: 30_000 }).toBe(2);
    await expect.poll(() => liveRender(page)).toBe(1);
    await expect.poll(() => canvases(page)).toBe(1);
    await lifecycle(page);
    await context.close();
  });
});
