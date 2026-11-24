# P0-R-G2: Offline worker recovery

**Gate status: PASS** in Chromium 159, Firefox 159 and Playwright WebKit 27.2: macOS locally, and Ubuntu 24.04 arm64 in the Linux container. **Real Safari: NOT RUN.** Playwright WebKit is not Safari, and Safari automation was not set up on this machine.

## Root cause
- Reproduced with network logging: load online, go offline, cancel a job (terminating the worker), start a new job.
- The browser re-requests the **worker script** for `new Worker(url)`, and that request fails before the `.wasm` is ever fetched:
  - WebKit: "WebKit encountered an internal error".
  - Chromium under `vp preview`: `net::ERR_ABORTED`.
- With production `immutable` cache headers (`wrangler pages dev`), Chromium and Firefox satisfied the request from the HTTP cache. WebKit did not.
- P0 therefore recovered offline in Firefox only (with production headers, Chromium too).

## Options compared
| Option | Strict CSP | Repeated offline cancels | Memory | Verdict |
|---|---|---|---|---|
| Rely on HTTP cache (`immutable`) | ✅ | ❌ WebKit does not use it offline for worker scripts | none | Insufficient |
| Pass a compiled `WebAssembly.Module` to new workers | ✅ | ❌ the worker *script* fetch still fails | small | Insufficient on its own |
| Blob-URL workers from in-memory script | ❌ needs `worker-src blob:` | ✅ | small | Rejected (weakens CSP) |
| Standby pre-spawned worker | ✅ | ❌ only the first cancel; replacements cannot be created offline | +1 WASM instance (≥ 25 MiB; grows with work) | Rejected (not reliable for repeated cancels) |
| **Service worker precaching the build** | ✅ (`worker-src 'self'`) | ✅ | Cache Storage ≈ build size (≈ 0.74 MB) | **Selected** |

## Implementation
- **`scripts/generate-sw.mjs`** (build step) writes `dist/sw.js`:
  - `VERSION` = SHA-256 over every precached file's path and bytes. The precache list holds every deployable file of the build.
  - **Install** precaches with `cache: "reload"`.
  - **Activate** deletes other `vectra-*` caches, then `clients.claim()`.
  - **No `skipWaiting`**: a new deployment waits until pages of the old version close.
  - **Fetch** handles same-origin GET only. Navigations are network-first with the cached shell as fallback; build assets are cache-first with network fallback. Cross-origin requests are never handled.
- **Registration.** Production builds only (`import.meta.env.PROD`). The workbench shows "Offline-ready." once the page is controlled.
- **`scripts/check-dist.mjs`** fails the build if `sw.js` is missing or its precache list differs from the deployable files.
- **`public/_headers`** serves `/sw.js` with `Cache-Control: no-cache`, so updates are discovered. `vp preview` now applies every `_headers` rule per path.
- **Version consistency.**
  - Vite content-hashes every asset, and each cache holds exactly one build.
  - A page, its worker and its `.wasm` always come from the same build. Old pages keep their old cache until closed.
  - If an asset is missing from the cache while offline (e.g. evicted), worker start-up fails with the existing `worker_crashed` error. That error is recoverable by reconnecting and reloading.
- **Unchanged.** CSP, cancellation semantics (terminate and recreate), stale-job rejection, crash recovery, memory recycling.
- **Engineering hooks for tests**, workbench only and touching no artwork:
  - `?debug=1` exposes `crashWorker()`, which makes the idle worker throw.
  - `?recycleMiB=N` lowers the recycling threshold.

## Acceptance tests (`tests/browser/offline-recovery.spec.ts`, `sw-update.spec.ts`, `privacy.spec.ts`)
| Requirement | Chromium | Firefox | WebKit (Playwright) | Linux arm64 (all three) |
|---|---|---|---|---|
| Load online → offline → start trace → cancel → new trace completes | ✅ | ✅ | ✅ | ✅ |
| SVG and PDF export offline (vector-only checks) | ✅ | ✅ | ✅ | ✅ |
| Three cancel/recover cycles; terminations ≥ 3, workers ≥ 4 | ✅ | ✅ | ✅ | ✅ |
| Stale results cannot overwrite: 20 rapid changes after recovery, final setting displayed | ✅ | ✅ | ✅ | ✅ |
| No artwork or settings transmitted: all offline requests answered by the service worker, GET only, no bodies, no filename or settings in URLs | ✅ | ✅ | ✅ | ✅ |
| Injected crash (idle) recovers on the next job, three times | ✅ | ✅ | ✅ | ✅ |
| Worker recycling after every job (`recycleMiB=1`), five jobs offline | ✅ | ✅ | ✅ | ✅ |
| New deployment: open page keeps version 1; next visit activates version 2; version-1 cache deleted; v2 works offline | ✅ | ✅ | ✅ | not run in container |
| CSP negative control (service workers blocked so rewritten headers apply) | ✅ | ✅ | ✅ | ✅ |

Cancel-to-result while offline (3000×3000 source, B&W re-trace on a fresh worker) is recorded per cycle in `tests/output/offline-recovery/*-cycles.json`.

**Limitation.** A crash injected *during* a job is delivered only after the synchronous WASM call returns, so mid-job crash recovery is covered by the client unit tests (fake worker) rather than in browsers.

## Remaining risks
- Service-worker behaviour on real Safari and iOS is untested.
- Cache Storage can be evicted under storage pressure. The app then needs network to recreate a worker, and reports a clear error.
- The service worker introduces a lifecycle that P1 must respect: update prompts, and no caching of third-party content (IMAGE-SOURCES).
