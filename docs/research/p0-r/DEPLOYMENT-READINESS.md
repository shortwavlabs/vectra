# P0-R-G4: Deployment readiness

**Gate status: OWNER TEST PENDING.**
- Build, configuration and verification tooling are ready and were validated locally against Cloudflare's local runtime.
- No real deployment was made: no account, credentials, DNS change or domain purchase.
- Local emulation (`wrangler pages dev` / `wrangler dev`) is **not** counted as a deployment PASS.

## Method selection (official docs re-checked 2026-11-24)
| Criterion | Cloudflare Pages (direct upload) | **Workers Static Assets (assets-only)** |
|---|---|---|
| Cost | Free plan; build minutes unused with direct upload | "Requests to static assets are free and unlimited", with no storage cost ([billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)) |
| Limits | 20,000 files, 25 MiB per file | Same per-file and file-count limits ([limits](https://developers.cloudflare.com/workers/platform/limits/)) |
| `_headers` | Supported | Supported in the asset directory; overrides defaults ([headers](https://developers.cloudflare.com/workers/static-assets/headers/)) |
| WASM MIME | `application/wasm` (verified locally) | `application/wasm` (verified locally, see below) |
| Previews | Branch previews | Version URLs via `wrangler versions upload --preview-alias <name>`; public unless Cloudflare Access is enabled ([version URLs](https://developers.cloudflare.com/workers/configuration/previews/)) |
| Future same-origin API adapter (IMAGE-SOURCES) | Pages Functions | Add `main` and `"run_worker_first": ["/api/*"]`; assets stay free ([binding](https://developers.cloudflare.com/workers/static-assets/binding/)) |
| Direction | Supported; Cloudflare invests in Workers (blog, 2025-04-08) | Recommended for new projects |

**Recommendation: Workers Static Assets, assets-only.** The same `dist/` also deploys to Pages if the maintainer prefers. Neither needs Rust in Cloudflare's build image: build locally or in the pinned Linux container.

## Configuration in the repository
- **`wrangler.jsonc`:**
  - Name `vectra-preview`; `assets.directory = ./dist`.
  - `not_found_handling = "none"`. The app has no routes, and relative asset URLs would break under an SPA fallback on deep paths.
  - `workers_dev` and `preview_urls` are true.
  - **No account id, routes, custom domains or secrets.** Domains (`vectrapress.ink` / `.com`) are deliberately absent, per BRAND-AND-BUSINESS.
- **`public/_headers`:**
  - CSP with `'wasm-unsafe-eval'`, nosniff, `Referrer-Policy: no-referrer`, a restrictive Permissions-Policy, COOP same-origin, `X-Frame-Options: DENY`.
  - `/assets/*` → `public, max-age=31536000, immutable`.
  - `/sw.js` → `no-cache`.
- **Offline worker compatibility.** The service worker and precache are built into `dist/` and served same-origin, so no host-specific configuration is needed.
- **`scripts/verify-deployment.sh <url>`** checks real HTTP responses with `curl`: content types, CSP, security headers, `immutable` on hashed assets, `no-cache` on `sw.js`, and that THIRD-PARTY-NOTICES is served. It then runs the browser suite against that origin: smoke (tracing), CSP negative control, privacy, and offline cancellation recovery with export.

## Local validation (no account)
| Check | Result |
|---|---|
| `pnpm run build`: 7 files, largest 484 KB `.wasm` (1.9 % of 25 MiB), notices and service worker generated, dist check passed | PASS |
| `wrangler dev` with `wrangler.jsonc` (assets-only, local workerd, wrangler 4.166.0, no login), then `scripts/verify-deployment.sh http://127.0.0.1:8792`: all 16 header and MIME checks `ok` (`application/wasm`, CSP on page and worker, `immutable` assets, `no-cache` sw.js, notices served); unknown path → 404; browser suite 21/21 (smoke, CSP, privacy, offline recovery × 3 engines) | PASS locally (`artifacts/wrangler-dev-headers.txt`); local emulation only |
| P0: `wrangler pages dev dist`: headers applied, `application/wasm`, smoke/CSP/privacy tests 12/12 | PASS (P0 evidence) |
| Real HTTPS deployment: headers at the edge, WASM loading, tracing, export, offline cancellation recovery | **OWNER TEST PENDING** |

## Owner checklist for a preview deployment
Run these only with maintainer approval. The commands are exact; `wrangler` is pinned through `pnpm dlx`.
1. `pnpm install && pnpm run build`. Optionally use the canonical builder first: `scripts/linux-verify.sh`.
2. `pnpm dlx wrangler@4.166.0 login`. The maintainer authenticates; never share tokens.
3. First upload. A Worker must exist before Version URLs work, so this creates `vectra-preview` on a `*.workers.dev` hostname, which is **publicly reachable**:
   `pnpm dlx wrangler@4.166.0 deploy`
   To restrict access, enable Cloudflare Access for the Worker before sharing the URL.
4. Later previews without changing the deployed version: `pnpm dlx wrangler@4.166.0 versions upload --preview-alias p0r`.
5. Verify: `scripts/verify-deployment.sh https://vectra-preview.<account-subdomain>.workers.dev`. Expect all header checks `ok` and the browser suite passing.
6. Record the URL, the wrangler output (version id) and the verification output in the PR.
7. Custom domain, DNS and production remain separate, later decisions.

Alternative (Pages): `pnpm dlx wrangler@4.166.0 pages project create vectra --production-branch main`, then `pnpm dlx wrangler@4.166.0 pages deploy dist --project-name vectra --branch p0r-preview`, then step 5 with the preview URL.

## Operating cost
Static assets only. No Worker invocations, KV, D1, R2 or paid plan are required; requests to static assets are free and unlimited under current Cloudflare terms. A future `/api/*` adapter would be billed as Worker requests. It would stay optional and is out of scope.
