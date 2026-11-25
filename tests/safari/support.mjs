// Shared support for the real-Safari harness: a static origin with the production headers, and
// the second builds used by the update scenarios (same construction as
// tests/browser/sw-update-lifecycle.spec.ts).
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "../..");
export const DIST = join(ROOT, "dist");
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".txt": "text/plain",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};
const CSP = /Content-Security-Policy: (.*)/.exec(
  readFileSync(join(ROOT, "public/_headers"), "utf8"),
)[1];

/**
 * Serves a copy of `dir` with the production CSP, "Vary: Origin" (as `vp preview` sends) and
 * no-cache. `down` makes every request fail at the socket (an unreachable origin: WebDriver has
 * no network emulation); `failing` fails single paths; `holding` delays paths until release();
 * `rewrite(path, body)` may alter a response.
 */
export async function serve(dir) {
  const root = mkdtempSync(join(tmpdir(), "vectra-safari-site-"));
  cpSync(dir, root, { recursive: true });
  const held = [];
  const site = {
    root,
    down: false,
    failing: new Set(),
    holding: new Set(),
    hits: new Map(),
    rewrite: null,
    release() {
      site.holding.clear();
      for (const f of held.splice(0)) f();
    },
    deploy(next) {
      for (const f of readdirSync(root)) rmSync(join(root, f), { recursive: true, force: true });
      cpSync(next, root, { recursive: true });
    },
    close() {
      site.server.closeAllConnections?.();
      site.server.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
  const respond = (path, res) => {
    const file = join(root, path === "/" ? "index.html" : path);
    try {
      let body = readFileSync(file);
      if (site.rewrite) body = site.rewrite(path, body);
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
  site.server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
    site.hits.set(path, (site.hits.get(path) ?? 0) + 1);
    if (site.down || site.failing.has(path)) return void req.socket.destroy();
    if (site.holding.has(path)) return void held.push(() => respond(path, res));
    respond(path, res);
  });
  const port = await new Promise((ok) =>
    site.server.listen(0, "127.0.0.1", () => ok(site.server.address().port)),
  );
  site.origin = `http://127.0.0.1:${port}`;
  return site;
}

/** A genuinely different production build: salted build ID, renamed WASM variant. */
export function makeBuild2() {
  const out = mkdtempSync(join(tmpdir(), "vectra-safari-build2-"));
  execFileSync("pnpm", ["exec", "vp", "build", "--outDir", out, "--emptyOutDir"], {
    cwd: ROOT,
    env: { ...process.env, VECTRA_BUILD_SALT: "update-test" },
    stdio: "pipe",
  });
  const assets = join(out, "assets");
  const wasm = readdirSync(assets).find((f) => f.endsWith(".wasm"));
  const renamed = wasm.replace(/-[\w-]+\.wasm$/, "-u2dEPLoY.wasm");
  const name = Buffer.from("vectra-update-test");
  const body = Buffer.concat([Buffer.from([name.length]), name, Buffer.from("build 2")]);
  writeFileSync(
    join(assets, renamed),
    Buffer.concat([readFileSync(join(assets, wasm)), Buffer.from([0, body.length]), body]),
  );
  rmSync(join(assets, wasm));
  for (const f of readdirSync(assets).filter((x) => x.endsWith(".js"))) {
    const p = join(assets, f);
    writeFileSync(p, readFileSync(p, "utf8").replaceAll(wasm, renamed));
  }
  execFileSync("node", [join(ROOT, "scripts/generate-sw.mjs"), out], { stdio: "pipe" });
  return out;
}

/** Build A's files with a service worker from a generator whose template differs (comment). */
export function templateOnlyVariant() {
  const dir = mkdtempSync(join(tmpdir(), "vectra-safari-swvariant-"));
  cpSync(DIST, dir, { recursive: true });
  const gen = readFileSync(join(ROOT, "scripts/generate-sw.mjs"), "utf8");
  const marker = "for this build. Do not edit.";
  const variant = join(dir, "..", `generate-sw-variant-${Date.now()}.mjs`);
  writeFileSync(variant, gen.replace(marker, `${marker} (template variant B)`));
  execFileSync("node", [variant, dir], { stdio: "pipe" });
  rmSync(variant);
  return dir;
}

export const versionOf = (dir) =>
  /const VERSION = "([0-9a-f]{16})"/.exec(readFileSync(join(dir, "sw.js"), "utf8"))[1];
