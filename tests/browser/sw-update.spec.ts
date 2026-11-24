// P0-R-G2: service-worker versioning across deployments. Serves a copy of dist/ from a
// throwaway static server, "deploys" a second build into the same origin, and checks that
// the old version keeps serving its own assets until its pages close, that the new version
// then takes over, and that old caches are deleted.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { fixture, waitForState } from "./helpers.ts";

const DIST = resolve(import.meta.dirname, "../../dist");
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
};

function serve(root: string): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    const file = join(root, path === "/" ? "index.html" : path);
    try {
      const body = readFileSync(file);
      res.writeHead(200, {
        "content-type": TYPES[extname(file)] ?? "application/octet-stream",
        "cache-control": "no-cache",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((ok) =>
    server.listen(0, "127.0.0.1", () =>
      ok({ server, origin: `http://127.0.0.1:${(server.address() as { port: number }).port}` }),
    ),
  );
}

const swVersion = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string>((ok) => {
        navigator.serviceWorker.addEventListener(
          "message",
          (e) => e.data?.type === "vectra-sw-version" && ok(e.data.version),
          { once: true },
        );
        navigator.serviceWorker.controller!.postMessage("vectra-sw-version");
      }),
  );
const cacheKeys = (page: Page) =>
  page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("vectra-")).sort());

test("a new deployment does not disturb open pages, then replaces the old cache", async ({
  browser,
}) => {
  const site = mkdtempSync(join(tmpdir(), "vectra-sw-"));
  cpSync(DIST, site, { recursive: true });
  const { server, origin } = await serve(site);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/`);
    await expect(page.getByTestId("offline-ready")).toHaveText("Offline-ready.", {
      timeout: 30_000,
    });
    const v1 = await swVersion(page);
    expect(await cacheKeys(page)).toEqual([`vectra-${v1}`]);

    // Deploy "build 2": a changed index.html and a regenerated service worker.
    writeFileSync(
      join(site, "index.html"),
      readFileSync(join(site, "index.html"), "utf8").replace("</body>", "<!-- build 2 --></body>"),
    );
    execFileSync("node", [resolve(import.meta.dirname, "../../scripts/generate-sw.mjs"), site]);
    await page.reload();
    await expect(page.getByTestId("offline-ready")).toHaveText("Offline-ready.", {
      timeout: 30_000,
    });
    await expect.poll(() => cacheKeys(page), { timeout: 30_000 }).toHaveLength(2); // v2 installed, waiting
    expect(await swVersion(page)).toBe(v1); // old version still controls the open page
    await page.getByTestId("file").setInputFiles(fixture("procedural/circle.png"));
    await waitForState(page, "done");

    // Close every page of the old version; the next visit activates v2 and drops v1's cache.
    await page.close();
    const next = await context.newPage();
    await next.goto(`${origin}/`);
    await expect
      .poll(
        async () =>
          (await next.evaluate(() => navigator.serviceWorker.controller !== null)) &&
          swVersion(next),
        { timeout: 30_000 },
      )
      .not.toBe(v1);
    const v2 = await swVersion(next);
    await expect.poll(() => cacheKeys(next), { timeout: 30_000 }).toEqual([`vectra-${v2}`]);
    // The new version works offline, including worker recreation after a cancel-free re-trace.
    await context.setOffline(true);
    await next.getByTestId("file").setInputFiles(fixture("procedural/nested_rings.png"));
    await waitForState(next, "done");
  } finally {
    await context.close();
    server.close();
    rmSync(site, { recursive: true, force: true });
  }
});
