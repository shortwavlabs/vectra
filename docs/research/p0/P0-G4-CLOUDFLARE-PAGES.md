# P0-G4: Cloudflare Pages compatibility

**Gate status: PARTIAL.**
- Static build: PASS.
- Local Pages emulation (`wrangler pages dev`): PASS.
- Security headers and CSP enforcement: PASS in three engines.
- **Real deployment: OWNER TEST PENDING.** No account was used, nothing was deployed, and no credentials were requested.

## Objective
Produce a static `dist/` suitable for Cloudflare Pages: no server runtime, correct WASM and worker loading, no third-party CDN, no deployment-specific paths, security headers, and every asset under Pages limits.

## Research findings (primary sources, checked 2026-11-23)
- **Limits:** 20,000 files per deployment on Free, and **25 MiB per asset**. `_headers` allows up to 100 rules and 2,000 characters per line. ([limits](https://developers.cloudflare.com/pages/platform/limits/), [headers](https://developers.cloudflare.com/pages/configuration/headers/))
- **Build image v3:** Ubuntu 22.04, default Node 22.x, pnpm 10.11.1. Rust, cargo and wasm-bindgen are **not** included, and builds time out at 20 minutes. Node can be pinned via `.node-version`, but pnpm 12 and the Rust toolchain would have to be installed during the build. ([build image](https://developers.cloudflare.com/pages/configuration/build-image/))
- **Direct upload:** `wrangler pages project create <name> --production-branch main`, then `wrangler pages deploy dist --project-name <name>`. It needs `CLOUDFLARE_API_TOKEN` (Pages: Edit) and `CLOUDFLARE_ACCOUNT_ID`. `pages deploy` has no dry-run. ([wrangler pages](https://developers.cloudflare.com/workers/wrangler/commands/pages/), [direct upload CI](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/))
- **Caching:** by default every asset gets `public, max-age=0, must-revalidate` plus an ETag. Long-lived caching for hashed assets has to be added in `_headers`. ([serving pages](https://developers.cloudflare.com/pages/configuration/serving-pages/))
- **Direction:** Cloudflare's blog (2025-04-08) recommends starting new projects on Workers Static Assets, which has the same 25 MiB and 20k-file limits. Pages remains supported. ([blog](https://blog.cloudflare.com/full-stack-development-on-cloudflare-workers/), [migration](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)) Because `dist/` is plain static output, it is portable to either.
- **CSP:** `'wasm-unsafe-eval'` is required to compile WebAssembly under `script-src`. It is supported in Chrome 97, Firefox 102 and Safari 16. A dedicated worker uses the CSP of its own script response. ([MDN script-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src))

## Implementation
- **`public/_headers`:**
  - For `/*`:
    - CSP: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.
    - Also `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, a restrictive `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin` and `X-Frame-Options: DENY`.
  - For `/assets/*`: `Cache-Control: public, max-age=31536000, immutable` (hashed filenames).
  - `vp preview` applies the `/*` rule from the same file (CSP and security headers), but not the `/assets/*` cache rule. That affected offline cache behaviour (G5); `wrangler pages dev` applies both rules.
- **Asset paths:** Vite `base: "./"` gives relative asset URLs and no hard-coded origin or path. The WASM URL is resolved from `import.meta.url` inside the hashed worker chunk.
- **Build guard:** `scripts/check-dist.mjs` runs as part of `pnpm run build`. It fails if:
  - any file is over 25 MiB, or there are more than 20,000 files;
  - `index.html`, `_headers`, a `.wasm` file or a worker bundle is missing;
  - any HTML, JS or CSS references an absolute `http(s)` URL other than the W3C namespace and React's error-decoder URL, which appears only in an error message.
- **No server runtime:** no Functions, `_worker.js`, SSR, D1, R2 or KV.

## Validation
| Check | Result |
|---|---|
| `pnpm run build` → 6 files, 733 KB total. Largest asset: 484 KB `.wasm` (1.9 % of the 25 MiB limit). Dist check passed. | PASS |
| `wrangler pages dev dist --port 8791` (wrangler 4.166.0, local workerd; no login) parsed 2 header rules | PASS |
| `/` → `text/html`, CSP and security headers, `max-age=0, must-revalidate` | PASS (`artifacts/wrangler-pages-dev-headers.txt`) |
| `/assets/*.wasm` → **`application/wasm`**, `immutable` | PASS |
| `/assets/*worker*.js` → `application/javascript`, with the same CSP (which the worker needs for `wasm-unsafe-eval`) | PASS |
| Unknown path → 200 `index.html` (Pages SPA fallback when there is no 404.html) | Observed. See limitation 2. |
| Production build under the production CSP traces in Chromium, Firefox and WebKit (`smoke.spec.ts`, `workbench.spec.ts`) | PASS |
| **Negative control** (`csp.spec.ts`): strip `'wasm-unsafe-eval'` from every response's CSP | Engine blocked in all three engines. Chromium: "Compiling or instantiating WebAssembly module violates the following Content Security policy directive". Firefox: "call to WebAssembly.instantiateStreaming() blocked by CSP". WebKit: blocked, error surfaced as `worker_crashed`. **PASS**: the CSP is enforced, and the directive is necessary. |
| CSP side effect | `connect-src 'self'` blocks `fetch()` of `blob:` URLs. The app doesn't need it; the tests read downloads instead. |
| Real Pages deploy, HTTPS, edge headers, MIME at the edge | **OWNER TEST PENDING** |

## Recommended deployment strategy
Native Pages Git builds are impractical: the v3 image has no Rust or wasm-bindgen, ships pnpm 10, and has a 20-minute limit. Recommended instead:
1. Build locally, or in one pinned CI job, with the documented toolchain: `pnpm install` → `pnpm run build`. This runs the WASM build, `vp build` and the dist check.
2. Run `node scripts/check-dist.mjs`. Optionally run `PW_BASE_URL=http://127.0.0.1:8791 pnpm exec playwright test tests/browser/smoke.spec.ts` against `wrangler pages dev dist`.
3. Maintainer only: `wrangler pages project create vectra --production-branch main` (once), then `wrangler pages deploy dist --project-name vectra --branch <branch>`.
4. After the first deploy, verify `curl -I` on `/`, the `.wasm` file and the worker. Check the `application/wasm` MIME type and all headers.

Before choosing, the maintainer should consider Workers Static Assets, which Cloudflare now recommends for new projects. The same `dist/` works there, with `_headers` support.

## Known limitations
1. No real deployment, so edge behaviour (MIME, headers, compression, HTTP/3) is unverified. **OWNER TEST PENDING.**
2. Because `base: "./"` is relative, deep links (for example `/some/route`) served by the SPA fallback would resolve `./assets/…` under that path. The P0 app has no routes, so it is unaffected. Switch to `base: "/"` if routing is added and the app is always served from the root.
3. No `404.html`, by design, for SPA fallback.
4. Offline use after a cancellation depends on the browser cache (G5). A service worker is not in P0.
5. `wrangler pages dev` printed a compatibility-date warning and was run with `--compatibility-date=2026-11-19`. It only emulates Pages; it does not reproduce edge caching.

## Exact versions, environment and commands
wrangler 4.166.0 (local workerd; no login), Vite+ 1.7.0, Playwright 1.65.1. Environment as in P0-G0. Commands: see Validation and Reproduction. A pre-existing local workerd already occupied port 8788, so port 8791 was used.

## Relevant artifacts
`artifacts/wrangler-pages-dev-headers.txt`, `artifacts/wrangler-pages-dev-playwright.txt` (12/12 passed against `wrangler pages dev`), `public/_headers`, `scripts/check-dist.mjs`.

## Unresolved questions
- Cloudflare Pages or Workers Static Assets?
- Production domain and branch strategy, and who holds the deploy token?
- Should HSTS be added via `_headers` or managed at the zone?

## Reproduction
```text
pnpm run build
wrangler pages dev dist --port 8791 --ip 127.0.0.1 --compatibility-date=2026-11-19
curl -sI http://127.0.0.1:8791/assets/<hash>.wasm
PW_BASE_URL=http://127.0.0.1:8791 pnpm exec playwright test tests/browser/smoke.spec.ts tests/browser/csp.spec.ts
```
