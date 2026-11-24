# Vectra

**From pixels to paths.** An open-source, local-first browser studio for raster tracing and artistic vector print effects.

Status: P0 technical feasibility. A temporary engineering workbench runs locally; there is no product UI or deployment yet. See [P0 final report](docs/research/p0/FINAL-REPORT.md).

Import an image, choose a tracing or artistic preset, compare the result, tune its palette and geometry, and export editable SVG or genuine vector PDF. Artwork is processed on-device; no account or backend required.

## Documentation
- [Product requirements](docs/PRD.md)
- [Research and evidence](docs/RESEARCH.md)
- [Technical RFC](docs/RFC-001.md)
- [Preset algorithms](docs/PRESETS.md)
- [Validation](docs/VALIDATION.md)
- [Roadmap](docs/ROADMAP.md)
- [Design](docs/DESIGN.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Contributing](CONTRIBUTING.md)
- [Agent instructions](AGENTS.md)

Proposed MIT licensing (no LICENSE file yet; maintainer decision). P0 dependency and fixture licenses are audited in [DEPENDENCY-LICENSE-AUDIT](docs/research/p0/DEPENDENCY-LICENSE-AUDIT.md).

## Local development (P0 workbench)
Prerequisites (validated on macOS arm64; Linux not yet validated):
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
