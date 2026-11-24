# RFC-002 review R03 (part 2) and §13 — aggregate memory model and performance budget review

The reference machine (Apple M5 Max, 128 GB) is **not** representative consumer hardware. Lower-end measurements are **NOT RUN**: no M1 8 GB or 4c/8t laptop was available (TD-PLATFORM-003). Browser CPU throttling is not used as a substitute, because P0-R showed it does not throttle dedicated workers. All timings in this review ran under unrelated background load (load average ≈ 13–16 on 18 cores; `artifacts/renderer/timing-environment.txt`).

## 1. Aggregate memory model
Per-component cost, from measurements where available:

| Component | Where it lives | Cost model | Evidence | Lifetime / eviction |
|---|---|---|---|---|
| Original compressed source | main (Blob) | ≤ 20 MiB per source (P0 limit) | P0 intake limits [source] | Retained while referenced by document or history; required for relink and retrace |
| Decoded source RGBA | main | w·h·4: **48 MB at 12 MP**, 96 MB at 24 MP | arithmetic | **Evictable cache** (RFC §8); re-decode from the Blob on demand |
| Trace job input | worker | one RGBA copy (`slice()`, transferred), plus one copy into WASM linear memory (`passArray8ToWasm0`) | [source: `useWorkbench.ts`, glue] | Job lifetime; during a trace the RGBA exists **3×** (main cache, worker buffer, WASM) |
| WASM linear memory | compute worker | 44 MiB (1.2 MP B&W) … 357 (12 MP B&W) … 538 (12 MP colour) … **972 MiB (23.5 MP colour)**, 910 (18 MP limited) | P0-R PERFORMANCE-BASELINE [measured at P0] | Never shrinks; recycle the worker above a threshold (P0: 1 GiB) |
| Committed geometry (packet chunks) | main | **42–52 bytes per anchor** (≈ 45–52 MB per 1M anchors) | R01 `node-transport.json` [measured] | Refcounted by document, history and jobs |
| Derived: bounds and subpath starts | main | 32 B per path + 4 B per subpath | R01 | With the chunk |
| Hit-test index | main | ≈ 51 B per indexed item (10.0 MB for the 195k-subpath halftone) | R02 `indexBytes` [measured] | Rebuilt per chunk; evictable |
| Renderer caches | main / GPU | Canvas: backing store W·H·DPR²·4 (16 MB at 2560×1600) plus browser-native Path2D (not exposed). WebGL: f32 vertices and u32 indices ≈ 40 B per anchor at 0.05 px flattening (39 MB at 977k), held on CPU **and** GPU for context-loss recovery, plus the MSAA framebuffer (~16 MB × 4 samples estimate) | R02 [measured]; GPU memory not observable from the page | Disposable; never authoritative |
| History-only geometry | main | ≤ 128 MiB unique bytes (RFC; 64 MiB constrained) | — | Oldest whole transactions evicted, with visible truncation |
| Pending job payloads | worker | export: one packet copy per job (≈ 45 MB at 1M anchors) | R01 | Job lifetime |
| Export buffers | worker then main | SVG text ≈ 25–50 B per anchor (P0-R: 36.8 MB at 977k; synthetic 49.5 MB at 1M); PDF ≈ 0.3× SVG thanks to Flate (P0-R finding 6; 8–12 B per anchor) | P0-R | Released after download (Blob URL revoked) |
| Multiple sources (future) | main + worker | sum over sources; decode one at a time | — | Aggregate cap, not per-source |

### Worked peaks (estimates from the components above, not measured end to end)
| Scenario | Main thread | Worker (peak) | Total |
|---|---|---|---|
| 12 MP colour trace committed as ~400k anchors, idle | 20 (Blob) + 48 (RGBA cache) + 20 (chunk) + 4 (index) + 16 (canvas) + Path2D ≈ **110–150 MB** | idle worker, after recycle: ≈ 40 MiB | ≈ 0.15–0.2 GB |
| The same, while re-tracing at 12 MP colour, with history holding the previous trace | above + 48 (job RGBA) + 20 (history chunk) | 538 MiB WASM + 48 MB input | **≈ 0.75–0.8 GB** |
| 1M-anchor halftone layer plus an export in flight | 20 + 48 + 45 (chunk) + 10 (index) + 16 + Path2D | 45 (job copy) + 37 (SVG) + WASM (~430 MiB P0 halftone) | **≈ 0.7–0.8 GB** |
| 23.5 MP colour trace (engineering stress) | ≈ 0.25 GB | 972 MiB WASM + 94 MB input | **≈ 1.3 GB** |

## 2. Are the RFC budgets realistic?
- **History 128 MiB / 64 MiB constrained.** Realistic once geometry is chunked (amendment A1). A retrace of a 1M-anchor layer retains ≈ 45–52 MB, so 64 MiB holds about one large retrace; that limit must be visible to the user. Transforms and recolours cost kilobytes.
- **"Lower-end 512 MiB worker / ~2 GiB tab".** The 512 MiB worker figure is **inconsistent with 12 MP colour**, which needs 538 MiB of WASM [P0-R]. The RFC's constrained colour cap of 8 MP is the right lever: WASM scales roughly with pixels, so about 360 MiB is extrapolated. The extrapolation is not measured. On a constrained device the worker recycle threshold must be ≤ 512 MiB, and a colour job must be refused **before** it starts when its estimate exceeds that (§3).
- **1M-anchor product cap.** Feasible for storage and transport: ≈ 50 MB packet, 8–20 ms validation, 0–10 ms delivery. Display is governed by the renderer budget ([RENDERER-EVALUATION](RENDERER-EVALUATION.md)).
- **Missing from the RFC.** A **memory ledger**: a main-thread accounting of every component above, with worker-reported `memoryBytes`, and reserve-before-allocate for jobs, estimated from mode × megapixels with the P0 table as the first calibration. Without it, "reserve aggregate … before allocation" (RFC §13) is unimplementable.

## 3. Proposed resource policy (amends RFC §13)
1. **Profiles.** `reference` and `constrained`. The profile is chosen from `navigator.deviceMemory` where available (Chromium only), or by the user. **Never** infer a device as more capable than declared.
   - Constrained: colour/limited ≤ 8 MP, worker recycle ≤ 512 MiB, history ≤ 64 MiB.
   - These caps are **not product targets** until measured on a real device.
2. **Ledger.** Sum the components in §1; refuse or ask before any job whose estimate would exceed the profile budget. Errors are typed and actionable (reduce resolution, release history, close sources), with no silent downsampling.
3. **Evict in a fixed order.** Render caches, then the decoded RGBA cache, then the worker (recycle), then history (oldest first, visible). Never committed geometry or the source of a source-dependent document.
4. **Estimates.** Use the R03 §4 forecast (preview scale law) and the post-segmentation estimate for anchors. Use per-mode pixel scaling from the P0 table for WASM memory, recalibrated in G-ENG.

## 4. Performance budget review (§13)
| RFC-002 §13 proposal (reference machine) | Evidence in this review | Reviewer position |
|---|---|---|
| B&W import→visible ≤ 0.5 s at ~1 MP; ≤ 2.5 s at native 24 MP | P0-R: 363 ms at 1.2 MP (200 ms of it debounce); native 24 MP B&W trace 1.3–1.9 s [P0-R]. R03: native 24 MP B&W trace 1.26 s under load | **Keep.** Achievable; drop the import debounce (G-TRACE) |
| Colour/limited final ≤ 8 s native 12 MP; over-budget reported within 2 s where feasible | Colour 12 MP: 7.4–10.0 s native under load (R03 runs); P0-R WASM 6.4 s. Over-budget detection within 2 s is only possible as a forecast (R03 §4) | **Keep the 8 s target, unchanged.** Reword the 2 s clause as "forecast within 2 s; guaranteed early failure before fitting" (owner decision) |
| Processing responsiveness: no attributable gap > 50 ms; cancel ack ≤ 200 ms | Cancel ack 0–1 ms (R03). Gaps during *processing* are fine (P0-R worst 19 ms). Gaps when *receiving* results come from parsing and path construction (R01: 61–155 ms at 250k, 203–768 ms at 1M) | **Keep.** It forces time-sliced or off-thread renderer preparation (R02) |
| Interaction p95 ≤ 33 ms (16.7 aspirational); preview ≤ 100 ms at ≤ 250k | See R02 tables | <!-- budget-interaction --> |
| Hit test p95 ≤ 8 ms at 250k; ≤ 16 ms stress | Warm per-query p95 well below 0.01 ms with the grid and subpath index, including the 977k-anchor single path; cold first query on a large path ≤ ~55 ms (lazy flattening) [R02] | **Keep and tighten the definition:** state warm vs cold. Pre-flatten large paths during the idle build to remove the cold outlier |
| Large scenes: 250k interactive target, 500k/1M stress | R02 | <!-- budget-large --> |
| History 100 tx / 128 MiB | §2 | Keep, with chunked geometry |
| Lower-end device: M1 8 GB or 4c/8t 2020–21 laptop | NOT RUN | **Owner action:** obtain or borrow one before G-R1 sign-off; until then disclose "tested on reference hardware only" |

No existing target is lowered by this review. Where evidence shows a target unmet, the proposal is an owner decision ([FINAL-REPORT](FINAL-REPORT.md) unresolved decisions), not a silent change.
