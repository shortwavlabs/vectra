# P0-G5: Privacy, performance and reliability

**Gate status: PARTIAL.**
- Privacy: PASS in Chromium, Firefox and WebKit.
- Offline workflow: PASS in all three.
- Performance: measured and within the proposed desktop thresholds.

PARTIAL because:
1. Recovering from a cancellation while offline fails in WebKit.
2. Only one desktop machine was measured. Real Safari, iOS, Android and low-memory devices: **NOT RUN**.
3. High-resolution benchmarks used an upscaled photograph (optimistic).

## Objective
Show that processing stays in the browser (no artwork, filename, settings or exports leave the device), that the workflow runs offline once loaded, and measure performance, memory, responsiveness and cancellation on representative sizes.

## Privacy verification (`tests/browser/privacy.spec.ts`)
**Method.**
- Playwright `BrowserContext.on("request")` captures every request from the page **and its workers**. `page.on("websocket")` captures WebSockets.
- The session uploads a file named with a unique token (`PRIVATE-artwork-7f3c9e.png`).
- It traces in all four modes, changes a setting, and downloads both SVG and PDF.
- It runs against the production build under `vp preview`, and separately under `wrangler pages dev`.

**Assertions.** Every request must be:
- a `GET`;
- same-origin, or `blob:`/`data:`;
- without a body;
- free of the token, the fixture name or setting names in its URL.

In addition, **zero** network requests are allowed during the session after start-up.

| | Chromium | Firefox | WebKit |
|---|---|---|---|
| Requests at load | 5 (document, JS, CSS, worker, `.wasm`) | 5 | 5 (the worker is reported as `xhr`) |
| Network requests during import, 4 traces, setting change and SVG/PDF export | **0** (2 `blob:` previews, which are local) | **0** | **0** (2 `blob:`) |
| Request bodies / token in URL / WebSockets | none / none / none | none | none |
| Same result under `wrangler pages dev` | ✅ | ✅ | ✅ |

Logs: `artifacts/privacy/*-requests.json`.

Also verified by construction:
- No analytics, fonts, CDNs or remote URLs in `dist`; `scripts/check-dist.mjs` fails the build otherwise.
- CSP `connect-src 'self'` and `form-action 'none'`.
- The debug snapshot `window.__vectra` holds metrics only.
- Hosting access logs, which record IPs and asset requests at the CDN, are separate from artwork privacy and should be explained in user-facing docs (P1).

## Offline verification
After the app has loaded (worker and WASM warmed up at start-up):
- `context.setOffline(true)`.
- Then the full session: import, four modes, setting change, SVG and PDF download.

| | Chromium | Firefox | WebKit |
|---|---|---|---|
| Full offline session | ✅ | ✅ | ✅ |
| Cancel a running job offline, then trace again (the worker is recreated) under `vp preview` (no asset cache headers) | ❌ | ✅ | ❌ |
| Same, under `wrangler pages dev` with `/assets/*` set to `immutable` | ✅ | ✅ | ❌ |

**Defect:** in WebKit, a worker recreated while offline cannot load. Fix options for P1:
- A service-worker precache (also enables a PWA).
- Or keep a pre-spawned standby worker, and/or pass a compiled `WebAssembly.Module` to new workers.

## Performance (summary; full tables in BENCHMARKS.md)
| Measure | Result |
|---|---|
| WASM init in a fresh worker | 2.6 ms (Chromium) / 5.0 ms (Firefox) / 8.0 ms (WebKit) |
| Decode (main thread, JPEG q0.9) | 1 MP 4–11 ms; 24 MP 53–88 ms |
| Trace + SVG, 1 MP colour (median) | 558 / 518 / 412 ms |
| Trace + SVG, 4 MP colour (median) | 1.50 / 1.23 / 1.18 s |
| Trace + SVG, 24 MP colour / limited | 3.3 / 2.8 / 2.4 s; 5.9 / 5.9 / 5.0 s |
| SVG export | ≤ 350 ms (24 MP limited, 22 MB SVG) |
| PDF export | ≤ 1.23 s (24 MP limited, 7.9 MB PDF) |
| Path / anchor count | up to 11.9k paths and 555k anchors (24 MP limited colour) |
| WASM memory | 25 MiB (1 MP bw) to 913 MiB (24 MP limited colour, Chromium); does not shrink. Recycled above 1 GiB. |
| Memory over 20 imports (640 px, colour) | Flat at 52.6 MB WASM in all three engines; Chromium JS heap flat |
| Main thread during processing | Max rAF gap one frame (16.7–19 ms), except one 52 ms WebKit sample. Long tasks: 0 (Chromium; other engines don't expose the API). |
| Cancellation | Acknowledged in ≤ 0.3 ms in code; visible in ≤ 53 ms; next job on a fresh worker |

**Practical memory constraints.**
- Desktop browsers handled 24 MP up to about 0.9 GiB of WASM memory.
- Mobile Safari historically caps per-tab memory far lower. Mobile limits must come from device tests, which were **not run**.
- Recommended proposal: keep 12 MP as the desktop default, and start mobile at ≤ 4 MP pending evidence.

## Reliability
Covered in G2: malformed, unsupported, oversized and truncated inputs; rapid setting changes; repeated imports; worker crash and fatal-abort recovery; stale results.

Determinism:
- Engine output is byte-identical for identical RGBA.
- Cross-browser identity fails for JPEG and semi-transparent pixels because browser decoders differ (G1).

## Browsers
- Chromium 159.0.8154.6 (headless shell), Firefox 159.0 and WebKit 27.2: Playwright 1.65.1 builds on macOS arm64. **PASS** as tested.
- **Playwright WebKit is not Safari.** Safari (macOS), iOS Safari, Chrome Android and Firefox Android: **NOT RUN**.

## Exact versions and environment
Playwright 1.65.1 (Chromium 159.0.8154.6 headless shell, Firefox 159.0, WebKit 27.2), wrangler 4.166.0. Machine and toolchain as in P0-G0.

## Commands executed
`pnpm exec playwright test tests/browser/privacy.spec.ts` (under `vp preview`); `PW_BASE_URL=http://127.0.0.1:8791 pnpm exec playwright test tests/browser/{smoke,csp,privacy}.spec.ts` (under `wrangler pages dev`); `BENCH=1 pnpm exec playwright test tests/browser/benchmark.spec.ts`.

## Relevant artifacts
`artifacts/privacy/*`, `artifacts/bench/*.jsonl`, `artifacts/playwright-final-run.txt`.

## Unresolved questions
- What are the target devices for mobile, and which memory caps? This needs real devices.
- Is offline-after-load a product requirement (then a service worker is in scope for P1), or best-effort?

## Reproduction
```text
pnpm run build
pnpm exec playwright test tests/browser/privacy.spec.ts
BENCH=1 pnpm exec playwright test tests/browser/benchmark.spec.ts   # ~3 min for all three engines on this machine
```
