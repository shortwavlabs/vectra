# Vectra

**From pixels to paths.** An open-source, local-first browser studio for raster tracing and artistic vector print effects.

**Status: P0 accepted and complete** as an engineering baseline (P0, P0-R, P0-R-GEO), not a production release. **Next: RFC-002, the Vector Studio architecture.**
- A temporary engineering workbench runs locally. There is no product UI and no public deployment.
- Start at the [P1 handoff](docs/P1-HANDOFF.md). See also the [acceptance record](docs/research/P0-ACCEPTANCE.md), the [technical debt register](docs/TECHNICAL-DEBT.md) and the [P0 postmortem](docs/research/P0-POSTMORTEM.md).

Tracing has two fit modes:
- **Artistic** (`spline`, the default): the approved behaviour for photographs and organic artwork.
- **Precision** (`precision`, opt-in; "Fit: precision" in the workbench): for logos and geometric artwork. It recovers sub-pixel boundaries from the antialiased source and produces smooth G1 curves, straight lines, crisp corners, and exact circles where the evidence proves them.

Known limitations are tracked as technical debt.

**Principles:** local-first processing, no AI in the creative runtime, and genuine vector SVG/PDF export with no raster fallback.

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
- [Deployment](docs/DEPLOYMENT.md): Cloudflare Workers Static Assets, assets-only, approved; deployment deferred until a suitable UI exists.
- [P1 handoff](docs/P1-HANDOFF.md) · [Technical debt register](docs/TECHNICAL-DEBT.md) · [P0 acceptance record](docs/research/P0-ACCEPTANCE.md) · [P0 postmortem](docs/research/P0-POSTMORTEM.md)
- Phase reports: [P0](docs/research/p0/FINAL-REPORT.md), [P0-R](docs/research/p0-r/FINAL-REPORT.md), [P0-R-GEO](docs/research/p0-r-geo/FINAL-REPORT.md)
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
