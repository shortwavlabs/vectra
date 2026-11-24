# P0-G0: Vite+ toolchain and repository foundations

**Gate status: PARTIAL.** The macOS toolchain passes end to end: clean clone, `vp install`, `vp dev`, `vp check`, `vp test`, `vp build`, and a byte-identical WASM build across checkout paths. The ROADMAP exit also requires Linux, and the Linux build was **NOT RUN** (Docker daemon not running, no Linux host).

## Objective
Set up a reproducible React/TypeScript/Rust/WASM workspace that uses the official Vite+ workflow (`vp install`, `vp dev`, `vp check`, `vp test`, `vp build`), with pinned toolchains, committed lockfiles and documented setup.

## Research findings (primary sources)
- **Vite+ 1.7.0** (npm `vite-plus`, MIT; `latest` tag, published 2026-11-17).
  - It ships a global `vp` CLI and a project-local `vp` inside the `vite-plus` package ([guide](https://viteplus.dev/guide/), [local CLI](https://viteplus.dev/guide/local-cli)).
  - The global installer (`curl -fsSL https://vite.plus | bash`) takes over the machine's Node.js and package-manager management. It was **not run** on the maintainer's machine. Everything here uses the project-local CLI, which the docs recommend for collaborators: run it through package scripts or `pnpm exec vp …`.
  - For new projects the docs prescribe `vp create`, so the React template was scaffolded with `npx --package=vite-plus@1.7.0 vp create vite -- app --template react-ts` in a scratch directory and ported into the repo.
  - Exact local toolchain, from `vp toolchain`:
    - `vite-plus@1.7.0` → `@voidzero-dev/vite-plus-core@8.3.8000`, which bundles **Vite 8.3.8**, **Rolldown 1.2.19** and tsdown 0.23.4.
    - Also included: **Vitest 5.1.0**, **Oxlint 1.94.0**, **Oxfmt 0.79.0**, `tsrs 7.1.0-beta.tsrs2` (type-aware lint and type check), and Vite Task (rev `cb1ea8d`).
  - Built-ins: `vp dev`, `vp build`, `vp check` and `vp test` are built-in commands and cannot be overridden. `vp run <script>` runs package scripts. So `vp build` does **not** build WASM, and a separate prerequisite step is required (see "Implementation decisions" below).
  - [CI guide](https://viteplus.dev/guide/ci): `voidzero-dev/setup-vp` must be pinned to an exact release or SHA. The `v1` tag is frozen.
- **wasm-bindgen 0.2.130** (crate and CLI, 2026-10-30, MIT OR Apache-2.0).
  - The CLI version must exactly match the crate version ([changelog](https://github.com/wasm-bindgen/wasm-bindgen/blob/main/CHANGELOG.md)).
  - The project now lives in the `wasm-bindgen` GitHub organisation. The old `rustwasm` organisation was sunset ([Rust blog, 2025-07-21](https://blog.rust-lang.org/inside-rust/2025/07/21/sunsetting-the-rustwasm-github-org/)).
  - Use `--target web` with Vite. `bundler` lists only webpack as fully supported ([deployment docs](https://wasm-bindgen.github.io/wasm-bindgen/reference/deployment.html)).
- **Rust 1.96.0.** Since 1.87, `wasm32-unknown-unknown` enables bulk-memory, nontrapping-fptoint, multivalue, reference-types, sign-ext and mutable-globals by default ([platform docs](https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html)). The implied browser floor is roughly Chrome 96 / Firefox 79 / Safari 15.
- **wasm-pack** is not used. A ~60-line Node script calls `cargo` and `wasm-bindgen` directly, which removes one tool to pin.

## Implementation decisions
| Item | Decision |
|---|---|
| Package manager | pnpm **12.23.0**, selected by `devEngines.packageManager` with `onFail: download` (the scaffold's default). pnpm-workspace catalog pins `vite-plus: 1.7.0` and aliases `vite` to `@voidzero-dev/vite-plus-core@8.3.8000`, as the Vite+ docs require. |
| Node | **24.22.1** via `.node-version` and `devEngines.runtime` |
| Dependency pins | `package.json` uses exact versions only. In Cargo manifests, `=` is used for crates with API-stability risk; the others (serde, serde_json, miniz_oxide, png) are caret requirements, pinned only by the committed `Cargo.lock`. Both `pnpm-lock.yaml` and `Cargo.lock` are committed. Crates with API-stability risk use `=` (vtracer, visioncortex, pdf-writer, wasm-bindgen, resvg). |
| TypeScript | **7.0.2** (scaffold default). `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `erasableSyntaxOnly` and `verbatimModuleSyntax`. Type checking runs inside `vp check` (type-aware Oxlint). |
| Rust | `rust-toolchain.toml` pins **1.96.0** with rustfmt, clippy and the `wasm32-unknown-unknown` target. Workspace edition 2024, resolver 3, release profile `opt-level="s"`, LTO, `codegen-units=1`, `panic="abort"`. |
| WASM build | `scripts/build-wasm.mjs` (`pnpm run wasm`): fails unless the wasm-bindgen CLI version equals the `Cargo.lock` version; runs `cargo build --locked --release --target wasm32-unknown-unknown`; applies `--remap-path-prefix` for checkout and cargo-home paths; runs `wasm-bindgen --target web`; prints SHA-256 values. Output goes to `packages/vector-engine-wasm/pkg/`, which is gitignored because it is reproducible. |
| Build | `pnpm run build` = WASM build → `vp build` → `scripts/check-dist.mjs`, which checks Pages limits, required assets and that no remote origin is referenced. |
| Structure | As proposed. Additions: `scripts/`, `tests/unit/`, `experiments/vtracer-compare/` (a standalone Cargo workspace with its own lockfile, never shipped), `rustfmt.toml`, `playwright.config.ts`. `src/components`, `workspace`, `workers`, `vectorization`, `presets` and `export` all exist and are used. |
| CI | None added. Every check ran locally. A lightweight workflow is suggested in FINAL-REPORT for the maintainer to decide on. |
| Formatter scope | Markdown is excluded from Oxfmt, so the maintainer-authored docs are not rewritten. |

## Commands executed (all on 2026-11-23)
```text
pnpm install                                   # pnpm 12.23.0 selected via devEngines
pnpm run wasm                                  # cargo 1.96.0 + wasm-bindgen 0.2.130
pnpm exec vp check                             # pass: format, lint, type check (20 files)
pnpm exec vp test                              # 14 tests passed (Vitest 5.1.0)
pnpm exec vp build && node scripts/check-dist.mjs
pnpm exec vp dev --port 5199                   # served index (200), worker module (text/javascript),
                                               # .wasm (application/wasm); app loaded in Chromium,
                                               # Firefox and WebKit through Playwright
cargo fmt --all --check && cargo clippy --workspace --all-targets --locked -- -D warnings
cargo clippy --target wasm32-unknown-unknown -p vector-engine-wasm --locked -- -D warnings
cargo test --workspace --locked                # 26 Rust tests (final)
```
Clean-clone bootstrap, in a scratch directory with no `node_modules`:
```text
git clone <repo> && git checkout p0/technical-feasibility
pnpm dlx --package=vite-plus@1.7.0 vp install  # works: this is how `vp install` runs without a global vp
npx --package=vite-plus@1.7.0 vp install       # FAILS: npm refuses (EBADDEVENGINES) because devEngines
                                               # names pnpm. Documented; use pnpm dlx or a global vp.
node scripts/build-wasm.mjs
```
The `.wasm` SHA-256 was identical in the original checkout and the clone at a different absolute path (`a69a8b32…` for the G0 stub engine). The check was repeated for the final engine, which gave `40b43967…` (484,497 B) in both checkouts; see FINAL-REPORT. Path remapping is what makes this hold.

## Environment
Apple M5 Max, 128 GiB RAM, macOS 26.6.2 (25G83), arm64. Node 24.22.1, pnpm 12.23.0, rustc/cargo 1.96.0 (2026-05-25), wasm-bindgen-cli 0.2.130 (installed with `cargo install --locked`). Playwright 1.65.1: Chrome Headless Shell 159.0.8154.6, Firefox 159.0, WebKit 27.2.

## Measurements
- Production bundle (`dist/`, final P0 build):
  - `vector_engine_wasm_bg.wasm`: 484,325 B (186,225 B gzip -9). No wasm-opt.
  - Main JS: 240,220 B (74,298 B gzip).
  - Worker JS: 6,444 B.
  - CSS: 1.6 KB.
  - 6 files in total, all far below the 25 MiB per-file limit.
- `vp check` ≈ 0.2 s; `vp test` ≈ 0.1 s; `vp build` ≈ 0.1 s; release WASM build ≈ 5 s incremental. These are wall-clock timings on this machine.

## Known limitations
- **No Linux build was run.** The ROADMAP exit asks for Linux and macOS. The Docker daemon was unavailable, so this is NOT RUN, not PASS.
- `wasm-opt` (binaryen) is not used. Running it could shrink the 484 KB WASM further. That is an optional P1 measurement.
- Bootstrapping requires a Rust toolchain plus `cargo install wasm-bindgen-cli --version 0.2.130 --locked`. A Node-only contributor cannot build the WASM, because the generated artefacts are deliberately not committed.
- TypeScript 7.0.2 and `tsrs` are very new. `vp check` handled this code base without issues.
- `pnpm install` reported that core-js's postinstall script was ignored. core-js is pulled in by the evaluation-only jsPDF and never ships; it is left un-approved.

## Relevant artifacts
- `scripts/build-wasm.mjs`, `scripts/check-dist.mjs`, `rust-toolchain.toml`, `.node-version`, `pnpm-workspace.yaml`.
- `artifacts/vp-dev-check.txt`: final workbench under `vp dev` in three engines. Under React StrictMode's dev double-mount, one extra worker is created and terminated, which is expected.

## Unresolved questions
- Should CI exist at all, and if so which minimal job? (Suggested in FINAL-REPORT.)
- Should the global `vp` CLI be the recommended contributor path? It manages Node globally, which the docs say can be turned off with `vp env off`.

## Reproduction
See README "Local development". The minimal sequence is `pnpm install` → `pnpm run wasm` → `pnpm exec vp check` → `pnpm exec vp test` → `pnpm run build`.
