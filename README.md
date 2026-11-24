# Vectra

**From pixels to paths.** An open-source, local-first browser studio for raster tracing and artistic vector print effects.

Status: P0 feasibility and P0-R engineering closure; a temporary engineering workbench runs locally. There is no product UI and no public deployment. See the [P0 final report](docs/research/p0/FINAL-REPORT.md) and the [P0-R final report](docs/research/p0-r/FINAL-REPORT.md).

Import an image, choose a tracing or artistic preset, compare the result, tune its palette and geometry, and export editable SVG or genuine vector PDF. Artwork is processed on-device; no account or backend required.

## Documentation
- [Product requirements](docs/PRD.md)
- [Research and evidence](docs/RESEARCH.md)
- [Technical RFC](docs/RFC-001.md)
- [Preset algorithms](docs/PRESETS.md)
- [Validation](docs/VALIDATION.md)
- [Roadmap](docs/ROADMAP.md)
- [Design](docs/DESIGN.md)
- [Vector Studio PRD (proposed)](docs/PRD-002-VECTOR-STUDIO.md), [tools](docs/VECTOR-STUDIO-TOOLS.md), [Creative Lab](docs/CREATIVE-LAB.md), [image sources and community](docs/IMAGE-SOURCES-AND-COMMUNITY.md), [brand and business](docs/BRAND-AND-BUSINESS.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Contributing](CONTRIBUTING.md)
- [Agent instructions](AGENTS.md)

License: [MIT](LICENSE), Copyright (c) 2026 Stephane Pericat. Third-party notices (which also carry the Vectra license text) for everything distributed in the web app are generated into [`public/THIRD-PARTY-NOTICES.txt`](public/THIRD-PARTY-NOTICES.txt) (`pnpm run notices`) and checked by the build. See [LICENSING-AND-DISTRIBUTION](docs/research/p0-r/LICENSING-AND-DISTRIBUTION.md).

## Local development (P0 workbench)
Prerequisites (validated on macOS arm64 and in an Ubuntu 24.04 arm64 container; linux/amd64 not yet validated):
- Node.js 24.22.1 (`.node-version`). pnpm 12.23.0 is selected automatically through `devEngines`; Corepack-provided `pnpm` works.
- Rust via rustup. `rust-toolchain.toml` pins 1.96.0 with the `wasm32-unknown-unknown` target.
- `cargo install wasm-bindgen-cli --version 0.2.130 --locked`. The version must match `Cargo.lock`, and the build script checks it.

```bash
pnpm install                 # or, without pnpm on PATH: pnpm dlx --package=vite-plus@1.7.0 vp install
pnpm run wasm                # Rust engine -> packages/vector-engine-wasm/pkg (generated, not committed)
pnpm exec vp dev             # workbench at http://localhost:5173
pnpm exec vp check           # format, lint, type check
pnpm exec vp test            # TypeScript unit tests
cargo test --workspace       # Rust engine tests
pnpm run build               # WASM + vp build + dist checks -> dist/
pnpm exec playwright install chromium firefox webkit && pnpm exec playwright test   # browser tests on the production build
```
`vp build`, `vp dev` and `vp test` are Vite+ built-ins and do not build the WASM; run `pnpm run wasm` first, or use `pnpm run build`. Export inspection (`scripts/verify-exports.mjs`) additionally needs qpdf and poppler-utils.

More checks:
- **Linux, no CI:** `scripts/linux-verify.sh` runs a clean-clone build and test in a pinned Ubuntu 24.04 container (needs Docker).
- **Offline:** production builds register a service worker that precaches the build, so the engine still works offline after a cancel. `vp dev` does not register it.
- **Deployment:** see [DEPLOYMENT-READINESS](docs/research/p0-r/DEPLOYMENT-READINESS.md); `wrangler.jsonc` describes a preview, not a production deployment.
- **Native-resolution benchmarks:** `node scripts/fetch-native-corpus.mjs` downloads a CC0 and public-domain corpus, then run `BENCH_NATIVE=1 pnpm exec playwright test tests/browser/native-benchmark.spec.ts`.
