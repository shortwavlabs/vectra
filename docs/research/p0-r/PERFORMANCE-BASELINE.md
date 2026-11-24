# P0-R-G5: Performance and resource baseline

**Gate status: PARTIAL.**
- Measured on genuine native-resolution photographs in three engines, with clear findings and a proposed P1 budget.
- Lower-end hardware, real Safari and mobile were not measured.
- Two proposed targets are not met by the current workbench: preview paint main-thread blocking, and the anchor budget on detailed photos.

Privacy (also G5): see OFFLINE-WORKER-RECOVERY and the P0 privacy report. 0 network requests during sessions, re-verified in P0-R in macOS and Linux runs.

## Setup
- **Reference machine:** Apple M5 Max, 128 GiB RAM, macOS 26.6.2. Playwright 1.65.1 Chromium 159.0.8154.6 (headless shell), Firefox 159.0, WebKit 27.2. Production build served by `vp preview` with production headers.
- **Corpus** (`tests/fixtures/native-corpus.json`, downloaded on demand; CC0 or public domain; camera-native resolution verified from EXIF):

| Id | Size | Camera | Content |
|---|---|---|---|
| portrait-face | 5184×3456 (17.9 MP) | Canon T5i | detailed portrait |
| concert-small-venue | 4032×3024 (12.2 MP) | iPhone 15 | small-venue band, native 12 MP |
| concert-stage-light | 4928×3264 (16.1 MP) | Nikon D7000 | crowded stage lighting |
| texture-bark | 6000×4000 (24.0 MP) | Canon R100 | detailed natural texture, native 24 MP |
| architecture-street | 4080×3060 (12.5 MP) | Xiaomi | urban architecture |
| portrait-large | 4332×5415 (23.5 MP) | Nikon D850 crop | studio portrait |

  Plus one derived image, `concert-small-venue` downscaled to 1280×960. It is labelled derived and exists only to compare with the maintainer's 1280×720 observation.
- **Harness:** `tests/browser/native-benchmark.spec.ts` (`BENCH_NATIVE=1`).
  - Default settings per mode; pixel limit set to 25 MP.
  - Cold = a new page (fresh worker and WASM instance). Warm = the same file imported again on that page.
  - Timings come from the workbench's instrumentation (`performance.now` in page and worker).
- **Raw data:** `artifacts/native-bench/*.jsonl`; tables: `artifacts/native-bench/SUMMARY.md` (`node scripts/summarize-native-bench.mjs`).

## Results (Chromium, cold run; warm in parentheses for the WASM call)
| Image | Mode | Decode | Segment | Fit | WASM call (warm) | SVG ser. | PDF | Preview paint (max frame gap) | Import→visible | Anchors | SVG / PDF | WASM mem |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1280×960 (derived) | B&W | 19 | 25 | 49 | 108 (109) | 2 | 10 | 30 (17) | 363 | 3,734 | 123 KB / 48 KB | 44 MiB |
| concert-small-venue 12 MP | B&W | 170 | 214 | 509 | 1,036 (861) | 12 | 64 | 33 (17) | 1,451 | 17,089 | 656 KB / 238 KB | 357 MiB |
| architecture 12.5 MP | B&W | 52 | 168 | 520 | 1,056 (1,044) | 82 | 316 | 44 (17) | 1,365 | 127,399 | 4.7 MB / 1.5 MB | 242 MiB |
| portrait-face 18 MP | B&W | 96 | 210 | 656 | 1,643 (1,245) | 40 | 195 | 49 (17) | 2,002 | 59,397 | 2.2 MB / 719 KB | 478 MiB |
| bark 24 MP | B&W | 273 | 410 | 978 | 1,893 (1,857) | 91 | 344 | 51 (17) | 2,433 | 139,629 | 5.1 MB / 1.7 MB | 732 MiB |
| concert-small-venue 12 MP | Color | 170 | 3,822 | 1,812 | 6,395 (6,006) | 287 | 1,288 | 175 (133) | 6,966 | 424,222 | 16.9 MB / 5.9 MB | 538 MiB |
| portrait-large 23.5 MP | Color | 123 | 5,195 | 1,913 | 7,709 (7,676) | 296 | 1,049 | 190 (150) | 8,248 | 441,894 | 17.7 MB / 6.0 MB | 972 MiB |
| portrait-face 18 MP | Limited | 100 | 7,499 | 3,357 | 11,717 (9,795) | 459 | 2,046 | 203 (150) | 12,248 | **664,269** | 23.6 MB / 7.4 MB | 910 MiB |
| concert-stage-light 16 MP | Limited | 196 | 9,873 | 1,559 | 12,124 (12,045) | 313 | 1,086 | 135 (100) | 12,677 | 459,239 | 16.3 MB / 5.1 MB | 809 MiB |
| concert-small-venue 12 MP | Halftone | 170 | 147 | — | 686 (673) | 394 | 1,651 | 225 (167) | 1,315 | 956,155 | 36.0 MB / 10.9 MB | 431 MiB |
| architecture 12.5 MP | Halftone | 52 | 156 | — | 708 (690) | 408 | 1,683 | 238 (183) | 1,229 | 977,400 | 36.8 MB / 11.3 MB | 438 MiB |

All times are in ms. Transfer and parse overhead (round trip minus WASM call) was 1–28 ms in every run.

**Explicit budget errors (Chromium):** 8 of 28 runs stopped with `too_many_primitives` (limit 1,000,000 anchors) and a recoverable message ("increase pitch or reduce detail"):
- **Color:** portrait-face 1.15 M; concert-stage-light 1.52 M; bark 3.65 M.
- **Limited:** bark 2.14 M.
- **Halftone at pitch 8:** portrait-face, concert-stage-light, bark and portrait-large, each failing on its first dot over the budget.
- **Architecture limited** 339 k and **portrait-large limited** 396 k completed.

For traced modes the budget is enforced only after the full trace, which wastes several seconds on failing jobs (bark colour). Halftone aborts as soon as the budget is crossed.

**Firefox and WebKit** (subset):

| Image / mode | Firefox WASM call | Firefox preview paint (max frame gap) | WebKit WASM call | WebKit preview paint (max frame gap) |
|---|---|---|---|---|
| 1280×960 B&W | 124 | 29 (17) | 94 | 19 (15) |
| 12 MP B&W | 929 | 68 (33) | 560 | 28 (17) |
| 18 MP B&W | 1,413 | 168 (133) | 927 | 48 (21) |
| 12 MP limited | 6,278 | 307 (90) | 4,054 | 176 (120) |
| 18 MP limited | 11,915 | **1,351 (850)** | 9,277 | 260 (177) |

Anchor counts differ slightly by engine because the browsers' JPEG decoders differ (GEOMETRY-QUALITY-DISPOSITION §5).

**4× CPU-throttled Chromium (lower-end proxy):**
- Main-thread costs scale: 12 MP decode 170 → 645 ms; colour preview paint 175 → 727 ms, with a 667 ms frame gap.
- The **WASM call is unchanged**: 12 MP colour 6,395 → 6,530 ms. Chromium's throttling does not apply to dedicated workers, so it is **not** a proxy for engine speed on slower CPUs.

## Comparison with the maintainer's observation
- **Maintainer** (private 1280×720 concert photo, B&W, their machine): 141.9 ms WASM; 12,366 anchors; 399.4 KiB SVG; 26 MiB memory; zero long tasks.
- **Derived 1280×960 public photo** (Chromium/Firefox/WebKit): 108 / 124 / 94 ms WASM; about 3.7 k anchors; 123 KB SVG; 44 MiB memory; one-frame gaps; no long tasks.
- Same order of magnitude. The maintainer's photo is more detailed (3× the anchors), so this is **not** a reproduction.
- The workbench's import→visible (363 ms) includes a 200 ms settings debounce that an import does not need. That is a P1 fix.

## Findings
1. **B&W scales well.** Native 12–24 MP in 1.0–1.9 s (Chromium), 0.56–0.93 s (WebKit); import→visible ≤ 2.4 s.
2. **Colour and limited colour on genuinely detailed photographs are 5–12 s and 340 k–660 k anchors (12–24 MB SVG), or exceed the 1 M budget.** P0's upscaled corpus understated this badly: 24 MP limited took 5.9 s there vs 12 s and 664 k anchors at 18 MP natively. Clustering (segment) dominates.
3. **Halftone at the default 8 px pitch** is about 1 M anchors at 12 MP (36 MB SVG). Larger images must use a larger pitch. The UI should derive the pitch from the physical print size (P2).
4. **Preview rendering is not the longest step, but it is the worst main-thread blocker.**
   - Chromium paints 12–37 MB SVGs in 125–238 ms with 83–183 ms frame gaps. Firefox: 1.35 s with an 850 ms gap.
   - Processing itself never blocked the main thread: worst gap 19 ms; Chromium Long Tasks 0.
   - For P1, rendering and interaction of 300 k–1 M-anchor scenes, not tracing, will be the dominant UX bottleneck.
5. **Memory.** WASM reaches 0.9–1.0 GiB for colour and limited at 18–24 MP, right at the 1 GiB recycle threshold. B&W at 12 MP uses 357 MiB.
6. **Exports.** SVG serialisation 12–540 ms; PDF 50–2,046 ms. PDF is about 30 % of the SVG size thanks to Flate.
7. **Cold vs warm.** Warm is 0–35 % faster (pre-grown memory); limited colour benefits most.
8. **No regression vs P0.** Re-running the P0 upscaled benchmark at the P0-R head (Chromium): WASM medians are 0.97–1.02× P0 in all 16 cells (`artifacts/regression/p0-benchmark-comparison-chromium.md`).

## Resource limits review
| Limit | Value | Behaviour (evidence) |
|---|---|---|
| Compressed input | 20 MiB | `too_large_file` before decoding (browser test `resource limits…`) |
| Decoded pixels | 12 MP default; 25 / 50 MP explicit engineering overrides; 16,384 px per side; 50 MP hard ceiling | `too_many_pixels` from the header before decoding (browser test); engine `image_too_large`. No silent resize. |
| Anchors (primitives) | 1,000,000 default; 5,000,000 hard | `too_many_primitives` with the remedy text (engine tests; browser test recovers by changing the pitch; 8 native runs above) |
| Worker WASM memory | recycle above 1 GiB | worker replaced after the job (recycling test). Memory never shrinks inside an instance. |
| Output size | no separate byte limit | bounded by anchors (about 25–40 B/anchor SVG, 8–12 B/anchor PDF) |

No limit degrades quality silently, discards geometry or rasterises.

**Proposed for P1:**
- Estimate cost before the expensive stage (cluster count after segmentation) to fail fast.
- Warn at about 250 k anchors.
- Offer explicit "reduce to N MP" and "increase pitch" actions.

## Proposed P1 performance budget (for maintainer approval)
| Area | Proposal | Current (reference machine) |
|---|---|---|
| B&W import→visible | ≤ 0.5 s at ~1 MP; ≤ 2.5 s at native 24 MP | 0.36 s; 2.4 s (meets) |
| Colour and limited | ≤ 8 s at native 12 MP with progress and cancel; budget errors raised within 2 s (early estimate) | 5–7 s; errors only after the full trace (not met) |
| Main thread during processing | no frame gap > 50 ms | ≤ 19 ms (meets) |
| Preview and canvas | no frame gap > 50 ms while displaying or interacting; preview ≤ 100 ms for ≤ 250 k anchors | 83–850 ms gaps for large SVGs (not met; P1 renderer requirement) |
| Interactive scene size | 250 k anchors warning; 1 M hard limit kept for export | — |
| Memory | ≤ 1 GiB WASM per worker on the reference machine; ≤ 512 MiB on the lower-end target, which implies ≤ ~8–12 MP for colour and limited | up to 972 MiB |

## Device support
**Proposed lower-end desktop validation target:**
- A 2020–2021 mainstream laptop: 4 cores / 8 threads (Intel Core i5-1135G7 or AMD Ryzen 5 5500U class) or an Apple M1 with 8 GB RAM, with integrated graphics and a 1080p display.
- Current Chrome, Firefox and Safari or Edge.
- Treat 2 GB per tab as the practical browser budget.
- Engine times there are **estimated, not measured**, at 2–4× the reference machine, based on typical single-thread performance ratios. Measure before ratifying the budget.

| Environment | Status |
|---|---|
| macOS arm64: Chromium 159, Firefox 159, Playwright WebKit 27.2 | Tested (functional + performance) |
| Ubuntu 24.04 arm64 container: same engine builds | Tested (functional); performance not measured |
| Real Safari 26.6.2 (installed), Windows, linux/amd64, lower-end laptops | Untested |
| iOS Safari, Android Chrome | Untested (deferred) |
| Browsers without module workers or `'wasm-unsafe-eval'` (e.g. Safari < 16, Firefox < 114) | Unsupported |
