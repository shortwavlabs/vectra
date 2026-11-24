# Pinned Linux environment for local P0-R reproducibility checks (no CI required).
# Base: official Playwright image (Ubuntu 24.04, browsers matching @playwright/test 1.65.1),
# pinned by multi-arch manifest digest. Node, pnpm, Rust and wasm-bindgen are pinned to the
# same versions as the macOS reference environment.
FROM mcr.microsoft.com/playwright:v1.65.1-noble@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579

ARG NODE_VERSION=24.22.1
ARG NODE_SHA256_ARM64=dbabf7a1cbf947e6059ffad2c27b80041db97dea1e553b62afdee7f13fca336e
ARG NODE_SHA256_X64=6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6
ARG PNPM_VERSION=12.23.0
ARG RUST_VERSION=1.96.0
ARG WASM_BINDGEN_VERSION=0.2.130
ARG TARGETARCH

ENV DEBIAN_FRONTEND=noninteractive \
    CARGO_HOME=/usr/local/cargo \
    RUSTUP_HOME=/usr/local/rustup \
    PATH=/usr/local/cargo/bin:/opt/node/bin:$PATH \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    CI=1

RUN apt-get update && apt-get install -y --no-install-recommends build-essential pkg-config git xz-utils ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Node from the official tarball, checksum-verified (replaces the image's Node).
RUN set -eux; case "$TARGETARCH" in \
      arm64) arch=arm64; sum=$NODE_SHA256_ARM64 ;; amd64) arch=x64; sum=$NODE_SHA256_X64 ;; *) exit 1 ;; esac; \
    curl -fsSLo /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.xz"; \
    echo "$sum  /tmp/node.tar.xz" | sha256sum -c -; \
    mkdir -p /opt/node && tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1 && rm /tmp/node.tar.xz; \
    npm install -g "pnpm@${PNPM_VERSION}"; node --version; pnpm --version

# Rust (rust-toolchain.toml would select the same version) and the exact wasm-bindgen CLI.
RUN set -eux; curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain "${RUST_VERSION}" \
      --component rustfmt --component clippy --target wasm32-unknown-unknown; \
    cargo install wasm-bindgen-cli --version "${WASM_BINDGEN_VERSION}" --locked; \
    rustc --version; wasm-bindgen --version

RUN git config --system --add safe.directory '*'
COPY verify.sh /usr/local/bin/vectra-verify
WORKDIR /work
ENTRYPOINT ["/usr/local/bin/vectra-verify"]
