// Shared harness for service-worker lifecycle specs (G-JOB, G-R1 workspace): a static origin
// with the production headers, a genuinely different second build, a template-only variant,
// and cache probes. Moved unchanged from sw-update-lifecycle.spec.ts.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { expect, type Page } from "@playwright/test";

export const ROOT = resolve(import.meta.dirname, "../..");
export const DIST = join(ROOT, "dist");
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".txt": "text/plain",
};
const CSP = readFileSync(join(ROOT, "public/_headers"), "utf8").match(
  /Content-Security-Policy: (.*)/,
)![1]!;
/** The files scripts/generate-sw.mjs precaches: every file of the build except these. */
export const precachedFiles = () =>
  readdirSync(DIST, { recursive: true, withFileTypes: true }).filter(
    (e) =>
      e.isFile() &&
      !(e.parentPath === DIST && ["_headers", "_redirects", "sw.js"].includes(e.name)),
  ).length;

/** Appends a custom section to a WASM module: same behaviour, different bytes and hash. */
function wasmVariant(bytes: Buffer): Buffer {
  const name = Buffer.from("vectra-update-test");
  const payload = Buffer.from("build 2");
  const body = Buffer.concat([Buffer.from([name.length]), name, payload]);
  return Buffer.concat([bytes, Buffer.from([0, body.length]), body]);
}

export interface Site {
  origin: string;
  root: string;
  server: Server;
  failing: Set<string>;
  /** Requests to these paths wait until `release()` (e.g. hold the service-worker script). */
  holding: Set<string>;
  release(): void;
  /** Every request fails at the socket (an unreachable server, for any engine). */
  down: boolean;
  hits: Map<string, number>;
  deploy(dir: string): void;
}

/** A static origin with the production headers (plus "Vary: Origin", as `vp preview` sends). */
export async function serve(dir: string): Promise<Site> {
  const root = mkdtempSync(join(tmpdir(), "vectra-site-"));
  cpSync(dir, root, { recursive: true });
  const failing = new Set<string>();
  const holding = new Set<string>();
  const held: (() => void)[] = [];
  const hits = new Map<string, number>();
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    hits.set(path, (hits.get(path) ?? 0) + 1);
    if (site.down || failing.has(path)) return void req.socket.destroy(); // a network failure
    if (holding.has(path)) return void held.push(() => respond(path, res));
    respond(path, res);
  });
  const respond = (path: string, res: import("node:http").ServerResponse) => {
    const file = join(root, path === "/" ? "index.html" : path);
    try {
      const body = readFileSync(file);
      res.writeHead(200, {
        "content-type": TYPES[extname(file)] ?? "application/octet-stream",
        "content-security-policy": CSP,
        "cache-control": "no-cache",
        vary: "Origin",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  };
  const port = await new Promise<number>((ok) =>
    server.listen(0, "127.0.0.1", () => ok((server.address() as { port: number }).port)),
  );
  const site: Site = {
    origin: `http://127.0.0.1:${port}`,
    root,
    server,
    failing,
    holding,
    release() {
      holding.clear();
      for (const f of held.splice(0)) f();
    },
    down: false,
    hits,
    deploy(next: string) {
      for (const f of readdirSync(root)) rmSync(join(root, f), { recursive: true, force: true });
      cpSync(next, root, { recursive: true });
    },
  };
  return site;
}

export const swVersion = (page: Page) =>
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
export const cacheKeys = (page: Page) =>
  page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("vectra-")).sort());
/** A genuinely different production build: salted build ID, a WASM variant under a new name. */
export function makeBuild2(): string {
  const build2 = mkdtempSync(join(tmpdir(), "vectra-build2-"));
  execFileSync("pnpm", ["exec", "vp", "build", "--outDir", build2, "--emptyOutDir"], {
    cwd: ROOT,
    env: { ...process.env, VECTRA_BUILD_SALT: "update-test" },
    stdio: "pipe",
  });
  const assets = join(build2, "assets");
  const wasm = readdirSync(assets).find((f) => f.endsWith(".wasm"))!;
  const renamed = wasm.replace(/-[\w-]+\.wasm$/, "-u2dEPLoY.wasm");
  writeFileSync(join(assets, renamed), wasmVariant(readFileSync(join(assets, wasm))));
  rmSync(join(assets, wasm));
  for (const f of readdirSync(assets).filter((x) => x.endsWith(".js"))) {
    const p = join(assets, f);
    writeFileSync(p, readFileSync(p, "utf8").replaceAll(wasm, renamed));
  }
  execFileSync("node", [join(ROOT, "scripts/generate-sw.mjs"), build2], { stdio: "pipe" });
  // The two builds share no hashed file name.
  const a = new Set(readdirSync(join(DIST, "assets")));
  expect(readdirSync(assets).filter((f) => a.has(f) && !f.endsWith(".css"))).toEqual([]);
  return build2;
}

export const checkForUpdate = (page: Page) =>
  page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg!.update().catch(() => {});
  });

/** Build A's files with a service worker from a generator whose template differs (comment only). */
export function templateOnlyVariant(): string {
  const dir = mkdtempSync(join(tmpdir(), "vectra-swvariant-"));
  cpSync(DIST, dir, { recursive: true });
  const gen = readFileSync(join(ROOT, "scripts/generate-sw.mjs"), "utf8");
  const marker = "for this build. Do not edit.";
  expect(gen).toContain(marker);
  const variant = join(dir, "..", `generate-sw-variant-${Date.now()}.mjs`);
  writeFileSync(variant, gen.replace(marker, `${marker} (template variant B)`));
  execFileSync("node", [variant, dir], { stdio: "pipe" });
  rmSync(variant);
  return dir;
}
export const versionOf = (dir: string) =>
  /const VERSION = "([0-9a-f]{16})"/.exec(readFileSync(join(dir, "sw.js"), "utf8"))![1]!;
export const cacheEntries = (page: Page) =>
  page.evaluate(async () => {
    const out: Record<string, number> = {};
    for (const k of (await caches.keys()).filter((x) => x.startsWith("vectra-")))
      out[k] = (await (await caches.open(k)).keys()).length;
    return out;
  });
export const evictShell = (page: Page, shell = "index.html") =>
  page.evaluate(async (f) => {
    const key = (await caches.keys()).find((k) => k.startsWith("vectra-"))!;
    return (await caches.open(key)).delete(new URL(`./${f}`, location.href).href);
  }, shell);
export const recoveryReason = (page: Page) =>
  page.evaluate(() =>
    document.body?.dataset.testid === "sw-recovery" ? document.body.dataset.reason : null,
  );
