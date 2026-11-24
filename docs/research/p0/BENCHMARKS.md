# P0 benchmarks

Status: **measured** on one machine. These numbers are not a support claim. Thresholds from VALIDATION.md are treated as proposals; see "Threshold assessment".

## Setup
- **Machine:** Apple M5 Max (arm64), 128 GiB RAM, macOS 26.6.2. On AC power; no other heavy load.
- **Browsers:** Playwright 1.65.1 builds: Chrome Headless Shell 159.0.8154.6, Firefox 159.0, WebKit 27.2. User-agent strings in the raw data are Playwright device-descriptor emulations; the engines ran natively on macOS arm64. **This is not Safari, iOS or mobile data.**
- **Build:** production (`pnpm run build`), served by `vp preview` with the production `_headers`. The engine (Rust and WASM) is unchanged since commit `b5304e4`. The app build also includes the worker warm-up added in the G5 commit.
- **Harness:** `tests/browser/benchmark.spec.ts`, opt-in with `BENCH=1`. Input runs through the real UI path:
  1. A JPEG (quality 0.9) is generated in the page by scaling the CC0 Talbot photograph to 1, 4, 12 or 24 MP at a 640:526 aspect ratio.
  2. It is fed to the file input.
  3. Decode on the main thread → transfer → worker → WASM vectorize + SVG → result.
  4. Then a PDF export at 200 mm width.
- **Runs:** 3 runs per cell at 1 and 4 MP (median reported); 1 run at 12 and 24 MP.
- **Settings:** defaults (`src/presets/defaults.ts`). Halftone pitch is scaled to 8·√MP px so the dot count stays roughly constant, as when printing a larger source at the same physical size.
- **Caveat:** the source is an *upscaled* 640 px photograph. It is smoother than a native 24 MP photograph, so path and anchor counts and timings at 12 and 24 MP are **optimistic** for real high-detail photographs. Re-run with owner-supplied licensed high-resolution photographs before ratifying limits.
- **Raw data:** `artifacts/bench/{chromium,firefox,webkit}.jsonl`.

## Results
"wasm ms" is the time inside the worker's `vectorize` call: preprocess, segment, colour fit, curve fitting and compose, optimize, scene build and validation, plus SVG serialisation. Decode covers signature sniffing, `createImageBitmap` and `getImageData` on the main thread. PDF is the worker's `sceneToPdf` time. Frame gap is the largest `requestAnimationFrame` interval on the main thread while the job was in flight. WASM memory is the worker instance's linear-memory size after the job. It is a **cumulative high-water mark** for that worker, because memory never shrinks. Later cells inherit earlier peaks; for example, 24 MP halftone shows 913 MiB from the preceding limited-colour job.

| MP | Mode | Chromium wasm ms | Firefox wasm ms | WebKit wasm ms | Decode ms (C/F/W) | SVG ms (C) | PDF ms (C) | Paths (C) | Anchors (C) | SVG bytes (C) | PDF bytes (C) | Worker WASM memory high-water MiB (C/F/W) | Max frame gap ms (C/F/W) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | bw | 103 (n=3) | 83 | 51 | 4/4/11 | 3 | 20 | 37 | 5810 | 198,657 | 77,472 | 25/25/25 | 16.7/16.7/18.0 |
| 1 | color | 558 (n=3) | 518 | 412 | 4/5/8 | 35 | 131 | 3589 | 56322 | 2,065,090 | 754,425 | 60/60/60 | 16.8/17.6/18.0 |
| 1 | limited | 363 (n=3) | 459 | 376 | 4/4/8 | 43 | 148 | 2629 | 69935 | 2,329,275 | 807,348 | 60/60/60 | 16.8/17.6/18.0 |
| 1 | halftone | 75 (n=3) | 73 | 64 | 4/4/8 | 40 | 145 | 1 | 79295 | 2,827,067 | 831,414 | 60/60/60 | 16.8/16.7/18.0 |
| 4 | bw | 306 (n=3) | 215 | 193 | 14/11/19 | 8 | 44 | 145 | 12895 | 491,028 | 181,053 | 92/92/92 | 16.8/17.4/17.0 |
| 4 | color | 1502 (n=3) | 1227 | 1176 | 14/11/20 | 66 | 223 | 6922 | 105864 | 4,264,141 | 1,522,993 | 161/161/161 | 16.8/17.6/52.0 |
| 4 | limited | 1282 (n=3) | 1242 | 1065 | 13/11/20 | 133 | 441 | 6506 | 211116 | 7,879,256 | 2,733,666 | 161/161/161 | 16.8/17.7/18.0 |
| 4 | halftone | 95 (n=3) | 97 | 72 | 13/11/19 | 35 | 147 | 1 | 79295 | 3,033,667 | 889,299 | 161/161/161 | 16.8/17.3/18.0 |
| 12 | bw | 850 (n=1) | 591 | 521 | 33/30/54 | 13 | 53 | 266 | 21445 | 871,108 | 315,891 | 353/353/353 | 16.8/17.6/18.0 |
| 12 | color | 2200 (n=1) | 2480 | 2038 | 35/29/54 | 92 | 324 | 10083 | 148794 | 6,253,406 | 2,213,828 | 445/445/445 | 16.8/17.6/18.0 |
| 12 | limited | 2758 (n=1) | 3052 | 2366 | 36/28/50 | 219 | 759 | 8891 | 349602 | 13,816,074 | 4,831,857 | 445/510/445 | 16.8/17.6/18.0 |
| 12 | halftone | 142 (n=1) | 139 | 150 | 34/33/49 | 31 | 136 | 1 | 78485 | 3,102,172 | 915,980 | 445/510/445 | 16.7/16.7/17.0 |
| 24 | bw | 1648 (n=1) | 1124 | 1035 | 62/53/88 | 16 | 72 | 331 | 28081 | 1,172,292 | 429,375 | 702/518/702 | 16.8/17.6/18.0 |
| 24 | color | 3341 (n=1) | 2777 | 2419 | 64/57/83 | 99 | 359 | 10893 | 161690 | 6,956,305 | 2,464,128 | 702/610/702 | 16.8/17.6/18.0 |
| 24 | limited | 5947 (n=1) | 5902 | 4969 | 68/53/84 | 348 | 1232 | 11892 | 554555 | 22,414,648 | 7,893,356 | 913/836/894 | 16.8/17.7/19.0 |
| 24 | halftone | 208 (n=1) | 206 | 244 | 64/57/83 | 33 | 131 | 1 | 80275 | 3,208,568 | 956,834 | 913/836/894 | 16.7/16.7/18.0 |


Engine stage breakdown (Chromium, median ms): 
| MP | Mode | preprocess | segment | colorFit | compose (fit) | optimize | scene | validate |
|---|---|---|---|---|---|---|---|---|
| 1 | bw | 32 | 20 | 0 | 45 | 0 | 0 | 0 |
| 1 | color | 9 | 237 | 0 | 261 | 1 | 2 | 1 |
| 1 | limited | 42 | 178 | 3 | 81 | 1 | 1 | 0 |
| 1 | halftone | 0 | 21 | 0 | 0 | 0 | 0 | 0 |
| 4 | bw | 82 | 58 | 0 | 154 | 0 | 0 | 0 |
| 4 | color | 28 | 625 | 0 | 756 | 2 | 6 | 1 |
| 4 | limited | 64 | 652 | 11 | 377 | 4 | 2 | 1 |
| 4 | halftone | 0 | 46 | 0 | 0 | 0 | 0 | 0 |
| 12 | bw | 201 | 181 | 0 | 449 | 0 | 0 | 0 |
| 12 | color | 51 | 1094 | 0 | 914 | 3 | 12 | 2 |
| 12 | limited | 111 | 1328 | 16 | 1006 | 6 | 4 | 2 |
| 12 | halftone | 0 | 96 | 0 | 0 | 0 | 0 | 0 |
| 24 | bw | 379 | 351 | 0 | 890 | 0 | 0 | 0 |
| 24 | color | 109 | 1534 | 0 | 1541 | 3 | 14 | 2 |
| 24 | limited | 178 | 2780 | 37 | 2483 | 10 | 6 | 2 |
| 24 | halftone | 0 | 160 | 0 | 0 | 0 | 0 | 0 |

WASM worker initialisation (`init()` in a fresh worker; excludes worker script fetch): Chromium 2.6 ms, Firefox 5.0 ms, WebKit 8.0 ms.

Cancellation (G2): acknowledgement in code ≤ 0.3 ms; click → visible "Cancelled" 22 / 53 / 29 ms (Chromium / Firefox / WebKit).

Long Tasks API (Chromium only): **0** long tasks during processing in every run. Firefox and WebKit do not expose it; the rAF gap is the cross-browser proxy.

## Observations
- **Main thread.** It stayed responsive: the largest frame gap was one frame (16.7–19 ms) in every run except one WebKit 4 MP colour run (52 ms, a single frame drop). Post-result SVG preview painting is *not* covered by this probe (see G2).
- **Memory.** WASM linear memory grows with image size and never shrinks: about 25 MiB at 1 MP bw, 445 MiB at 12 MP colour, and up to **913 MiB** at 24 MP limited colour (Chromium). After 24 MP limited colour the worker sits close to the 1 GiB recycle threshold. JS heap (Chromium) is reported in the raw data.
- **Output size scales with detail, not pixels.** For example, 24 MP limited colour produces 554k anchors, 22.4 MB of SVG and 7.9 MB of PDF (compressed). The compound-path halftone holds about 80k anchors, roughly 3 MB of SVG and 0.9 MB of PDF, regardless of source size, because the pitch is scaled.
- **Where the time goes.** Segmentation (visioncortex clustering) and compose/fitting dominate colour modes. Halftone synthesis is cheap. PDF writing is about a third of the SVG size in time and bytes.
- **Engines.** All three are within roughly 1.5× of each other. WebKit was fastest for most cells on this machine; Chromium was slowest for bw at 24 MP.

## Threshold assessment (VALIDATION.md proposals)
The proposals are p95 targets. P0 has only 3 runs per cell at 1 and 4 MP, and 1 run at 12 and 24 MP, so the medians and single runs below are **not** p95 estimates.

| Proposal | Measured (worst engine, this machine; median of 3 or single run) | Assessment |
|---|---|---|
| 1 MP preview ≤ 2 s p95 | ≤ 0.56 s (colour, median of 3) | Met with margin. Keep. |
| 4 MP final ≤ 10 s p95 | ≤ 1.5 s | Met. Consider ≤ 5 s on reference desktop, but re-measure with native-detail photographs first. |
| No trace-induced main-thread long tasks > 50 ms | 0 long tasks (Chromium); one 52 ms rAF gap (WebKit) | Met for processing. Add a probe for result rendering in P1. |
| Cancellation acknowledgement ≤ 200 ms | ≤ 53 ms | Met. |
| Input cap 12 MP desktop | 24 MP works but needs about 0.9 GiB WASM memory in limited colour | Keep 12 MP default plus explicit override. Mobile caps need device testing (NOT RUN). |
| 100k primitive cap | 24 MP limited colour reaches 554k anchors and 22 MB SVG | Current engine default `maxAnchors` is 1M. Recommend a UI warning above 100k and a hard default of about 500k. |

Not measured (NOT RUN): mobile Safari or iOS, real Safari, Windows and Linux hosts, low-memory devices, cold network loads.
