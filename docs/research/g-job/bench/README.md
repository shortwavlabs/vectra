# G-JOB performance artefacts
`tests/browser/jobs-perf.spec.ts` (headed, production build), one JSON per engine:

```bash
GJOB_PERF=1 GJOB_PERF_LABEL=run-c pnpm exec playwright test tests/browser/jobs-perf.spec.ts --headed
```

Workloads are local files made from the licensed regression inputs (`tests/output/regression-inputs`, not in git) with macOS `sips-316`:

| Workload | Command | SHA-256 | Mode | Anchors |
|---|---|---|---|---|
| `bark-1224.png` (interactive target) | `sips --resampleWidth 1224 texture-bark.png` | `a4629ed39b6f1d675f68c156f52cc13d59caa3b1015e8b376a99ee8c79d770f5` | colour defaults | 269,996 |
| `bark-2350.png` (stress) | `sips --resampleWidth 2350 texture-bark.png` | `daa939de69169ce5b6fb9ab32dfa9e305452154640bfed47a73ae928d6d4ec72` | colour defaults | 812,003 |
| `portrait-large-q90.jpg` (23.5 MP source) | `sips -s format jpeg -s formatOptions 90 portrait-large.png` | `952dbf0fcbffd41921d18430b7c8ca529d1f217f0cffce371c1895bc4bd14616` | B&W defaults | 33,182 (WebKit 33,360) |

| Run | Code | Time (CST) | Machine conditions | Files |
|---|---|---|---|---|
| B | `ea48078` + instrumentation | 09:50–09:53 | no `ngspice`; two unrelated CPU-bound processes; load average 2.4 → 12.4 | `run-b/` |
| C | `e5b1814` (final) | 10:10–10:16 | no `ngspice`; five unrelated CPU-bound processes (another project); load average 8.7 → 10.7 | `run-c/` |

Neither run is quiet. Run C's first Chromium attempt failed with "execution context was destroyed" (a navigation-like event) during a final trace; a rerun with navigation, crash and page-error logging passed with no event recorded. The cause was not found. An earlier lower-load run (09:46) was overwritten by run B and is not cited.

Each JSON holds the browser, viewport, DPR, load average and `ngspice` count at start and end, the workbench preview (`preview`, including `handling` times), every final trace (`finals`: queue, worker, post and commit times, the store's commit steps, rAF and Long Tasks probes), the export (`snapshotMs`, `postMs`, probe), the cancel acknowledgement, and scheduler diagnostics.
