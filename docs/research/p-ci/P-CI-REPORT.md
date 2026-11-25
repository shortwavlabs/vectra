# P-CI — Minimal required check

**Status:** IMPLEMENTED AND VERIFIED ON ITS PR. Merging and branch protection need the maintainer (see §5).

| | |
|---|---|
| Date | 2026-11-25 |
| G-0 architecture baseline | `main` = `29432da7dbcfabd869daa97887bda34331be65bd`: the merge commit of PR #4, after PR #6 (`ce05b8f`) and PR #7 (`a1b8800`) were merged into `docs/rfc-002-vector-studio` with merge commits |
| Specification | [G0-P1-IMPLEMENTATION-PLAN, "P-CI"](../g0/G0-P1-IMPLEMENTATION-PLAN.md) |
| Workflow | [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) |

## 1. The job
- **Runner.** One job, `ci`, on GitHub-hosted `ubuntu-24.04` (native amd64). The repository is public, so no paid infrastructure is used. There is no matrix and no macOS runner.
- **Triggers.** `pull_request` (any base) and `push` to `main`.
- **Steps.** `cargo fmt --all --check` → `cargo clippy --workspace --all-targets --locked -- -D warnings` → `cargo test --workspace --locked` → `pnpm install --frozen-lockfile` → `node scripts/build-wasm.mjs` → `pnpm exec vp check` → `pnpm exec vp test` → `pnpm run build`.
  - The WASM build runs before `vp check` because type checking reads the generated bindings, as in `scripts/linux-verify.sh`.
- **Pins.**
  - Actions are pinned by commit SHA, resolved with `gh api` from the release tags: `actions/checkout` v7.0.1 `3d3c42e5…`, `actions/setup-node` v7.1.0 `949feb24…`, `actions/cache` v6.1.0 `55cc8345…`.
  - Versions are read from the repository, never duplicated in the workflow: Rust from `rust-toolchain.toml` (1.96.0); `wasm-bindgen-cli` from `Cargo.lock` (0.2.130); pnpm from `package.json` `devEngines` (12.23.0); Node from `.node-version` (24.22.1).
- **Caching.** Cargo registry and `target` (keyed on the toolchain and `Cargo.lock`); the `wasm-bindgen` binary; the pnpm store (keyed on `pnpm-lock.yaml`).
- **Hygiene.** `permissions: contents: read`; checkout without persisted credentials; no secrets; `concurrency: ci-${{ github.ref }}` with `cancel-in-progress`; 25-minute timeout; no retries.

## 2. Path filter (fail-closed)
- The job **always runs and always reports**, so it can never leave a required check pending.
- A first step classifies the diff: `base...head` for pull requests, `before..sha` for pushes.
- **Only** a successful, non-empty diff touching no code path turns the heavy steps into a no-op. The job then passes with a "docs-only" message.
- Any error, an empty diff or an unknown range (for example a new branch, where `before` is all zeros) runs everything.
- **Code paths:** `crates/`, `packages/`, `src/`, `public/`, `scripts/`, `tests/`, `docker/`, `.github/workflows/`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, `rustfmt.toml`, `.node-version`, `index.html`, `vite.config.ts`, `tsconfig*.json`.
  - This list is **broader than the specification**, in the safe direction: all of `tests/` instead of `tests/unit/`, plus `docker/`, `rustfmt.toml`, `.node-version` and `index.html`.

## 3. Verification (actual runs)
| Run | Trigger | Result | Duration | Notes |
|---|---|---|---|---|
| [45535732214](https://github.com/shortwavlabs/vectra/actions/runs/45535732214) | PR #8, head `114c0e6` | **success** | 3 min 33 s (02:49:58 → 02:53:31 UTC) | Cold caches. Full path: workflow file changed |
| [45539986929](https://github.com/shortwavlabs/vectra/actions/runs/45539986929) | temporary draft PR #9 (base `ci/p-ci-minimal`, head `8d819d3`; only this report changed) | **success** | 13 s | **Docs-only path:** the diff was classified `full checks required: false`, the no-op step ran, and every heavy step was skipped. PR #9 was closed unmerged and its branch deleted |

Step timings of the cold run:
- Rust toolchain install 10 s;
- `wasm-bindgen-cli` install 71 s (cache miss);
- `cargo fmt` 1 s, `clippy` 11 s, `cargo test` 76 s;
- `pnpm install` 1.3 s (121 packages, supply-chain policy check passed);
- WASM build 14 s, `vp check` 1 s (94 files; 38 linted), `vp test` 14/14;
- production build: notices verified (35 components), dist check passed.

The logs were read to confirm that every step did real work: compiler output, test counts and build output are present.

The run triggered by this report's own commit on PR #8 exercises warm caches; its result is in the PR checks.

**Observations:**
- **WASM binary hash.** The CI (Linux amd64) build of `main`'s engine produced `vector_engine_wasm_bg.wasm` `2e7bd355…` (526,561 B). A fresh macOS build of the same commit gives `be101bca…`.
  - This is the documented cross-host behaviour: the host triple enters Cargo's crate metadata hash and changes symbol names and layout ([LINUX-REPRODUCIBILITY](../p0-r/LINUX-REPRODUCIBILITY.md)).
  - Output identity, the meaningful check, is measured by `scripts/wasm-fingerprint.mjs`. That stays local by design and was **not run in CI**.
- **Linux amd64 evidence (TD-PLATFORM-001).** This is the first native amd64 run of fmt, clippy, the Rust tests, `vp check`, `vp test` and the production build, and it passed.
  - It is **partial** evidence only: the browser suites and the WASM output fingerprint did not run on amd64. TD-PLATFORM-001 stays open.

## 4. Kept local (unchanged)
Full Playwright suites, geometry corpus qualification, the 326/72 frozen-hash regressions, renderer and performance benchmarks, memory tests, real Safari, and Docker Linux verification (`scripts/linux-verify.sh`).

## 5. Maintainer actions
1. **Merge PR #8.** The G-0 closure authorised P-CI as a separate PR but not its merge. P1-A PRs cut from `main` get CI only once this workflow is on `main`, or after `main` is merged into them.
2. **Branch protection** (optional; repository administration). This has **not** been configured or verified by the agent. To make `ci` a required check on `main`:
   - GitHub → Settings → Branches (or Rules → Rulesets) → add a rule for `main` → "Require status checks to pass before merging" → select **`ci`**. The check appears in the list after its first run on `main`.
   - Equivalent CLI (admin token):
     ```bash
     gh api -X PUT repos/shortwavlabs/vectra/branches/main/protection --input - <<'JSON'
     {"required_status_checks":{"strict":false,"contexts":["ci"]},"enforce_admins":false,"required_pull_request_reviews":null,"restrictions":null}
     JSON
     ```
   - Because the path filter never skips the job, requiring `ci` cannot block docs-only PRs.

## 6. Debt
- **TD-PROCESS-001** (no automated required checks): stage **PRODUCTION VERIFIED** (the workflow runs and passes on its PR) / **OWNER ACCEPTANCE PENDING** (merge and required-check configuration).
- **TD-PLATFORM-001** (Linux amd64): partial evidence (§3); unchanged otherwise.
