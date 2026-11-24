# P0-R-GEO Stage F: performance regression

**Result: PASS for the approved configuration** (no change beyond measurement noise). The new precision mode costs **1.0–2.4× the time** of the corresponding default mode on photographs, with **equal peak heap**. On geometric artwork its cost is +4 %. It is opt-in.

## Method
- `crates/vector-engine/examples/geo_perf.rs`: native release, single thread, median of 3 runs (1 run for the 12.5 MP photo).
- Peak heap is measured with a counting global allocator during `vectorize`.
- **Baseline.** The same tool built from clean `7cdde36` in a separate worktree.
- **Current.** `a4cf172` engine code.
- Apple M5 Max, macOS 26.6.2. Each measurement ran alone; an earlier measurement that overlapped a regression job was discarded.
- Raw tables: `artifacts/performance/{baseline-7cdde36,current}-{small,native}.md`.

## Approved default modes, before vs after
| Image | Mode | 7cdde36 ms | a4cf172 ms | Peak heap MiB |
|---|---|---|---|---|
| Talbot 640×526 | B&W / colour / limited / Old Print | 24 / 341 / 249 / 5 | 24 / 330 / 252 / 4 | 5 / 50 / 27 / 4 |
| Hokusai 640×430 | B&W / colour / limited / Old Print | 15 / 506 / 233 / 4 | 16 / 484 / 229 / 4 | 4 / 49 / 26 / 3 |
| Concert 1280×960 | B&W / colour / limited / Old Print | 80 / 1030 / 825 / 15 | 78 / 1028 / 853 / 15 | 30 / 106 / 69 / 11 |
| Street 4080×3060 (12.5 MP) | B&W / colour / limited / Old Print | 897 / 11769 / 7051 / 156 | 878 / 10742 / 6277 / 148 | 160 / 512 / 466 / 145 |

The differences (−11 % to +3 %) are run-to-run variation. The default code path is unchanged: the same VTracer calls, plus one `Option` check. Output is byte-identical (PHOTOGRAPHIC-REGRESSION).

## Precision mode (opt-in)
| Image | B&W precision | Colour precision | Limited precision (stacked) | Peak heap |
|---|---|---|---|---|
| Talbot | 47 ms (1.9× B&W) | 497 ms (1.5×) | 591 ms (2.3× limited, mosaic) | equal |
| Hokusai | 32 ms (2.0×) | 803 ms (1.7×) | 561 ms (2.4×) | equal |
| Concert 1280 | 94 ms (1.2×) | 1526 ms (1.5×) | 1926 ms (2.3×) | equal |
| Street 12.5 MP | 2108 ms (2.4×) | 11338 ms (1.06×) | 11939 ms (1.9×) | equal (160 / 512 / 466 MiB) |

| Geometry corpus (32 fixtures, 64–512 px) | Spline | Precision |
|---|---|---|
| Total time (median per fixture, summed) | 120 ms | 125 ms (+4 %) |
| Peak heap (max / median per fixture) | 4.7 / 1.1 MiB | 4.7 / 1.1 MiB |

Notes:
- **Anchor counts.** Precision on photographs produces 1.4–2× the anchors of spline (e.g. 389,717 → 595,810 on the 12.5 MP street photo). The existing anchor budget (1 M) applies and fails with the typed `too_many_primitives` error, as for spline.
- **Pathological cases.** None found. Work is linear in the total layer boundary length, plus one label map (4 B/px) and one layer mask at a time.
- **Limited colour.** Precision requires stacked compositing, while limited colour defaults to mosaic, so its comparison is against a different compositor.
- **Browser timings.** These are native measurements; browser (WASM) timings were not re-measured in this phase. The precision code path adds no browser-specific work. Lower-end hardware is still not measured (P0-R open item).
