# G-JOB — Scheduler, protocol v2, worker lifecycle and single-build sessions

**Status:** **PARTIAL** (historical disposition, preserved). **Accepted in principle for downstream engineering** by the maintainer on 2026-11-25, subject to the bounded service-worker corrections in §17, which are done; TD-PERF-010 is accepted as a temporary, non-blocking performance exception ([decision register §8](../g0/G0-DECISION-REGISTER.md)). Real Safari 26.6.2 has since qualified the G-JOB scenarios (§18).

Original status at review: The scheduler, protocol v2, lifecycle, cancellation, recovery, ownership, export snapshots and single-build service-worker sessions are implemented and pass every functional qualification in Chromium, Firefox and Playwright WebKit, online, offline and across application updates (§6–§9). Two things keep the gate PARTIAL:
- **Main-thread blocking above 50 ms in job handling** (TD-PERF-010): committing a trace result blocks the main thread above 50 ms at the interactive target in every engine (Chromium 47–57 ms, Firefox 71–77 ms, WebKit 55–63 ms), and at the stress level both the commit and the export snapshot and copy exceed it. Cancel acknowledgement (30–55 ms from click to "cancelled" shown; the scheduler call itself ≤ 1 ms) and job posting (≤ 7 ms at 23.5 MP) meet their targets (§10).
- **Real Safari NOT RUN** at review (owner part; needs `safaridriver` authorisation, TD-PLATFORM-002). Run afterwards: §18.

The full P1-A phase is not complete: G-ENG and G-DOC remain PARTIAL as accepted, and G-R0, G-UI and later gates are open.

**Scope.** G-JOB only, on the merged P1-A baseline. Not started: G-R0, the production renderer, G-UI, G-R1, editing tools, Precision v2, shared-boundary geometry, deployment, export UI. No engine, geometry, Artistic or Precision v1 change: `crates/` and `packages/` are untouched. The compact-encoding follow-up is not part of this PR.

## 1. Foundation merge results
All four approved heads were verified before merging: heads, bases (`main`), ancestry (each head contains `main`'s `d6c1cbf` and AM-1's `8011555`; #14 contains every #10 and #11 commit, and no #11 commit is missing from it), passing `ci` checks, clean mergeability, and diffs (#14's own commits touch only the integration files listed in its report; no duplicated patch-ids).

| Step | PR | Approved head | Merge commit | Tree check |
|---|---|---|---|---|
| 1 | #13 AM-1 | `801155523adb` | `cb6646feb651` | tree = #13 head tree |
| 2 | #10 G-ENG | `ed3994efd033` | `f83f880895a1` | tree = #10 head tree |
| 3 | #14 Integration | `bb95b1694a9f` | `80a1d1ad8a1d` | predicted merge tree = #14 head tree = `main` tree (`a15ffea4`) |
| — | #11 G-DOC | `38afd35c18e8` | GitHub marked it **merged** after step 3 (recorded merge commit `b7f3580`, the integration branch's merge of `38afd35`) | — |

- **Integrated P1-A baseline: `80a1d1ad8a1ddad8ae2218bf5a86897f1b7d4ebd`.** The standalone test-adapter state of #11 never reached `main`.
- **Production validator is the sole path:** `src/document/packet-port.ts` wraps only `src/geometry/packet` (`validatePacket`, `encodeRecord`, `decodeRecord`); `src/document/testing/packet-adapter.ts` is absent; no source outside the architecture test mentions `packet-adapter`.
- **CI on `main`:** run `45639879290` (`80a1d1a`, full checks: fmt, clippy incl. production libraries, cargo test, WASM build, `vp check`, `vp test`, production build) **success**; `45639736039` (`cb6646f`) success; `45639797846` (`f83f880`) **cancelled** by the concurrency group when `80a1d1a` was pushed, so it did not complete.
- **Frozen regressions on `80a1d1a`:** `regression_corpus` **326/326** identical to `a4cf172.sha256`; `geo_bundle` **72/72** identical to bundle v2; document export regression **636/636** frozen hashes (106 scenes × 3 files × 2 codecs; 83.7 s). WASM package rebuilt from `main`: `285973b4…`, 645,765 B, identical to the previously built package.

## 2. Branch protection
Read before changing (`protection-before`), then changed only the two approved fields through their dedicated endpoints:

| Setting | Before | After |
|---|---|---|
| Required status check | `ci` (GitHub Actions, app 15368) | unchanged |
| `strict` (branch up to date) | false | **true** |
| `enforce_admins` | false | **true** |
| Force pushes / deletions | prohibited | unchanged |
| Signatures, linear history, conversation resolution, lock, fork sync, required reviews | off / none | unchanged |

The API diff of the full protection object before and after shows exactly these two fields. No ruleset exists. The merges above happened before tightening, with every required check passing; nothing was bypassed.

## 3. CI results
- `main`: see §1.
- G-JOB PR: [shortwavlabs/vectra#15](https://github.com/shortwavlabs/vectra/pull/15); its head and CI run are recorded in the PR description.

## 4. Outstanding performance exceptions and ownership
| Item | Status | Owner / gate |
|---|---|---|
| TD-PERF-008 copy-out at 1M anchors (≤ 2 ms) | accepted exception, open; quiet re-run pending | performance follow-up |
| TD-PERF-009 open at 250k paths (≤ 1 s) | accepted exception, open; bounded compact Document v1 follow-up approved | before G-PRJ and public Document v1 |
| TD-PERF-007 structural transactions O(nodes) | open; closure criteria **approved** (≤ 16.7 ms median, ≤ 33 ms p95 at the interactive target; ≤ 50 ms at stress; incremental = full over ≥ 10,000 random transactions; full validation for untrusted loads) | investigate in G-R1, qualify before G-EDIT |
| Main-thread responsiveness ≤ 50 ms | obligation for G-TRACE and G-PRJ; measured here as **TD-PERF-010** (new) | G-TRACE, G-EXP, G-PRJ |
| TD-PLATFORM-007 native/WASM Artistic | open; packet determinism across Rust/WASM/TS kept | — |
| Malformed-manifest-text error codes | accepted bounded exception; scope and pinned test in `tests/fixtures/packet-conformance/README.md` | — |

Recorded in the [decision register §7](../g0/G0-DECISION-REGISTER.md) and the [debt register](../../TECHNICAL-DEBT.md).

## 5. Implementation
| File | Role |
|---|---|
| `src/jobs/protocol.ts` | Protocol v2 messages: build identity, the job header (`jobId`, `generation`, `kind`, `documentRevision`, `operationVersion`, `sourceDigest`), `trace`/`export` requests, `status`/`progress`/`result`/`error` responses, debug faults |
| `src/jobs/build-info.ts`, `vite.config.ts` | `BUILD_IDENTITY`: protocol 2, a build ID (content hash of `src`, `public`, the WASM package, the lockfile and the configuration), the Cargo engine version, packet version 1 |
| `src/jobs/scheduler.ts` | The production scheduler (RFC §10.3) |
| `src/jobs/compute.worker.ts` | The production compute worker: handshake, staged trace, export, typed errors |
| `src/jobs/controller.ts` | Binds the scheduler to the document: revision-checked commits, frozen export snapshots, ownership and reservations |
| `src/workspace/useWorkbench.ts` | The workbench now runs on the job system; `src/vectorization/client.ts`, `src/workers/*` and their test are deleted |
| `src/workspace/qualification.ts` | `?debug=1` qualification API for browser tests (outcomes, stages, counters, digests; never artwork) |
| `scripts/generate-sw.mjs` | Single-build service worker |

**Scheduler** (one compute worker; terminate-and-recreate cancellation):
- Priorities `export > final = apply > preview > thumbnail`, FIFO within a priority.
- Previews and thumbnails are superseded (one pending per kind and scope) and pre-empted (by a newer job of the same kind and scope, or any higher priority). Explicit jobs are never pre-empted, superseded or cancelled implicitly.
- Explicit jobs are accepted into a bounded queue of **4 waiting jobs (the running job is not counted)** or refused before acceptance with `busy`, naming what is queued. Previews are never refused.
- Nothing is posted before `ready`. A starting worker is never terminated because its job was cancelled or replaced; only the **start-up timeout (10 s)** or a start-up error discards it. A never-run job is requeued **once**; if the retry fails too, it and everything queued fail with `worker_startup_failed` and an offline-cache hint. The next submission tries again.
- Handshake mismatch (protocol, build ID, engine version, packet version) is fatal build skew: the worker is discarded without requeue, every accepted job fails `build_mismatch`, later submissions are refused, and the workbench asks for a reload.
- Messages are accepted only from the current generation and for the posted job. Everything else is dropped and counted: stale generation, wrong generation (the worker is then terminated, C5), unmatched job, duplicate results, late errors, stale progress.
- Crashes fail the posted job (`worker_crashed`); fatal errors (`wasm_abort`) discard the worker; non-fatal errors keep it. Recycling after a job above 1 GiB of WASM memory.
- Every job settles exactly once, as `succeeded`, `cancelled{user|superseded|preempted|disposed}` or `failed{code}`; the controller adds `committed`, `delivered` and `stale{reason}`.
- Diagnostics: 24 counters (`workersCreated`, `terminations`, `handshakes`, `buildMismatches`, `startupTimeouts`, `startupRetries`, `crashes`, `fatalErrors`, `recycles`, `rejectedBusy`, `superseded`, `preempted`, the drop counters, `settleViolations`, …), exposed as `window.__vectra.stats`.

**Worker.** `ready` reports the worker bundle's build identity and the **loaded WASM's** `engineVersion()`. Traces run `segment` → `estimate` → `fit` (C4), posting `progress` as each stage starts (no percentages); the estimate is returned, never acted on. Packets leave WASM with one copy per array and are transferred. Exports build a `PacketSet` from job copies and call `exportDrawListSvg`/`Pdf`. Engine errors are typed and non-fatal; traps are `wasm_abort` and fatal.

**Controller.**
- *Commits (RFC §10.3 rule 3b).* A final trace into a new layer commits at the current revision if its source asset still has its digest; a replace whose target layer's chunk set changed, or any result for a replaced document, is `stale`. The commit is one `commitTrace` transaction; the store's commit is the trust-boundary validation (C2), and a failure leaves the document unchanged with the typed code. Preview results are never committed.
- *Export snapshots (rule 7, C8).* `buildExport` runs at request time and is deep-frozen; its chunks are retained as `snapshot` until the job settles on any path; copies are made with `jobCopy` only when posted. Committed buffers are never transferred.
- *Reservations (RFC §11.3).* A trace reserves its input-copy bytes and an export the C3 cost of the chunks it will copy, at submission (budget 1 GiB), released at settle on every path; over budget, or a source above the request's pixel limit, is refused with `resource_budget` before any worker starts. The engine's anchor limit stays authoritative (`too_many_primitives`), with no downsampling.

**Workbench.** A settings change submits a preview trace; its packet is validated into a separate preview session, and a preview-class SVG job renders it through the document export path. Downloads are those SVG bytes and an explicit, frozen PDF export. Loading an image cancels previews only. A waiting update is announced ("used once every Vectra tab has been closed").

**Deviations and decisions to review:**
1. **A workbench preview is two worker jobs** (trace, then SVG), because the protocol returns packets, not SVG. Downloads stay byte-identical (§11). Cost at the interactive target: see §10.
2. `kind` in the job header is the scheduling class; the message `type` (`trace`, `export`) is separate.
3. **Queue capacity 4 counts waiting jobs only.** Measured at saturation on the final code (2400×1800 source, B&W): one running and two waiting finals, two waiting exports and one preview reserved 69.1 MB (the two exports reserved nothing: the document had no layer yet when they were frozen) and drained in 0.56–1.31 s; the fifth waiting explicit job was refused. By the same accounting, a full queue of 12 MP colour finals would reserve ~240 MB (5 × 48 MB) of input copies, plus each export's chunk copies, and drain in about five single-job times. The 1 GiB budget therefore does not bind before the capacity does for traces. Kept provisional (RFC §10.3); lower-end hardware may change it.
4. **Scenario 11 follows rule 3b**, not R03's whole-document revision guard: a final trace committed during an undo, and became `stale` only when its source attachment was undone.
5. `operationVersion`: the preset version for traces, `1` (the AM-1 export draw list) for exports.
6. Fault injection lives in the production worker but is only ever sent by the `?debug=1` workbench (as P0's `debug-crash` was).
7. The service worker claims pages only on a first install (see §8).
8. **Render-worker handshake not implemented**: the render worker does not exist until G-R0. The identity check in the scheduler is the one G-R0 must apply (C5).
9. Not implemented here: `estimate` and `op` request types (G-TRACE, G-EDIT), production export UI (G-EXP).
12. **Geometry digests are not carried in the protocol.** Trace jobs carry `sourceDigest`; the "relevant geometry digests" belong to `op`/Apply jobs, which do not exist until G-EDIT. Replace staleness uses chunk identity instead (deviation 10).
13. **The `job` owner kind is unused.** No G-JOB path retains a chunk as `job`: a pending trace owns only its byte reservation, and an export holds `snapshot` references plus its reservation. The tests' "`job` counts return to 0" are therefore trivially true; the `job` kind becomes meaningful with op jobs (G-EDIT).
10. **Replace staleness compares chunk IDs, not content digests.** Chunks are immutable and IDs are never reused, so a real geometry change is always detected; but re-committing byte-identical geometry under a new chunk ID makes a pending replace of that layer `stale` (conservative: the user is asked). Per-chunk content digests exist only at save time (C1).
11. Exports reserve the C3 cost of the chunks they will copy (RFC §11.3), so the reservation budget covers export and display copies too.

## 6. Protocol and scheduler conformance
Unit tests (`vp test`, Node 24.22.1, `vite-plus/test`):
- `src/jobs/scheduler.test.ts` — **63 tests**: handshake ordering and header fields; each of the four identity mismatches; start-up timeout with one requeue and the actionable second failure; module-load failure before `ready`; the churn rule (five previews during start-up: one worker, no termination); pre-emption by scope and priority; explicit jobs never cancelled by previews; priority then FIFO; thumbnail lowest; queue saturation; cancel of starting, queued and posted jobs; dispose; crash, fatal and non-fatal errors; late, duplicate, stale-progress and wrong-generation messages; recycling; progress forwarding; unknown message types counted; and a **property test over 40 seeds** × 300 random steps (submissions of every kind, cancels, ready, results, errors, crashes, start-up failures, timeouts, duplicates) asserting that every job settles exactly once, explicit jobs are cancelled only by the user, nothing is posted before `ready`, and no starting worker is terminated except by a start-up failure.
- **Mutation checks** (at 62 tests): terminating starting workers on cancel → 42 failures; allowing explicit jobs to be pre-empted → 48 failures.

## 7. Ownership and recovery
- `src/jobs/controller.test.ts` — **21 tests**: new-layer commit from a job copy; an unrelated edit does not make it stale; undoing the source attachment does; document replacement; replace with a changed vs unchanged target; an invalid packet fails commit validation with the document unchanged; an export frozen before concurrent edits (fill change and deletion); `snapshot` reference counts (and the unused `job` counts, deviation 13) return to 0 after delivered, cancelled while running, crash, fatal and engine errors, dispose, cancelled while queued, build mismatch and start-up failure; a `busy` rejection retains and reserves nothing; resource budgets (traces and exports); typed failure for a wrong-type result or unreadable metadata; previews never commit; and a property test (400 random steps) ending with no reservation, no snapshot or job reference and an intact store. Mutation checks (at 19 tests): removing the snapshot release → 8 failures; removing the source check → 1 failure.
- Browser (§9): committed geometry, history and provenance are byte-identical (canonical container SHA-256) after six cancels of running traces plus six injected crashes, offline; undo/redo still restore the same digest; failed or cancelled explicit jobs never change the digest; `snapshotRefs` and `reservedBytes` end at 0.

## 7a. Independent review
A separate reviewer (fresh context, given the specification and the code, not my conclusions) reviewed `main...gate/g-job-scheduler` at `d32f27c` plus the uncommitted instrumentation. No HIGH findings. Dispositions (fixes in `e5b1814`, each with a test unless noted):

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | MEDIUM | The workbench's SVG job used another scope than its trace, and results were checked only against the image revision: an old SVG result could show old settings as "done" mid-trace (re-enabling downloads), and a preview pre-empted by an explicit job was dropped | Fixed: one scope for both steps, only the latest request updates the UI, a step pre-empted by an explicit job is resubmitted. Browser test fails without the fix (stuck in `processing`) |
| 2 | MEDIUM | React StrictMode's development remount disposed the scheduler permanently (dev only) | Fixed: dispose only when no remount follows. Checked on `vp dev`: trace done, one worker, no termination (no automated dev-mode test) |
| 3 | MEDIUM | A deploy changing only the service-worker template kept VERSION; a failed reinstall would delete the live cache | Fixed: VERSION hashes the template, and an install deletes only a cache it created (no dedicated browser test) |
| 4 | MEDIUM | Exports did not reserve their job-copy bytes (RFC §11.3) | Fixed: reserved at submission, refused over budget, released on every exit |
| 5 | LOW | Unreadable scene metadata rejected the outcome promise; a wrong-type result could be delivered as an empty file | Fixed: typed `failed` |
| 6 | LOW | Unknown message types for the posted job were silently ignored, not counted | Fixed: counted as `unmatchedDropped` |
| 7 | LOW | Replace staleness compares chunk IDs, not digests | Kept and documented (deviation 10): conservative |
| 8 | LOW | An empty cache left by a killed first install blocked the first-install claim | Fixed: only non-empty caches count as a previous version |
| 9 | LOW (pre-existing on `main`) | After a failed decode of a second file, a settings change leaves the status at `processing` | Not changed (P0 workbench behaviour, outside G-JOB); recorded here |

Areas the reviewer checked and found sound: settle-exactly-once on every path (including `createWorker`, `build()` or `postMessage` throwing), explicit jobs never cancelled implicitly, no starting worker terminated before its handshake, stale messages never acted on, ownership on every path, document replacement, no mixed-build session, previews never committed.

## 8. Offline and application-update qualification
**Service worker** (`scripts/generate-sw.mjs`):
- Navigations come from the controlling version's cache, so a tab never runs a newer shell than its cache holds.
- An install that fails deletes its partial cache (never a cache that already existed); the old version stays intact. VERSION also hashes the generator template, so a worker-only change installs into a new cache.
- Activation deletes older `vectra-*` caches (they have no controlled page by then) and claims pages only on a first install, so a page of another build is never adopted by a cache that lacks its assets.
- Cache lookups ignore `Vary`. **Found and fixed:** the preview server sends `Vary: Origin`, and module scripts and stylesheets are CORS requests carrying `Origin`, so the P0 worker never matched them: **an offline reload of the page was blank**. P0's offline tests never reloaded offline, which is why it went unnoticed.

**Tests** (`tests/browser/sw-update-lifecycle.spec.ts`). Build 2 is a genuinely different production build (salted `vp build`, plus a WASM variant with a custom section), so its build ID, page, worker and WASM file names all differ; build 1's files are removed from the server on deploy, and the server sends `Vary: Origin`:
- old tab after a deploy: update installed and announced, not activated, not forced;
- worker recreation in the old tab online and offline, including the five-preview churn pattern offline;
- reload of the old tab (online and offline) stays on build 1; a second tab opened then also gets build 1;
- after the old tabs close: build 2 activates, build 1's cache is deleted, build 1's worker URL is no longer served (404);
- offline after the update: reload, trace and churn recreation on build 2;
- interrupted install (the WASM request fails mid-install): no partial cache, old version intact offline, a later update check installs build 2;
- mixed-version refusal (`jobs-adversarial.spec.ts`): a worker reporting another build ID is refused, no job is posted, explicit submissions fail `build_mismatch`, the page asks for a reload.

Mutation checks: network-first navigation → the old tab reloads into build 2 (fails); no install cleanup → a partial cache remains (fails).

## 9. Browser results
Production build (`vp build`, `_headers` CSP via `vp preview`), Playwright 1.65.1, Chromium 159.0.8154.6, Firefox 159.0, Playwright WebKit 27.2 (**not Safari**), headless, macOS (Apple M5 Max).

| Spec | Tests | Chromium | Firefox | WebKit |
|---|---|---|---|---|
| `jobs-lifecycle` (R03 1–11 online, 12 offline, WebKit churn ×4 offline) | 3 | pass | pass | pass |
| `jobs-adversarial` | 11 | pass | pass | pass |
| `sw-update-lifecycle` | 2 | pass | pass | pass |
| P0: `smoke`, `csp`, `privacy`, `workbench`, `offline-recovery`, `precision`, `sw-update` | 17 | pass | pass | pass |
| `owner-bundle` (bundle v1 regenerated through the workbench, Chromium) | 1 | 14/14 byte-identical | — | — |

**Full run on the final code (`e5b1814`): 99/99 passed** (4.6 min): 33 tests × 3 engines. The PR head `403585c` adds only the perf spec's event logging (gated, not in this run), documentation and whitespace formatting of the JSON artefacts. Artefacts: `docs/research/g-job/artifacts/`. R03 lifecycle diagnostics were identical in all six engine × online/offline runs: 5 workers, 4 terminations, 4 pre-empted previews, 1 crash, 1 fatal error, 1 late error dropped, 0 start-up failures, 0 settle violations. Churn: 4 of 4 runs per engine, one worker per run, no start-up failure.

## 10. Performance
**Conditions.** Apple M5 Max (18 cores), macOS. Headed browsers, viewport 1280×720 with Playwright's desktop device defaults (DPR 1; WebKit DPR 2) — not C9's 1280×800 at DPR 2. Main-thread job handling does not depend on the viewport; rendering is out of scope. Production build. **Not quiet:** no `ngspice`, but unrelated CPU-bound processes were running (load average recorded per run). Workloads (local, hashed, from the licensed regression inputs with macOS `sips-316`): `bark-1224.png` `a4629ed3…` (colour, **269,996 anchors, 16,056 paths**: at the interactive target's anchor count but with fewer paths than its ~40k, so the per-node part of a commit is smaller here than at the target), `bark-2350.png` `daa939de…` (colour, **812,003 anchors, 43,621 paths**, stress; the 1M cap refuses larger), `portrait-large-q90.jpg` `952dbf0f…` (B&W, 23.5 MP source copy). Method: `GJOB_PERF=1 GJOB_PERF_LABEL=run-c pnpm exec playwright test tests/browser/jobs-perf.spec.ts --headed`; 5 / 3 / 3 committed finals per workload (undo between repetitions), one export, one cancel during `fit`; per-step main-thread times from the controller, rAF gaps and Long Tasks (Chromium only; Firefox and WebKit use the rAF probe).

**Cancellation acknowledgement (≤ 200 ms): met.** At the C9 boundary (cancel clicked → "cancelled" shown), `workbench.spec.ts` in the final run (`e5b1814`, `artifacts/*-workbench-cancel.json`): **30 ms** Chromium, **55 ms** Firefox, **33 ms** WebKit, including Playwright's click dispatch. The scheduler's `cancel()` call itself returns in 0–1 ms in every engine and workload (at the browsers' coarsened timer resolution; pages are not cross-origin isolated), including cancel during `fit` at 812k anchors.

**Attributable main-thread blocking (≤ 50 ms): not met.** Run C on the final code (`docs/research/g-job/bench/run-c/`; load average 8.7 → 10.7, five unrelated CPU-bound processes), ranges over the repetitions, ms; run B (`run-b/`, earlier code with the same main-thread steps; load 2.4 → 12.4) agrees within about ±25 %:

| Workload | Step (one task) | Chromium | Firefox | WebKit |
|---|---|---|---|---|
| Interactive 270k / 16k paths | trace job copy + post | 0.3–0.4 | 0–1 | 0–1 |
| | **final commit** | **47.2–56.7** (Long Task 62) | **71–77** | **55–63** |
| | of which store commit (move + validate + publish) | 13.6–20.0 | 20–27 | 18–22 |
| | export snapshot / post | 15.1 / 9.0 | 17 / 13 | 31 / 19 |
| | workbench preview commit | **69.5** | **83** | **74** |
| Stress 812k / 44k paths | **final commit** | **129.5–135.5** (Long Task 156) | **174–238** | **146–151** |
| | **export snapshot / post** | 33.8 / 22.4 | **55** / 32 | **89 / 59** |
| | workbench preview commit | **149** | **185** | **166** |
| 23.5 MP B&W | job copy + post | 5.1–5.2 | 5–6 | 7 |

- The trace itself runs entirely in the worker. Scheduling, posting and result transfer are cheap at every size.
- The misses are the steps that touch a whole packet or a whole document on the main thread: the commit (about a third is the C2 store commit, the rest is the document transaction's whole-state pass, TD-PERF-007) and the export snapshot (`buildExport`) and copy (`jobCopy`). When the worker is idle, snapshot and post run in the same task.
- Registered as **TD-PERF-010** (High) for G-TRACE (commit) and G-EXP (export), consistent with the maintainer's obligation that G-TRACE and G-PRJ qualify ≤ 50 ms with bounded scheduling, time slicing or worker preparation. Nothing was rewritten in G-JOB (no store rewrite).

**Other measures** (run C): worker time per final, colour: 1.7–2.0 s at 270k, 7.8–8.6 s at 812k. Workbench preview (trace + SVG) round trip: 2.0–2.4 s at 270k, 8.6–10.0 s at 812k. Run C's first Chromium attempt ended with "execution context was destroyed"; a rerun with navigation and crash logging recorded no event and passed. The app has no navigation path (`src/` only reads `location.search`); interference with the headed window cannot be ruled out (another user session was logged in). The cause was not found (`bench/README.md`).

## 11. Regression results
| Check | Result |
|---|---|
| `regression_corpus` (326) and `geo_bundle` (72) on `80a1d1a` | **326/326**, **72/72** identical |
| Same on the G-JOB branch (`d32f27c`; `crates/` and `packages/` unchanged since `main`) | **326/326**, **72/72** identical |
| Document export regression (636) on `80a1d1a` and on the G-JOB code (`e5b1814`) | **636/636** both (83.7 s, 55.0 s) |
| Bundle v1 regenerated through the new workbench path (`OWNER_BUNDLE=1 OWNER_BUNDLE_DIR=…`) | **14/14** files byte-identical to `docs/research/p0-r/owner-acceptance-bundle/` |
| `vp test` | 337/337, 18 files (the 200-line P0 client test is deleted with the client) |
| `vp check` | pass |
| P0 browser suites | 51/51 on the scheduler before the service-worker change; in the full run since |

## 12. Debt dispositions
- **TD-ARCH-002**: production-build verified in 3 engines (online, offline, across updates); Safari pending. Not closed.
- **TD-ARCH-006**: fix production-build verified in 3 engines offline and across an update; Safari pending. Not closed.
- **TD-PLATFORM-006**: implemented and verified in 3 engines; the offline-reload defect found and fixed; Safari pending. Not closed.
- **TD-PERF-004** (scheduler part): done; preview resolution, import debounce and acceptance criteria are G-TRACE's. Not closed.
- **TD-PERF-003** (ledger): job reservations and reporters added; profiles pending. Not closed.
- **TD-PERF-002**: the staged estimate is reported, never acted on. Not closed (G-TRACE).
- **TD-PLATFORM-002**: Safari NOT RUN.
- **New:** TD-PERF-008, TD-PERF-009 (accepted P1-A exceptions), **TD-PERF-010** (measured here). Totals: 42 open, 14 High.

## 13. NOT RUN and blockers
- **Real Safari** (worker start-up, offline recovery, service-worker updates, churn): NOT RUN at review; **run afterwards in Safari 26.6.2, 10/10** (§18). iOS and other Safari versions remain NOT RUN.
- **Quiet-machine benchmarks**: NOT RUN; other projects' CPU-bound processes were running throughout.
- **Lower-end hardware** (start-up timeout value, queue capacity): NOT RUN (TD-PLATFORM-003).
- **Render-worker handshake**: not applicable until G-R0.
- **Linux amd64 browsers**: NOT RUN (CI runs unit tests and the build only).
- **Blocker for closing G-JOB:** TD-PERF-010 (main-thread blocking) needs a maintainer decision: accept it as an exception owned by G-TRACE and G-EXP (the work is already obligated there), or require it fixed within G-JOB.

## 14. Pull request
[shortwavlabs/vectra#15](https://github.com/shortwavlabs/vectra/pull/15), branch `gate/g-job-scheduler`. The head SHA and the CI run for it are in the PR description (recording them here would change the head).

## 15. Recommended next gate
**G-R0** (minimal renderer with worker host): it depends on G-DOC (merged) and on G-JOB's handshake, and it owns the render-worker half of protocol v2 and the display path that replaces the workbench's SVG preview job. **G-UI** can start in parallel. The compact Document v1 follow-up (TD-PERF-009) can run independently on its own branch.

## 16. Disposition
**G-JOB: PARTIAL** (historical; accepted for downstream engineering, §17–§18). At review: Functional qualification passes in Chromium, Firefox and Playwright WebKit, online, offline and across updates; cancel acknowledgement meets its target; main-thread blocking in job handling does not (TD-PERF-010); real Safari is NOT RUN. Historical dispositions unchanged: **G-ENG PARTIAL, G-DOC PARTIAL**; P1-A integration correctness accepted. The P1-A phase is not complete.

## 17. Conditional-acceptance corrections (2026-11-25)
Tested commit: **`02d3bca`** (code), on PR #15.

**17.1 Template-only update regression (review finding 3).** `tests/browser/sw-update-lifecycle.spec.ts`, "a service-worker-only update gets a new cache…": build A installs and activates; build B has byte-identical application files and a service worker from a generator whose template differs by one comment; B's cache version differs from A's; B's install is cut mid-way (the WASM request fails); A's cache keeps all 6 entries; offline reload and worker recreation with start-up churn run under build A; with the network back, B installs completely and waits. **Mutation check** with the original defect (VERSION without the template, unconditional delete on failure): the test fails at the version assertion, and with that assertion disabled it fails at "build A's cache untouched" (the live cache was deleted).

**17.2 Missing application shell.** Before: if the controlling cache lacked its shell, navigation fell back to an unrestricted network fetch, so a tab could load a newer build's shell under an older cache. Now (`scripts/generate-sw.mjs`, every precached `.html` file is a shell):
- the shell is **repaired only from an identical build**: the network shell is accepted only if every asset it references is in the controlling version's precache list, and it is then re-cached;
- otherwise the worker serves a **static recovery page** (no script, no inline style, the production CSP, HTTP 503): reason `version` (the server has another build) or `offline` (unreachable). It says that other tabs keep working and should be used to save work, and how to load the latest version (Shift-reload for this tab without offline support, or close every Vectra tab). No tab is reloaded; committed artwork in running tabs is untouched. Recovery wording is distinct from the update notice.
- **First-install claiming:** a deploy between page load and service-worker registration can make a worker of build B claim a page of build A. The worker now reports its `BUILD_ID`; the page shows "Offline-ready" only when its controller caches its own build, and otherwise a distinct notice ("Offline support is unavailable in this tab: a different version of Vectra is installed…"). The worker handshake (C5) still refuses any worker of another build; hashed asset names mean page A can never receive build B's worker.
- **Non-hashed fallbacks:** apart from the shells, the only non-hashed precached file is `THIRD-PARTY-NOTICES.txt` (text, never executed). Hashed assets can only fall back to the same bytes or fail.
- **Browser cache eviction (unavoidable limits):** browsers may evict an origin's storage under pressure (WebKit also evicts script-writable storage of origins unused for a period). If the whole cache is evicted, no service worker controls the next navigation, which then loads the current build from the network, consistently, without offline support until it reinstalls. If only part is evicted, the shell is repaired or the recovery page is shown; an evicted worker or WASM asset ends a worker start-up with the typed, actionable `worker_startup_failed` (offline hint), never with another build's asset.

Tests (all engines): an evicted shell with build 2 on the server shows the `version` recovery page while another tab of build 1 keeps working (worker recreation), and offline shows the `offline` page; an evicted shell with the same build is repaired; the first-install race shows the mismatch notice. **Mutation checks:** the old unrestricted fallback fails the recovery test; an offline-ready that ignores the build fails the first-install test.

**17.3 Qualification on `02d3bca`.**
- Service-worker specs: `sw-update-lifecycle` 6/6 in each of Chromium, Firefox and Playwright WebKit. In Firefox, Playwright's offline emulation does not cover service-worker fetches, so the offline step of the eviction test makes the server unreachable.
- Complete G-JOB functional suite: **111/111** (37 tests × 3 engines: `jobs-lifecycle`, `jobs-adversarial`, `sw-update-lifecycle`, and the P0 suites). Bundle v1 through the workbench: 14/14 byte-identical. `vp test` 337/337; `vp check` pass.
- `crates/`, `packages/` and the export path are unchanged since `e5b1814`, so the 326 + 72 (`d32f27c`) and 636 (`e5b1814`) results still apply.

## 18. Real Safari qualification (2026-11-25)
**Setup.** Safari **26.6.2 (21624.5.1.11.3)**, `safaridriver` "Included with Safari 26.6.2", macOS 26.6.2 (25G83), Apple M5 Max. The maintainer enabled `safaridriver`. The harness is a dependency-free W3C WebDriver client (`tests/safari/webdriver.mjs`) driving a headed Safari automation window. Each scenario gets a fresh session and a fresh origin (a static server with the production CSP and `Vary: Origin`). Command: `pnpm run build && node tests/safari/gjob.mjs`. Load average 2.9 → 3.2 (not quiet; not a timing benchmark). Evidence: `docs/research/g-job/safari/gjob-02d3bca.json`.

**Offline in Safari** means the origin refuses connections: WebDriver has no network emulation, and `navigator.onLine` stays true. This exercises the service worker's cache and network-failure paths, not the OS offline state.

| Scenario | Result | Evidence |
|---|---|---|
| Compute-worker start-up and protocol handshake | PASS | handshake 1, no mismatch; the controller reports the page's build |
| Rapid preview replacement during start-up (churn), online + 4 runs offline | PASS | each run: 4 previews cancelled, last succeeded, exactly one new worker, no start-up failure |
| Cancellation (C9: click → "cancelled" shown) | PASS | 5 ms; scheduler cancel 0–1 ms |
| Offline application reload and worker recreation | PASS | same build offline; churn recreation |
| Single-build sessions across a deploy | PASS | update announced, not forced; old tab recreates workers online and offline (churn) and reloads stay on build 1; a second tab gets build 1; after the old tabs close, build 2 activates, one cache remains, build 1's worker URL returns 404; build 2 works offline |
| Service-worker template-only update | PASS | new cache version; interrupted install left build A's 6 entries; offline reload and churn under A; B then installs |
| Interrupted update installation | PASS | no partial cache; old version offline; later install succeeds |
| Cache-eviction recovery | PASS | same build: shell repaired; build 2 on the server: `version` recovery page, no app code ran, another tab keeps working; unreachable: `offline` page |
| Frozen export snapshots | PASS | export accepted before a concurrent recolour has the pre-edit digest; a later export differs |
| Document integrity after worker termination | PASS | after 4 × (cancel a running trace + injected crash) offline, the canonical container digest is unchanged; undo/redo restore it; no leaked snapshot or reservation |
| Build-mismatch refusal | PASS | a worker reporting another build ID is refused (0 handshakes, state `skewed`) |

**10/10 scenarios pass.** These results cover G-JOB only. Not covered: iOS/iPadOS Safari, other Safari versions, the OS-level offline state, and performance in Safari (no timing benchmark was run).
