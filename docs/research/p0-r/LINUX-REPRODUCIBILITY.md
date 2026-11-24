# P0-R-G0: Linux build reproducibility

**Gate status: PASS for linux/arm64** (Ubuntu 24.04 container, clean clone, full suite including Chromium, Firefox and WebKit). **linux/amd64: NOT RUN.** Under Docker Desktop's QEMU emulation on Apple Silicon, `rustc -vV` itself segfaults during the image build, so no amd64 result exists. The same script supports `--platform linux/amd64` on an amd64 host.

## Environment
| Item | Value |
|---|---|
| Host | Apple M5 Max, macOS 26.6.2, Docker Desktop 29.4.2 (linuxkit 6.12.76, 18 CPUs, 15.6 GiB to the VM) |
| Base image | `mcr.microsoft.com/playwright:v1.65.1-noble@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579`, multi-arch manifest digest. Ubuntu 24.04.5 LTS; browsers chromium-1255, firefox-1572, webkit-2388, the same revisions as the macOS runs |
| Toolchain installed in the image | Node 24.22.1 from the official tarball (SHA-256 checked) · pnpm 12.23.0 · rustup → Rust 1.96.0 (ac68faa20 2026-05-25) + `wasm32-unknown-unknown` · `wasm-bindgen-cli` 0.2.130 (`cargo install --locked`) |
| Files | `docker/linux-verify/Dockerfile`, `docker/linux-verify/verify.sh`, `scripts/linux-verify.sh` |

The image build took about 45 s with cached apt and network: apt 7.2 s, Node 3.3 s, Rust + wasm-bindgen 33.3 s. This excludes the one-time base image pull.

## Procedure
`scripts/linux-verify.sh [--platform linux/arm64|linux/amd64] [--skip-browsers] [ref]`:
1. Builds the pinned image.
2. Mounts the repository read-only.
3. Inside the container, clones the committed `ref` (default `HEAD`) into a fresh directory, so uncommitted changes cannot leak in.
4. Runs every step, recording timings, versions and hashes to `tests/output/linux-<arch>/`.

No GitHub Actions minutes are used.

## Results (final run, commit `01833ab`; later commits change only docs and evidence)
| Step | Result | Time |
|---|---|---|
| clean clone | PASS | 0.0 s |
| `pnpm install --frozen-lockfile` (CI=1) | PASS | 2.8 s |
| WASM build (`scripts/build-wasm.mjs`) | PASS | 5.8 s |
| `vp check` (format, lint, types) | PASS | 1.2 s |
| `vp test` (14 TS tests) | PASS | 0.2 s |
| `cargo fmt --check` | PASS | 0.0 s |
| `cargo clippy -D warnings` | PASS | 3.1 s |
| `cargo test --workspace` (26 tests) | PASS | 9.7 s |
| fixture manifest check | PASS | 0.0 s |
| production build (WASM + vp build + notices + sw + dist check) | PASS | 0.4 s |
| browser tests (smoke, CSP, privacy, offline-recovery × Chromium/Firefox/WebKit) | PASS, 21/21 | 41.3 s |
| WASM output fingerprint | PASS | 0.5 s |

Raw evidence: `artifacts/linux-arm64/` (environment, summary, browser test list, hashes, fingerprint).

**Defects found by the Linux runs, all fixed:**
1. pnpm 12 fails CI-mode installs on an unapproved build script (`core-js`, an optional dependency of the evaluation-only jsPDF). It is now explicitly denied in `pnpm-workspace.yaml` (`allowBuilds: core-js: false`).
2. Browser-test races on slower Linux WebKit: a cancel could hit a short re-trace of the previous image. The status element now exposes the source revision being processed, and the tests wait for it.
3. A clippy `doc_lazy_continuation` lint in a new example. This was not Linux-specific; it was missed locally.

## macOS vs Linux artefacts
| Artefact | macOS (aarch64-apple-darwin host) | Linux (aarch64-unknown-linux-gnu host) |
|---|---|---|
| `vector_engine_wasm.js` / `.d.ts` | identical | identical |
| `vector_engine_wasm_bg.wasm` | `40b43967…` (484,497 B) | `bc312b6c…` (482,894 B) |
| Engine **output** on 13 fixtures × 5 modes (SVG, PDF, scene hashes; `scripts/wasm-fingerprint.mjs`) | digest `68723671…` | **identical**: 0 of 65 cases differ |

**Why the WASM bytes differ.**
- Rust symbol hashes differ (`_ZN…17h<hash>E`). Cargo's per-crate metadata hash includes the host toolchain triple.
- The difference also changes code layout: after removing the name and producers sections the binaries still differ, 422,470 B vs 421,467 B.
- Both hosts use the same rustc commit `ac68faa20` and LLVM 22.1.2.
- Within one host the build is byte-reproducible: identical across different checkout paths on macOS (P0) and across clean clones on Linux (three runs).

**Assessment.**
- The specifications require reproducible WASM artefacts and deterministic output. They do not require identical binaries across hosts.
- Cross-host output equivalence is proven by the fingerprint.
- Byte-identical cross-host WASM would need stabilising cargo metadata (unstable options) and is **not proposed**.
- Recommendation: designate the Linux container as the canonical release builder, so published hashes come from one environment.

## Reproduction
```text
open -a Docker                      # start Docker Desktop (or any Docker engine)
scripts/linux-verify.sh             # native architecture of the Docker engine
scripts/linux-verify.sh --platform linux/amd64 --skip-browsers   # on an amd64 host
```
