#!/usr/bin/env node
// Writes dist/sw.js: a versioned service worker that precaches every file of this build so a
// cancelled (terminated) Web Worker can be recreated while offline. Browsers fetch the
// `new Worker(url)` script and the .wasm over the network unless a service worker answers;
// WebKit does not fall back to the HTTP cache offline (P0-R-G2).
//
// Single-build sessions (RFC-002 §15.3, TD-PLATFORM-006): a page runs assets from exactly one
// build. VERSION is a hash of every precached file, and asset names are content-hashed.
// - Navigations to an app shell (a precached .html file) are served from the controlling
//   version's cache. If that shell is missing (e.g. evicted by the browser), it is repaired only
//   from an identical build on the network (every asset the network shell references is in this
//   version's precache list); otherwise the worker serves a static recovery page and never a
//   shell of another build. Open tabs are never reloaded.
// - A new deployment installs a new cache and waits (no skipWaiting) until every page of the
//   old version has closed; pages are told an update is waiting, never forced to reload.
// - An interrupted install deletes its partial cache (never one that already existed); the old
//   version stays intact. VERSION also hashes this template, so a generator-only change
//   installs into a new cache.
// - Activation deletes older vectra-* caches (no page of theirs is still controlled), and
//   claims pages only on a first install. The worker reports its BUILD_ID, so a page claimed by
//   a worker of another build (a deploy between page load and registration) knows that it has
//   no offline copy and says so; the worker handshake (C5) independently refuses mixing.
// - Cache lookups ignore Vary (same-origin, content-hashed assets): with "Vary: Origin", the
//   P0 worker never matched module scripts and stylesheets, so an offline reload was blank.
// - Non-shell precached files are content-hashed, except THIRD-PARTY-NOTICES.txt and the brand
//   icons and web manifest (public/, fixed names: text, images and JSON, never executed): a
//   network fallback returns the same bytes, another build's icon, or fails.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const dist = resolve(process.argv[2] ?? resolve(import.meta.dirname, "../dist"));
const EXCLUDE = new Set(["_headers", "_redirects", "sw.js"]);
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else {
      const rel = relative(dist, p).split("\\").join("/");
      if (!EXCLUDE.has(rel)) files.push(rel);
    }
  }
};
walk(dist);

// The build identity compiled into the bundle (vite.config.ts `define`), so pages can check
// that their controlling worker belongs to their own build.
let buildId = null;
for (const f of files.filter((x) => x.endsWith(".js"))) {
  const m = /buildId:\s*[`"']([0-9a-f]{16})[`"']/.exec(readFileSync(join(dist, f), "utf8"));
  if (m) {
    if (buildId && buildId !== m[1])
      throw new Error(`two build IDs in ${dist}: ${buildId}, ${m[1]}`);
    buildId = m[1];
  }
}
if (!buildId) throw new Error(`no build ID found in ${dist}/assets`);
// The production CSP, for the recovery page the worker synthesises.
const csp = /Content-Security-Policy:\s*(.+)/
  .exec(readFileSync(join(dist, "_headers"), "utf8"))?.[1]
  ?.trim();
if (!csp) throw new Error(`no Content-Security-Policy in ${dist}/_headers`);
// The Vectra symbol for the recovery page: branding/vectra-symbol.svg inline and verbatim (no
// request, no style), decorative beside the heading. Inline, not read from branding/, because
// this generator must stay self-contained (the update tests run a copy of it elsewhere);
// src/shell/brand-mark.test.ts fails if it drifts from the master.
const symbol = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 13 453 343" width="64" height="48" aria-hidden="true">
  <g id="pixels">
    <rect x="16" y="195" width="30" height="30" fill="#191a1c"/>
    <rect x="63" y="223" width="44" height="44" fill="#b9e87b"/>
    <rect x="107" y="146" width="67" height="67" fill="#191a1c"/>
  </g>
  <g id="vector-ribbon">
    <path fill="#191a1c" d="M420 46 C183 84 255 222 135 323 C358 283 272 128 420 46 Z"/>
    <path fill="#b9e87b" d="M420 46 C183 84 255 222 135 323 C314 264 216 100 420 46 Z"/>
  </g>
  <g id="control-handles" fill="#b9e87b" stroke="#b9e87b" stroke-width="5">
    <path d="M256 46 H420 M135 323 H341" fill="none"/>
    <circle cx="256" cy="46" r="11"/>
    <circle cx="341" cy="323" r="11"/>
  </g>
  <g id="anchor-points" fill="#b9e87b" stroke="#191a1c" stroke-width="5">
    <rect x="405.5" y="31.5" width="29" height="29"/>
    <rect x="120.5" y="308.5" width="29" height="29"/>
  </g>
</svg>`;

const precache = files.map((f) => `./${f}`);
const VERSION_SLOT = "@@VECTRA_SW_VERSION@@";
const template = `// Generated by scripts/generate-sw.mjs for this build. Do not edit.
const VERSION = "${VERSION_SLOT}";
const BUILD_ID = ${JSON.stringify(buildId)};
const CACHE = "vectra-" + VERSION;
const PRECACHE = ${JSON.stringify(precache, null, 2)};
const CSP = ${JSON.stringify(csp)};
const SCOPE = self.registration.scope;
const SHELLS = PRECACHE.filter((p) => p.endsWith(".html")).map((p) => new URL(p, SCOPE).href);
const ASSET_REF = /["'(](?:\\.\\/|\\/)?(assets\\/[^"')?#]+)/g;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const existed = await caches.has(CACHE); // never delete a cache a live page may use
      const cache = await caches.open(CACHE);
      try {
        await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" })));
      } catch (e) {
        if (!existed) await caches.delete(CACHE); // never leave a partial cache behind
        throw e;
      }
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const others = (await caches.keys()).filter((k) => k.startsWith("vectra-") && k !== CACHE);
      // A previous version existed if any other cache holds files (an install killed before
      // addAll finished leaves only an empty cache, which does not count).
      let updating = false;
      for (const key of others) {
        if ((await (await caches.open(key)).keys()).length > 0) updating = true;
        await caches.delete(key);
      }
      if (!updating) await self.clients.claim(); // first install only
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "vectra-sw-version")
    event.source?.postMessage({ type: "vectra-sw-version", version: VERSION, buildId: BUILD_ID });
});

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** A static page (no script, no inline style) explaining why this tab cannot load safely. */
function recovery(reason) {
  const cause =
    reason === "offline"
      ? "Part of the offline copy of Vectra that this tab uses is missing, and the server cannot be reached."
      : "Part of the offline copy of Vectra that this tab uses is missing, and the server now has a different version. Loading it here could mix two versions, so this tab was not loaded.";
  const html = \`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vectra — offline copy incomplete</title></head>
<body data-testid="sw-recovery" data-reason="\${reason}" data-version="\${escapeHtml(VERSION)}">
<main>
${symbol}
<h1>This tab's offline copy of Vectra is incomplete</h1>
<p>\${escapeHtml(cause)} The browser may have removed it to free storage.</p>
<ul>
<li>Other open Vectra tabs keep working. Save your work there first.</li>
<li>\${reason === "offline" ? "Reconnect to the internet, then reload this page." : "To use the latest version now, without offline support in this tab, hold Shift and reload this page."}</li>
<li>Or close every Vectra tab and open Vectra again: the latest version then installs with offline support.</li>
</ul>
<p>Offline copy: version \${escapeHtml(VERSION)}.</p>
</main></body></html>\`;
  return new Response(html, {
    status: 503,
    headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": CSP, "cache-control": "no-store" },
  });
}

/** The controlling version's shell, repaired only from an identical build, or the recovery page. */
async function serveShell(shellUrl) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(shellUrl, { ignoreSearch: true, ignoreVary: true });
  if (hit) return hit;
  let net;
  try {
    net = await fetch(shellUrl, { cache: "no-store" });
  } catch {
    return recovery("offline");
  }
  if (!net.ok) return recovery("version");
  const html = await net.clone().text();
  const refs = [...html.matchAll(ASSET_REF)].map((m) => "./" + m[1]);
  if (refs.length === 0 || !refs.every((r) => PRECACHE.includes(r))) return recovery("version");
  await cache.put(shellUrl, net.clone()); // the same build: repair the cache
  return net;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    const path = url.href.split(/[?#]/)[0];
    const shell = path === SCOPE ? new URL("./index.html", SCOPE).href : SHELLS.includes(path) ? path : null;
    if (shell) {
      event.respondWith(serveShell(shell));
      return;
    }
    // Other precached files opened as pages (e.g. the notices): cache, then network.
    event.respondWith(
      caches.match(request, { cacheName: CACHE, ignoreSearch: true, ignoreVary: true }).then((hit) => hit || fetch(request)),
    );
    return;
  }
  // Hashed build assets: cache first, network as fallback (e.g. a file evicted from the cache).
  // ignoreVary: module scripts and stylesheets are CORS requests carrying Origin, and a
  // "Vary: Origin" response cached by addAll() would otherwise never match them offline.
  event.respondWith(
    caches.match(request, { cacheName: CACHE, ignoreVary: true }).then((hit) => hit || fetch(request)),
  );
});
`;
// VERSION covers every precached file **and this template**: a deploy that changes only the
// service worker gets a new cache instead of reinstalling into the live one.
const hash = createHash("sha256").update(template).update("\0");
for (const f of files)
  hash
    .update(f)
    .update("\0")
    .update(readFileSync(join(dist, f)));
const version = hash.digest("hex").slice(0, 16);
const sw = template.replace(VERSION_SLOT, version);
writeFileSync(join(dist, "sw.js"), sw);
console.log(`dist/sw.js: version ${version}, build ${buildId}, ${precache.length} precached files`);
