# Reproducing the RFC-002 review experiments

All experiments are disposable and local. None changes production code or the root lockfiles, and none needs network access beyond the existing root `pnpm install`; the R05-A harness is the one exception and has its own lockfile. Run from the repository root at the review branch head.

## Prerequisites
- Node 24.22.1, pnpm 12.23.0, Rust 1.96.0 (pinned toolchain).
- `pnpm install` at the root, giving `@playwright/test` 1.65.1 and its browsers. Then `pnpm run wasm` to build `packages/vector-engine-wasm/pkg`.
- Workloads, which are gitignored and regenerable:
  ```bash
  node scripts/fetch-native-corpus.mjs
  ```
  ```bash
  cargo run --release -p vector-engine --example regression_corpus -- tests/output/regression-a4cf172 tests/output/regression-inputs/*.png
  ```
  Verify the scene hashes against `docs/research/p0-r-geo/artifacts/regression/a4cf172.sha256`. The precision scenes in `tests/output/native/` come from the `export_samples` example.
  ```bash
  node experiments/rfc-002-review/bench/gen-scenes.mjs
  ```
  This writes synthetic scenes plus `MANIFEST.json`; every scene is validated by the engine.

## Bench server (exact production `_headers` CSP)
```bash
node experiments/rfc-002-review/bench/server.mjs 4199
```

## R01 — transport
```bash
node experiments/rfc-002-review/bench/transport-node.mjs > docs/research/rfc-002-review/artifacts/transport/node-transport.json
```
```bash
node experiments/rfc-002-review/bench/run-transport.mjs chromium,firefox,webkit > docs/research/rfc-002-review/artifacts/transport/browser-transport.json
```
```bash
node experiments/rfc-002-review/bench/adversarial.mjs > docs/research/rfc-002-review/artifacts/transport/adversarial.json
```
`transport-node.mjs --encode kind:name …` writes the packets used by the renderer harness into `tests/output/rfc-002-review/packets/`.

## R02 — renderers
```bash
node experiments/rfc-002-review/bench/run-probe.mjs
```
```bash
node experiments/rfc-002-review/bench/run-path2d-scaling.mjs > docs/research/rfc-002-review/artifacts/renderer/path2d-scaling.json
```
```bash
OUT=docs/research/rfc-002-review/artifacts/renderer/correctness-runs.json node experiments/rfc-002-review/bench/run-render.mjs correctness chromium,firefox,webkit canvas,svgdom,svgimg,webgl synth:synthetic-correctness@1,synth:synthetic-correctness@2,native:logo_transparent_hole-color-precision@4,native:nested_rings-color-precision@4,native:antialiased_discs-color-precision@4,native:transparent_ring-color-precision@4
```
```bash
node experiments/rfc-002-review/bench/compare-renders.mjs > docs/research/rfc-002-review/artifacts/renderer/correctness-compare.json
```
`compare-renders.mjs` needs `target/release/examples/render_compare` (`cargo build --release -p vector-engine --examples`).

The full timing chain (transport, Chromium full matrix, Firefox/WebKit reduced matrix, persistence), recording load before each step:
```bash
sh experiments/rfc-002-review/bench/run-all-timing.sh
```
Then:
```bash
node experiments/rfc-002-review/bench/run-rastercheck.mjs > docs/research/rfc-002-review/artifacts/renderer/rastercheck.json
```
```bash
node experiments/rfc-002-review/bench/run-framecheck.mjs canvas,svgdom,webgl real:portrait-large-color,synth:synthetic-many-1m > docs/research/rfc-002-review/artifacts/renderer/framecheck.json
```
```bash
python3 experiments/rfc-002-review/bench/summarize.py docs/research/rfc-002-review/artifacts renderer
```

## R03 — lifecycle and estimation
```bash
node experiments/rfc-002-review/bench/run-lifecycle.mjs chromium,firefox,webkit > docs/research/rfc-002-review/artifacts/lifecycle/lifecycle-v2-run1.json
```
The rejected v1 scheduler is kept as `scheduler-v1-rejected.mjs`. To reproduce the WebKit failure, copy it over `scheduler.mjs` temporarily.

```bash
cd experiments/rfc-002-review/estimator && cargo build --release --locked && cd ../../..
```
```bash
./experiments/rfc-002-review/estimator/target/release/rfc002-estimator tests/output/regression-inputs/*.png > docs/research/rfc-002-review/artifacts/estimator/runs.jsonl
```
```bash
./experiments/rfc-002-review/estimator/target/release/rfc002-estimator --pre tests/output/regression-inputs/*.png > docs/research/rfc-002-review/artifacts/estimator/pre-features.jsonl
```
```bash
python3 experiments/rfc-002-review/estimator/analyze.py docs/research/rfc-002-review/artifacts/estimator
```

## R04 — shared boundaries
See [SHARED-BOUNDARY-STRATEGY §Reproduce](SHARED-BOUNDARY-STRATEGY.md):
```bash
cd experiments/rfc-002-review/shared-boundary && cargo run --release --locked
```

## R05-A — design system
```bash
cd experiments/rfc-002-review/design-system-harness && DO_NOT_TRACK=1 pnpm install --frozen-lockfile && pnpm run build && pnpm test && pnpm run report
```

## R05-B — persistence primitives
```bash
node experiments/rfc-002-review/bench/run-persist.mjs > docs/research/rfc-002-review/artifacts/persistence/compression.json
```
