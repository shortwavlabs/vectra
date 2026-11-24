# P0-G2: Worker execution and resource management

**Gate status: PASS.**

Known defects are tracked: the post-result SVG preview cost is unmeasured, and recovering from a cancellation while offline fails in Chromium and WebKit (see G5).

## Objective
Run vectorisation in a Web Worker under a typed protocol (start, status, result, error, cancel), using transferable buffers. Stale results must never win, failures must be recovered from, and resources must stay bounded.

## Research findings
- Dedicated module workers (`new Worker(url, { type: "module" })`) are supported in Chrome 80+, Firefox 114+ and Safari 15+ ([MDN Worker](https://developer.mozilla.org/en-US/docs/Web/API/Worker/Worker)). Vite bundles a worker from `new URL("./x.worker.ts", import.meta.url)`, with `worker.format = "es"`.
- Transferring an `ArrayBuffer` detaches it on the sender's side ([MDN transferables](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)).
- A synchronous WASM call keeps the worker's event loop blocked, so a "cancel" message is not handled until the call returns. Cooperative cancellation would need `SharedArrayBuffer` and therefore cross-origin isolation. Per RFC-001 this is **not** introduced in P0. VTracer 1.0's `CancelToken` cannot be reached from JS while the call is running.
- WebAssembly linear memory grows but never shrinks. The only way to release it is to drop the instance, which means terminating the worker.

## Implementation
**Protocol** (`src/workers/protocol.ts`):
- Main → worker:
  - `trace`: `{jobId, revision, width, height, rgba: ArrayBuffer (transferred), request}`.
  - `export-pdf`: `{jobId, sceneJson, options}`.
- Worker → main:
  - `ready`: `{engineVersion, initMs, memoryBytes}`.
  - `status`: `{jobId, state: "processing"}`. Progress is explicitly indeterminate.
  - `trace-result`: `{jobId, revision, sceneJson, svg, metrics, warnings, timings, memoryBytes}`.
  - `pdf-result`: `{jobId, pdf: ArrayBuffer (transferred), ms, memoryBytes}`.
  - `error`: `{jobId, code, message, fatal}`.
- Engine errors cross the WASM boundary as JSON `{code, message}` and are non-fatal. Any other exception, such as a Rust panic surfacing as `WebAssembly.RuntimeError: unreachable` because of `panic = "abort"`, is **fatal**: the instance may be corrupt.

**Client** (`src/vectorization/client.ts`):
- One job in flight at a time. A new `trace` cancels the running one ("latest wins"). The UI debounces settings changes by 200 ms.
- Every job gets a monotonically increasing `jobId`.
  - Results are accepted only for the pending `jobId`, and only from the current worker generation.
  - A terminated worker's handlers are detached first.
  - Anything else is dropped and counted in `stats.staleMessagesDropped`.
- `revision` identifies the source image. The UI ignores a result whose revision is not the current image.
- **Cancellation = terminate and recreate.**
  - `cancel()` synchronously rejects the job with `CancelledError` and terminates the worker.
  - The next job lazily spawns a new worker. A job cancelled while its worker is still starting is never posted.
- Crash recovery:
  - `onerror`/`onmessageerror` reject the job with `worker_crashed` and discard the worker.
  - A fatal `error` message discards the worker too.
  - The next job creates a fresh one.
- **Memory bounding:**
  - After any job that leaves WASM memory above `recycleAboveBytes` (default 1 GiB), the worker is recycled.
  - The main thread keeps one decoded RGBA copy. It copies it (`slice()`) per job and transfers the copy, so detached buffers are never reused.
  - Object URLs for the source, the SVG preview and downloads are revoked.
  - There are no caches apart from the per-job 16 MiB palette memo, which is freed when the job ends.
- `warmup()` starts the worker and WASM at app start, so that a workflow can then run offline.

**Intake** (`src/vectorization/intake.ts`):
- Format is decided by signature, not the declared MIME type: PNG, JPEG or WebP. GIF, SVG and others are rejected.
- Header dimensions are read **before** decoding. Animated APNG and WebP are rejected.
- Limits: file ≤ 20 MiB; side ≤ 16,384; pixels ≤ the selected limit (12 MP by default, with 25/50 MP engineering overrides). Arithmetic is integer-checked.
- Decode: `createImageBitmap(imageOrientation: "from-image", premultiplyAlpha: "none")`, then `OffscreenCanvas.getImageData`, then dimensions are re-checked.

## Tests
- **Unit (`vp test`, 14 tests):** client tests use a fake worker. They cover:
  - transfer-list correctness;
  - latest-wins termination;
  - stale `jobId` dropping;
  - cancel before and after start-up;
  - crash recovery;
  - non-fatal vs fatal errors;
  - memory-based recycling;
  - PDF export refusing to interrupt a trace;
  - warm-up.

  Intake tests cover PNG/JPEG/WebP (VP8, VP8L, VP8X) header parsing, rejection of unknown, truncated, malformed and animated input, and checked dimensions, including a 2³¹×2³¹ header.
- **Browser, all three engines:**

| Test | Chromium | Firefox | WebKit |
|---|---|---|---|
| Cancel a 9 MP colour trace: `cancel()` acknowledgement in code | 0.3 ms | 0 ms | 0 ms |
| Cancel: click → "Cancelled" visible | 22 ms | 53 ms | 29 ms |
| Next job after cancel uses a new worker (`workersCreated` 2, `terminations` 1) | ✅ | ✅ | ✅ |
| 51 rapid threshold changes: final displayed result is from the final setting and stays stable | ✅ | ✅ | ✅ |
| Malformed text-as-PNG → `unsupported_format`; 16000×16000 header → `too_many_pixels` before decode; truncated PNG → `decode_failed`; app keeps working | ✅ | ✅ | ✅ |
| 20 alternating imports (colour mode): WASM memory flat at 52,625,408 B | ✅ | ✅ | ✅ |
| Worker cannot start without CSP `wasm-unsafe-eval` → actionable `worker_crashed` error (G4) | ✅ | ✅ | ✅ |

Main-thread responsiveness during processing is covered in G5 / BENCHMARKS:
- The `requestAnimationFrame` gap stayed ≈ one frame (16.7–16.8 ms in Chromium).
- The Long Tasks API reported **0** long tasks during worker processing in Chromium; Firefox and WebKit don't support it.

## Known limitations and risks
- Cancellation cost is a WASM re-instantiation; `initMs` is reported in the debug snapshot and BENCHMARKS. The 16 MiB palette memo and the RGBA copy are paid again per job.
- After a result arrives, the main thread decodes and paints the SVG preview through `<img>`. That cost is not covered by the processing probe. Multi-MB SVGs (photographs in colour mode, halftones) may jank the first paint. A P1 canvas/tiling preview should be measured.
- Recovering from a cancel while offline needs the worker script and WASM re-fetched. With production `immutable` asset caching (`wrangler pages dev`), Chromium and Firefox recover from the HTTP cache but WebKit does not. Without those cache headers (`vp preview`), Chromium fails too (G5). Fix options for P1: a service-worker precache (PWA), or a pre-spawned standby worker.
- Decoding runs on the main thread. `getImageData` on 24 MP is synchronous; see BENCHMARKS for measured decode times.
- `SharedArrayBuffer` and threads were not needed at measured sizes. They remain deferred.

## Exact versions, environment and commands
- **Versions:** TypeScript 7.0.2, React 19.3.1, Vitest 5.1.0 (via Vite+ 1.7.0), Playwright 1.65.1. Environment as in P0-G0.
- **Commands:** `pnpm exec vp test` (14 passed); `pnpm exec playwright test tests/browser/workbench.spec.ts` (final run: all workbench tests passed in Chromium, Firefox and WebKit).

## Relevant artifacts
`artifacts/browser/*-cancel.json`, `artifacts/browser/*-memory.json`, `artifacts/playwright-final-run.txt`.

## Unresolved questions
- Keep "latest wins" (terminate on every newer job), or let short jobs finish and coalesce? Each termination costs a WASM re-instantiation of 3–8 ms plus worker start-up.
- Should decoding move into the worker (OffscreenCanvas) or into WASM, to remove main-thread `getImageData` at 24 MP?

## Reproduction
`pnpm exec vp test`; then `pnpm run build && pnpm exec playwright test tests/browser/workbench.spec.ts`.
