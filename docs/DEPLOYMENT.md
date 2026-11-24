# Cloudflare Pages and Vite+
Proposed static deployment, not yet provisioned.

Use Vite+ commands vp install, vp dev, vp check, vp test, vp build; consult official CI guide for exact pinned bootstrap. Lock Node, package manager, Rust and wasm-bindgen versions. Build WASM before web bundling; ensure generated artifacts are included in dist. Do not assume Pages has Rust or vp preinstalled. P0 test clean Pages Git build; if unsupported, build locally or in pinned CI/container and use Wrangler Pages direct upload in a separately configured project. Never commit Cloudflare credentials.

Pages: production main, preview PRs, output dist, build script invoking pinned tooling and WASM build. Verify HTTPS, application/wasm MIME, no Node runtime imports, cache hashed assets, HTML revalidation, security headers and no network artwork transfer. Cloudflare documents a 25 MiB per-asset limit; measure all assets and fail build above it. No Pages Functions, R2, D1, Workers or backend in MVP. Larger optional models deferred; revisit architecture and privacy before adding them.

Self-hosting: serve dist over HTTPS (localhost permitted for development); document required MIME and headers. No third-party runtime CDN. Offline PWA optional after update/version compatibility testing. Free-tier suitability is conditional on current platform terms and actual usage. No deployment claimed until verified.
