# P0-R final report: engineering closure and baseline acceptance

Date: 2026-11-24 · Branch: `p0/technical-feasibility` (PR #3, not merged) · Previously reviewed P0 head: `37b6c02` · `main` (PR #2 docs) merged in at `eee7115`; `origin/main` has no newer commits (checked before the final push) · Reference machine: Apple M5 Max, macOS 26.6.2.

## Summary
P0-R closes the P0 engineering gaps without starting P1.

**Fixed:**
- **The primary defect, WebKit offline recovery after cancellation.** A content-versioned service worker precaches the build, so a terminated engine worker can be recreated offline under the unchanged strict CSP. It is verified in Chromium, Firefox and Playwright WebKit on macOS and in an Ubuntu 24.04 container. This includes repeated cancels, injected crashes, worker recycling, exports, stale-result checks, zero network traffic and deployment updates.

**Linux build:**
- Linux arm64 passes the whole suite from a clean clone in a pinned container, with no CI spend.
- Engine output from the Linux-built and macOS-built WASM is byte-identical on 65 fixture/mode cases, although the binaries themselves differ: Rust's symbol hashes include the host.

**Licensing and distribution:**
- Third-party notices are generated from each dependency's own license files, shipped in `dist/` and checked by the build.
- The MIT `LICENSE` file waits only on confirmation of the copyright holder.

**Measurement and diagnosis:**
- Native-resolution CC0 and public-domain photos show that colour and limited-colour tracing of detailed photographs is far heavier than the P0 upscaled corpus suggested: 5–12 s, up to 664 k anchors, or exceeding the 1 M budget.
- Preview painting of large SVGs is the main main-thread blocker. Both are P1 inputs.
- Geometry deviations are diagnosed: an outward boundary bias from fitting through pixel-staircase corners, at most about 1 px. They are proposed for acceptance or deferral and are **not** marked as met.

**Owner actions:**
- Three actions are required before merge: the copyright holder, the geometry dispositions and the GUI export check.
- Four can be deferred explicitly: the service-worker and hosting acceptance, the real deployment, the Safari check and the P1 budget. See "Owner actions" below.

## Gate matrix
| Gate | Result | Evidence | Remaining action |
|---|---|---|---|
| Documentation reconciliation | **PASS** | [ARCHITECTURE-RECONCILIATION](ARCHITECTURE-RECONCILIATION.md): supporting decisions, P1/P2 extensions, 9 risks, 9 inconsistencies (R1–R9) | Maintainer resolves R1–R9 when approving PRD-002 / writing RFC-002 |
| P0-R-G0 Linux reproducibility | **PASS** (linux/arm64); linux/amd64 **NOT RUN** (QEMU emulation segfaults `rustc`) | [LINUX-REPRODUCIBILITY](LINUX-REPRODUCIBILITY.md); `artifacts/linux-arm64/`: final run at `01833ab`, 12/12 steps including 21 browser tests; fingerprint 65/65 identical to macOS | Optional: `scripts/linux-verify.sh --platform linux/amd64` on an amd64 host |
| P0-R-G1 Geometry quality | **PARTIAL**: 3 items PROPOSED FOR ACCEPTANCE, 2 DEFERRED; the IoU ≥ 0.98 target is still **missed** (star 0.977, rings 0.975) | [GEOMETRY-QUALITY-DISPOSITION](GEOMETRY-QUALITY-DISPOSITION.md); `artifacts/quality-probe-*.txt` | Maintainer accepts or rejects each disposition and the metric revision |
| P0-R-G2 Offline worker recovery | **PASS** (Chromium 159, Firefox 159, Playwright WebKit 27.2; macOS and Linux arm64). Real Safari **NOT RUN** | [OFFLINE-WORKER-RECOVERY](OFFLINE-WORKER-RECOVERY.md); `offline-recovery.spec.ts` (9/9), `sw-update.spec.ts` (3/3), privacy offline test | Accept the service-worker mechanism; owner Safari check (checklist §C) |
| P0-R-G3 Export compatibility | **PASS** (automated regression); GUI (Inkscape, Preview) **OWNER TEST PENDING** | [EXPORT-COMPATIBILITY](EXPORT-COMPATIBILITY.md): 79 native + 12 browser + 7 bundle PDFs verified; reports byte-identical to P0 | Inspect `owner-acceptance-bundle/` (checklist §B) |
| P0-R-G4 Deployment | **OWNER TEST PENDING** (local only: `wrangler dev` 16/16 header checks, 21/21 browser tests) | [DEPLOYMENT-READINESS](DEPLOYMENT-READINESS.md); `wrangler.jsonc`; `scripts/verify-deployment.sh` | Approve and run the preview deploy, then the verifier (checklist §D) |
| P0-R-G5 Performance and privacy | **PARTIAL**: privacy PASS; performance measured; 2 proposed budget items not met (preview frame gaps; late budget errors); lower-end hardware, Safari and mobile **NOT RUN** | [PERFORMANCE-BASELINE](PERFORMANCE-BASELINE.md); `artifacts/native-bench/` | Approve the P1 budget and the lower-end target; measure on a lower-end device |
| P0-R-G6 Licensing | **PARTIAL**: notices **PASS**; `LICENSE` pending the copyright holder (OWNER TEST PENDING) | [LICENSING-AND-DISTRIBUTION](LICENSING-AND-DISTRIBUTION.md); `public/THIRD-PARTY-NOTICES.txt` (35 components) | Confirm the copyright holder line |
| Full P0 regression suite | **PASS** | macOS (`artifacts/regression/`, run at `2ab61b4`): cargo 26/26, vp test 14/14, vp check, build, Playwright 48 passed / 9 skipped / 0 failed. The 9 skips are the opt-in benchmark, native-benchmark and owner-bundle specs × 3 engines, run separately with env flags. Export reports are identical to P0; P0 benchmark 0.97–1.02×. Since `2ab61b4` the only non-doc change is formatting in `scripts/summarize-native-bench.mjs`, a dev-only script. Linux arm64 at `01833ab`: all steps | — |

No deviation is reported as accepted: no maintainer acceptance of the P0-R proposals has been given yet.

## Changes in P0-R
- **Offline:** `scripts/generate-sw.mjs`, the `sw.js` precache check, production-only registration, offline-ready indicator, `/sw.js` no-cache header; `vp preview` applies every `_headers` rule.
- **Linux:** `docker/linux-verify/` and `scripts/linux-verify.sh`; pnpm CI-mode fix (`allowBuilds: core-js: false`).
- **Licensing:** `scripts/generate-notices.mjs` plus verbatim upstream supplements for two crates published without license files; notices linked in the workbench; `"license": "MIT"` in package.json.
- **Measurement:** `quality_probe` example, `wasm-fingerprint`, native corpus manifest and fetcher, preview and import→visible instrumentation, `native-benchmark` spec, summary script.
- **Deployment:** `wrangler.jsonc` (assets-only preview, no secrets), `verify-deployment.sh`.
- **Tests:** offline-recovery, sw-update, resource-limit recovery, owner-bundle generator; engineering hooks `?debug=1` (crash injection) and `?recycleMiB=` (no artwork involved).
- **Unchanged:** the Rust engine. The WASM SHA-256 is still `40b43967…` on macOS.

## Product principles check
All processing stays local. There is no AI or inference, no external processing APIs, accounts, subscriptions, DRM or telemetry. The CSP is strict and unchanged (the service worker uses `worker-src 'self'`). Exports are genuine vector with no raster fallback (verified). Operations are deterministic (fingerprint). Resource budgets are explicit and recoverable (tested). MIT is declared in `package.json` and third-party notices ship with the build. The `LICENSE` file itself is pending confirmation of the copyright holder.

## Defects and risks carried into P1
1. Preview painting of 12–37 MB SVGs blocks the main thread for 83–850 ms. Interactive rendering is the P1 bottleneck.
2. For traced modes, the anchor budget is enforced only after the full trace. An early estimate is needed.
3. Default spline fitting has an outward boundary bias (at most about 1 px), and 1-px diagonals are lost. The proposed correctives are a sub-pixel contour stage and Line Art.
4. Browser image decoding differs (WebKit JPEG, premultiplied alpha). In-WASM decoding is the P1 option.
5. VTracer 1.0.0-alpha.4 (pinned, adapter-isolated; reconsideration conditions are in RFC-001).
6. WASM memory reaches about 1 GiB on 18–24 MP colour, limiting lower-end and mobile devices.
7. The service-worker lifecycle and Cache Storage eviction are new operational surfaces.

## Owner actions
See [OWNER-ACCEPTANCE-CHECKLIST](OWNER-ACCEPTANCE-CHECKLIST.md).

**Required before merge:**
1. Confirm the copyright holder, so the MIT `LICENSE` file can be added.
2. Accept or reject each of the five geometry dispositions: three PROPOSED FOR ACCEPTANCE, two DEFERRED.
3. Inspect the export bundle in Inkscape and Preview.

**Before merge, or explicitly deferred by the maintainer:**
4. Accept the service-worker offline mechanism and the hosting target (Workers Static Assets or Pages).
5. Approve and run the preview deployment and `verify-deployment.sh`, or defer G4.
6. Run the real Safari check (optional).
7. Approve the proposed P1 performance budget and lower-end target. P1 planning needs this; it is not needed to merge the baseline.

## Recommendation
**CONDITIONALLY READY — LIST REQUIRED OWNER ACTIONS**

Required owner actions are items 1–3 above. Items 4–7 can be completed before merge or explicitly deferred. There are no blocking engineering defects.

## Branch
Commits since `37b6c02` are listed in PR #3. The final head SHA is recorded in the PR description: this report is part of that commit, so it cannot contain its own SHA.
