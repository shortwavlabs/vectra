# RFC-002 review R03 — worker scheduling, recovery and early complexity estimation

**Gate result: PASS for scheduling and recovery** (12 scenarios, 3 engines, online and offline, real engine). **PARTIAL for early estimation**: bw and colour only, since limited mode has no staged API. An accurate pre-fit check exists, but no pre-segmentation decision meets "within 2 s". Concurrency: one worker remains sufficient for P1; no pool and no SharedArrayBuffer.

Harness: `experiments/rfc-002-review/bench/{scheduler.mjs, lifecycle.js, lifecycle-worker.js, lifecycle-sw.js, run-lifecycle.mjs}`.
- The real WASM engine is `packages/vector-engine-wasm/pkg`, built from `baf1d17` sources.
- Pages are served with the exact production `_headers` CSP.
- Headed Playwright 1.65.1: Chromium 159.0.8154.6, Firefox 159.0, WebKit 27.2.
- Offline means `context.setOffline(true)` followed by a reload served by a harness service worker that precaches the page, worker, scheduler and engine, mirroring the role of the P0 versioned SW.

## 1. Existing implementation (source inspection)
`src/vectorization/client.ts`:
- one pending job, with `trace()` cancelling any in-flight job (latest wins);
- cancellation terminates the worker; a generation check drops messages from discarded workers;
- `settle()` drops results for other job IDs;
- crash and fatal error discard the worker;
- recycling happens above 1 GiB.

These semantics are sound for a single-purpose workbench. Six gaps for an editor:
1. **One pending slot.** `exportPdf` rejects with `busy` while a trace runs, and a new `trace()` cancels an in-flight export. Nothing protects exports or Apply from previews.
2. **No priority or queue.** A preview cannot wait behind an export.
3. **Termination during start-up.** `trace()` → `cancel()` → `discard()` terminates the worker even when the job has not been posted yet because the worker is still loading. R03 found this breaks offline start-up in WebKit (§3).
4. **No document revision on results.** `revision` is the source-image revision, not a document revision, so "undo while a job runs" cannot be expressed.
5. **Strings as the result type.** Scene JSON and SVG strings are returned; packets are covered in R01.
6. **Dropped stale messages are counted** (`staleMessagesDropped`). Keep this.

## 2. Prototype policy (`scheduler.mjs`, ~150 LOC): the recommended minimum for P1-A
- **Workers.** One compute worker generation at a time, with terminate-and-recreate cancellation (as P0).
- **Priorities:** `export 2 > final/apply 1 > preview 0`.
  - **Only previews are pre-emptible.** A newer preview of the same scope, or any final or export, may terminate a running preview.
  - Finals and exports are never cancelled implicitly. Later jobs queue behind them; only an explicit user cancel stops them.
- **Supersession.** At most one pending job per `(kind, scope)`; a newer submission supersedes the pending one.
- **Acceptance.** Messages are accepted only from the current generation **and** for the running job ID. Everything else is counted and dropped, which covers stale results and stale errors.
- **Committing results.** The controller checks the document revision captured at submission; a result for an older revision is discarded, not committed (the RFC's conservative whole-document match).
- **Snapshots.** Job inputs are copies (`rgba.slice()`, packet clones). Committed data and the retained source are never transferred.
- **Failures.** A crash or fatal (`wasm_abort`) error rejects the running job, discards the worker and keeps the queue; the next dispatch spawns a new worker. Recycle after a job above the threshold.
- **Start-up (v2 fix).** Never terminate a worker whose job has not been posted; just swap the job. If a worker fails during start-up, re-queue the job once, since it never ran.

## 3. Lifecycle scenarios 1–12 [executed]
Scenarios run in order:
- 1–2: preview, then settings changed rapidly (5 previews);
- 3: final trace (2400×1800 synthetic colour image) validated and committed as an immutable layer with history;
- 4–6: PDF export from a frozen snapshot, with a preview submitted while it runs;
- 7: explicit cancel of a long final trace;
- 8: hash check of the committed layer;
- 9: worker replacement via injected crash and fatal abort, plus a late error after completion;
- 10: evaluation on a fresh worker;
- 11: undo and redo, including undo while a final trace runs;
- 12: everything again offline.

| Run | Chromium 159 online / offline | Firefox 159 online / offline | WebKit 27.2 online / offline |
|---|---|---|---|
| v1 scheduler (terminates during start-up) | 16/16 · 16/16 | 16/16 · 16/16 | 16/16 · **14/16** (4 of 4 runs) |
| v2 scheduler (fix, §2) | 16/16 · 16/16 (×2 runs) | 16/16 · 16/16 (×2) | 16/16 · 16/16 (×2) |

Raw data: `artifacts/lifecycle/lifecycle-v1-3-engines.json`, `lifecycle-v1-webkit-warmup-diagnostic.json`, `lifecycle-v2-run{1,2}.json`.

What the passes demonstrate, with the numbers from the v2 runs:
- **Only the latest of 5 rapid previews completes.** The 4 earlier ones are rejected as `Cancelled`, either superseded while queued or pre-empted while running.
- **The preview cannot cancel the export.** The export (57,777-byte PDF from snapshot revision 1) completes, and the preview submitted during it completes afterwards.
- **Cancel acknowledgement takes 0–1 ms** (terminate). The committed layer is byte-identical by SHA-256 over the scene JSON and packet buffers after every termination: 3 in v2 (7–8 in v1). Its 160,832-byte `coords` buffer was never detached.
- **Faults are recovered.** An injected crash surfaces as `worker_crashed` and the fatal abort as `wasm_abort`; both reject only their job. A late error sent 50 ms after the job resolved is dropped (`staleDropped` = 1). The next preview succeeds on a fresh worker.
- **Undo and redo work while jobs run.** Undo removes the layer and increments the revision. A final trace started before the undo completes, but the revision guard discards its result. Redo restores a byte-identical layer. History survives every worker termination.
- **Offline works.** All of the above passes with the network disabled in all three engines (v2).

**Finding: WebKit offline start-up under churn (new risk RISK-R03-WKCHURN).**
- **Symptom.** With the v1 policy, the 5 rapid previews created and terminated 4 workers within milliseconds while their module graphs were being served by the service worker. The fifth worker then failed with "Importing a module script failed" (`worker_crashed`). This happened in WebKit offline only, deterministically in 4 of 4 runs.
- **Diagnosis.** A warm-up job on the first offline worker succeeded, so offline worker creation itself works; the trigger is the churn.
- **Fix.** The v2 rule (no termination before the job is posted) removed the failure with zero start-up retries needed. Workers created fell from 8 to 4 per run.
- **Production exposure.** The P0 client has the same churn pattern: `cancel()` during start-up, mitigated by the 200 ms debounce. Whether the production build is susceptible is **NOT RUN**. The P1 job gate (G-JOB) must include this scenario against the production build, plus real Safari (TD-PLATFORM-002).

## 4. Early complexity estimation (TD-PERF-002)
**Question.** Can over-budget traces (TD-PERF-002: 8 of 28 P0 runs exceeded 1M anchors only after the full trace) be detected early, without silent quality reduction?

**Method [executed].**
- Crate `experiments/rfc-002-review/estimator` (own lockfile; the engine is not modified). It uses only the public API plus the hidden diagnostic `segment_layers` (TD-ARCH-004).
- Corpus: the 9 licensed regression photos (`tests/output/regression-inputs/*.png`), each at full resolution and at area-averaged downscales to ~8, 4, 2 and 1 MP. With bw and colour at the approved defaults that gives **68 traced cases** (34 per mode).
- Recorded per case: segmentation time and features, the full native trace time, and the actual anchor count (cap raised to 5M so over-budget counts are known).
- Evaluation: `analyze.py` with **leave-one-image-out** calibration. The predictor applied to an image is always fitted on the other images only (all their scales), so no threshold is tuned on the predicted image.
- Positives (> 1M): 5, all colour: stage-light 16 MP 1.31M; portrait-face 18 MP 1.15M; bark 24/8/4 MP 3.64M/1.90M/1.004M. B&W never exceeds the budget at ≤ 24 MP.
- All timings are **native, on the reference machine, under unrelated background load** (load average ≈ 14 on 18 cores). They indicate ratios, not product timings; WASM is slower.

Raw data: `artifacts/estimator/{runs.jsonl, pre-features.jsonl, evaluation.json}`.

| Predictor (colour) | Available after | Budget FP | Budget FN | Median / p90 abs. error |
|---|---|---|---|---|
| Boundary length after segmentation × k (k = max training ratio + 10 %) | segmentation: **66–99 % of trace time** (median 80 %) | **0 / 29** | **0 / 5** | 11 % / 21 % |
| Quantized-colour edge count before segmentation (best of 4 quantizations) | ~0.25 s at 12 MP | 5 / 29 | 1 / 5 | 42–52 % / 98–126 % |
| Scale law from the ~1 MP preview trace (β = max training exponent) | the preview: 0.42–2.06 s (median 0.59 s) | 2 / 20 | 1 / 5 | 18 % / 51 % |

What the numbers mean:
- **Post-segmentation detection is accurate but late.**
  - For colour mode, hierarchical clustering dominates: stage-light at 16 MP spent 73.6 s of a 73.7 s trace in segmentation. A post-segmentation check saves only the fitting share (median ~20 %).
  - It is still worth having. It turns a failure *after* fitting, compose and validate into one *before* fitting, with no false rejections on this corpus.
  - It needs a documented staged engine API (segment → estimate → fit), not the hidden diagnostic. Limited mode is not covered by `segment_layers` at all.
- **Cheap pixel statistics are not reliable estimators.** One false negative and 5 false positives, with errors around ±50 %. Do not use them for rejection.
- **The preview trace is a useful forecast, not a decision.**
  - The 1 MP preview the UI needs anyway (TD-PERF-004) predicts the full-resolution count with 18 % median error.
  - Its misses come from the spread of the scale exponent: β = 0.67–1.13 across images. It over-forecast concert-small-venue (398k → 1.30M) and portrait-large (430k → 1.58M), and under-forecast stage-light (1.31M → 0.88M).

**Recommendation (amends RFC §13, TD-PERF-002).**
1. **Forecast early, from the preview.** Show the forecast as a range ("about 0.9–1.6 M anchors"), and when the range crosses the warning level (~250k) or the budget, offer explicit choices before the final trace starts: reduce resolution to N MP, reduce detail or colours, increase pitch, or proceed. Never reject automatically on a forecast.
2. **Fail before fitting.** After segmentation, estimate from boundary length (+10 % margin) and fail with the same recoverable, actionable error if over budget. Zero false rejections on this corpus; more data is needed before calling it general.
3. **Keep the final validation authoritative.** `Scene::validate` remains the final check.
4. **Owner decision.** The TD-PERF-002 acceptance criterion "over-budget traced jobs report within 2 s" is met only by the *forecast*, not by a guaranteed decision, for large colour images on this evidence. Ratify a forecast-plus-early-fail policy, or fund a cheaper segmentation path (tiled or sampled clustering, a separate spike).
5. **Gate it.** Recalibrate on a larger licensed corpus in P1-A G-ENG, including limited mode once it has a staged API. Report FP and FN with the calibration and evaluation images held apart.


## 5. Concurrency assessment
- **One compute worker is sufficient for P1.**
  - P1 jobs are user-serialised: trace preview, Apply, export, and single-object geometry operations.
  - The lifecycle runs show queued previews behind exports completing without starvation.
  - Interactive work (pan, zoom, hit-test, selection) is main-thread or renderer work, not compute-worker work (R02).
- **Cooperative cancellation is not needed** while cancel acknowledges in ≤ 1 ms by termination and committed state is outside the worker. Revisit it only if a long *export* must be cancelled without losing a warm WASM cache. Even then, prefer chunked Rust loops that yield between chunks (a `postMessage` round trip) over SharedArrayBuffer.
- **No SharedArrayBuffer and no COEP.** Cross-origin isolation would constrain future optional online adapters and image providers. Nothing measured here needs it.
- **When to add a second worker (revisit conditions):**
  - Variation Lab thumbnails must run while an Apply or export is in flight. Use a separate low-priority worker with its own memory cap.
  - Or a measured P1-B case where export blocks interactive previews for longer than the budget.
  - The pool size is then bounded by the aggregate memory model (MEMORY-AND-RESOURCE-BUDGET), not by core count. Each extra worker can hold up to about 1 GiB of WASM memory.

## 6. Recommendations (amendments to RFC-002 §8 / D05)
1. Adopt the §2 policy as the normative scheduler contract, especially "only previews are pre-emptible" and "no termination before the job is posted". Keep it a small class; no job-graph framework.
2. Protocol v2 carries `jobId`, `generation`, `documentRevision`, `sourceDigest` and `operationVersion` on every job and result, with typed errors and the existing `fatal` flag. Fail-closed acceptance (§2).
3. Results are committed only by the controller, after validation and a revision check, in one transaction.
4. G-JOB acceptance: these 12 scenarios, plus the WebKit churn case, against the production build in three engines and real Safari, online and offline, including a service-worker update between runs.
5. Progress reporting stays honest: indeterminate while inside one WASM call; staged progress (segment → fit → validate) only once the engine exposes stages (§4).
