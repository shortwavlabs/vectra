# G-PRJ-0 evidence records

Apple M5 Max, 128 GiB, macOS 26.6.2, Node 24.22.1. The machine is shared and never quiet. No `ngspice` ran in any of these runs. Load averages and top processes are inside each JSON file.

| Record | Commit | Load at start | What |
|---|---|---|---|
| `qualify-bd2fd8b.json` | `bd2fd8b` (final code) | 5.1 | Large-project round trips, v1 → v2 migration, exact 64 MiB boundary, real section-count and budget refusals, memory peaks. **The correctness record** |
| `qualify-f7db368.json` | `f7db368` | 1.7 | The same script before the review fixes (no measured path changed). The quieter timing reference |
| `persistability-corpus-bd2fd8b.json` | `bd2fd8b` | 8.7 | 120,000 differential transactions, 12 seeds, three validation modes. "Tracked changes" was the report text being edited; no source changed |
| `dispatch-main-2341123.json`, `dispatch-gprj0-bd2fd8b.json` | `2341123`, `bd2fd8b` | 1.7, 7.0 | G-DOC-R integrated dispatch harness, 12 types × 2 sizes, 30 reps; G-PRJ-0 adds the accounting time per dispatch |
| `open-gdoc-bench-main-2341123.json`, `open-gdoc-bench-gprj0-3ad9f6a.json` | `2341123`, `3ad9f6a` | 1.6, 1.4 | The P1-A open benchmark (`docs/research/g-doc/bench/bench.mjs`), for TD-PERF-009 |
| `calibration-main-2341123.json`, `calibration-gprj0-c7230c8.json` | `2341123`, `c7230c8` | 2.0, 1.7 | AM-2 calibration: accounted vs measured retained structure |
| `chunk-overhead-main-2341123.json`, `chunk-overhead-gprj0-175c325.json` | `2341123`, `175c325` | 4.5, 2.9 | Per-chunk store record overhead |
| `frozen-regressions-c7230c8.log` | `c7230c8` | 1.7 | Engine corpus 294/294, bundle v2 72/72, document export 576/576 (every `concert-*` excluded). Re-run on `bd2fd8b`: document export 576/576 and bundle v1 15/15 (build `58a2a35ce046ea1a`). No Rust source changed on this branch |

Local, not committed (`tests/output/g-prj-0/`): written containers, logs, probe runs, the bundle v1 output and the frozen corpus output.
