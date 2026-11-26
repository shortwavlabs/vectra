# G-BRAND report: the Vectra visual identity

| | |
|---|---|
| Status | Approved by the maintainer subject to closure (PR #21, `gate/g-brand` from `main` `d7bdfcf`); closure in §10, text banners in §11; not merged, not deployed, not published to any account |
| Date | 2026-11-25 |
| Machine | macOS (Darwin 25.6.0) arm64, shared; load averages recorded per run |
| Tools | Node 24.22.1, pnpm 12.23.0, Rust 1.96.0, resvg/usvg 0.50.0, tiny-skia 0.12.0, png 0.18.1, Playwright 1.65.1 (Chromium, Firefox, WebKit) |
| Brand guide | [branding/BRAND.md](../../../branding/BRAND.md) |

## 1. Summary
- **Symbol and masters.** The approved symbol is in the repository byte-for-byte as `branding/vectra-symbol.svg`. Three colour masters are derived from it by colour substitution only.
- **Assets.** A committed script regenerates a text-free social kit, transparent symbol PNGs and the favicon/PWA set. A re-run on this machine is byte-identical.
- **App.** The top bar shows the ivory + lime symbol in place of the temporary V mark. Both pages link favicons, an Apple touch icon and a web manifest. The service worker's recovery page shows the canonical symbol inline.
- **Constraints kept.**
  - `public/_headers` is unchanged.
  - No dependency was added.
  - Nothing under the protected paths changed.
- **Maintainer decisions.** Section 9.

## 2. Asset inventory
**Masters.** Each is 1,004 bytes, vector-only (no `<image>`, `data:`, `href`, `<text>`, `<font>` or `<style>`), with the viewBox `0 13 453 343`.

| File | SHA-256 |
|---|---|
| `branding/vectra-symbol.svg` (canonical, charcoal + lime) | `fad9ae97a0a82349647f25b03283814c13700055f9a5da3c2521547333d7881a`, identical to the supplied file |
| `branding/vectra-symbol-ivory.svg` (ivory + lime) | `a80db5a3780811e6077ba17acfb5720fc569df3de300ced8d933bc06e71d96c7` |
| `branding/vectra-symbol-mono-charcoal.svg` | `fb580f20375a0a951edb95b479dec6c8cc50a68c89c820f7263f0d45f5a102cf` |
| `branding/vectra-symbol-mono-ivory.svg` | `1a6d2ba4ff0266cc619d4714264ab32b83cea23f8adc08533522530da0219e72` |

**Generated rasters.** Every size below is reported by the rasteriser and checked by the script.

| Path | Size |
|---|---|
| `branding/png/vectra-symbol{,-ivory,-mono-charcoal,-mono-ivory}-453x343.png` | 453×343 (1×) |
| `branding/png/…-1812x1372.png` | 1812×1372 (4×) |
| `branding/social/profile-1024.png`, `profile-512.png` | 1024², 512² |
| `branding/social/x-banner-1500x500.png` | 1500×500 |
| `branding/social/github-social-1280x640.png` | 1280×640 |
| `branding/social/youtube-banner-2560x1440.png` | 2560×1440 |
| `branding/web/favicon.svg` | vector, tile composition |
| `branding/web/favicon.ico` | 16 + 32, PNG entries |
| `branding/web/favicon-16.png`, `favicon-32.png` | 16², 32² |
| `branding/web/apple-touch-icon.png` | 180² |
| `branding/web/icon-192.png`, `icon-512.png` | 192², 512² |
| `branding/web/icon-maskable-512.png` | 512² |
| `branding/proposals/vectra-symbol-mono-{charcoal,ivory}-tint.svg` (+ 453×343 PNGs) | proposal only (section 9) |

- **Shipped subset.** `public/` holds a byte-identical copy of `favicon.svg`, `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` and `icon-maskable-512.png`, plus `manifest.webmanifest`.
- **Binary size.** The 27 binary assets (PNG and ICO) committed under `branding/` and `public/` total **321,668 bytes**, stored as 21 unique blobs (285,969 bytes), since identical files share a blob. The six evidence PNGs under `docs/research/g-brand/` add 468,707 bytes.

## 3. Method
- **Colour masters** are the canonical text with `#191a1c`/`#b9e87b` substituted in one pass. The script asserts all four are equal once every `#rrggbb` is masked, and that each is vector-only.
- **Compositions** (favicon tile, badge, banners) nest a master's own markup, minus its `<title>`, in `<svg viewBox="0 13 453 343">`. They are positioned by x, y, width and height, so no coordinate is retyped.
  - The visible geometry is the viewBox inset by exactly 16 units on each side, which this run measured: alpha bounding box (32, 32)–(874, 654) at 906×686. The geometry's centre is therefore the viewBox centre.
- **Rasteriser.** `branding/rasterize` is a 45-line standalone crate on `resvg =0.50.0`, following the `experiments/` precedent (own `[workspace]` and lockfile).
  - Its `Cargo.lock` was seeded from the root lock and pruned. All 37 packages resolve to versions present in the root `Cargo.lock` (checked by script; none new).
  - It refuses a non-uniform scale (negative control: 900×686 for the 453×343 master panics) and prints each output's size and alpha bounding box.
- **Checks in `generate.mjs`:**
  - exact dimensions for all 30 rasters;
  - transparent symbol exports keep the viewBox margin on every side, ±1 px, so nothing is clipped or stretched;
  - every composition's geometry lies inside its canvas;
  - the profile, maskable and touch-icon geometry stays inside the 80 % circle (at 72 % of the radius);
  - the YouTube geometry lies inside the centred 1546×423 safe area.
- **Font decision: no text.** Banners carry no words. This is the smallest compliant option: no font to vendor, no licence to approve, no notices change. Typesetting "Vectra" (and at most "From pixels to paths.") needs an OFL-class font vendored with its licence, which is a maintainer decision.

## 4. Determinism
```bash
node branding/generate.mjs        # run 1, then hash every file under branding/, public/ and the checks
node branding/generate.mjs        # run 2
```
- **Result.** The two runs produced identical SHA-256 for all 61 output files. The committed tree is also unchanged after a re-run: `git status --porcelain branding public` is empty.
- **Rasteriser alone.** Two renders of the same job gave the same hash (`edc3b3df…`).

## 5. Legibility findings
- **Favicon.** The shipped favicon uses the canonical geometry. The contact sheet shows it at 8× and 4×, pixel-exact.
  - **32 px:** legible. Ribbon, both tones, pixel squares and anchors are identifiable; the handles become hairlines.
  - **16 px:** the symbol reduces to the ribbon's diagonal plus one light block (the large pixel square). The ribbon's near-horizontal tails read as bars at top and bottom.
  - **Simplification by omission:** removing the control handles (no new coordinates) changes almost nothing at 16 px (contact sheet, "tile without handles"). No proposal file is offered: a useful 16 px variant would need redrawn geometry, a design decision for the maintainer. This is the remaining open question.
- **Transparent vs tile.** On a dark tab strip the bare canonical loses its charcoal parts; on a light one the bare ivory variant loses its ivory parts. The favicon is therefore the ivory + lime symbol on a rounded charcoal tile, which reads on both. The SVG favicon has no `<style>` or media query: the site CSP is sent with it.
- **Profile picture.** It reads at 32, 48 and 64 px, including a circular crop (contact sheet).
- **Monochrome.** Colour substitution merges the two ribbon paths into one silhouette and fuses the anchor squares with the ribbon tips and handles. The form stays recognisable, but the two-tone ribbon is lost.
  - The masters are delivered as specified.
  - **Proposal:** two-tone single-ink tints (section 9).
- **Rendering observation.** The ribbon paths share their first curve exactly. Anti-aliasing therefore leaves a faint hairline of the back path along the front path's outer edge, visible only at large sizes. It is left as supplied (no re-pathing).

## 6. Application integration
| Surface | Change |
|---|---|
| Workspace top bar (`src/shell/Workspace.tsx`) | `BrandMark` (ivory + lime master, literal brand hex) replaces `LogoMark`, the temporary V mark |
| `index.html`, `workspace.html` | `data:,` icon replaced by four links: `favicon.ico` (`sizes="32x32"`), `favicon.svg`, `apple-touch-icon.png` and `manifest.webmanifest`; Vite rewrites them to `./…` (relative base) |
| `public/manifest.webmanifest` | New file |
| `scripts/generate-sw.mjs` | The recovery page shows the canonical symbol inline (64×48, `aria-hidden`, presentation attributes only, no request); the header comment lists the new precache exception |
| `README.md` | The symbol at the top (`<picture>`: ivory variant on dark, canonical on light; `alt=""` beside the heading) and a Brand link |
| `DESIGN.md` | Symbol line, map entry and one "Do" line |
| `docs/DESIGN-SYSTEM.md` | §14 record, including the deviation from §6 |
| `branding/BRAND.md` | New |

- **Top-bar mark details:**
  - 32×24 px, `aria-hidden="true"`, beside the visible "vectra" text, so there is one announcement;
  - 24 px instead of the old 20 px, because at 20 px the mark looked light against the bold wordmark;
  - `src/shell/brand-mark.test.ts` fails if it, or the recovery page's copy, drifts from its master. Negative controls: one changed coordinate in each copy fails the test.
- **Web manifest fields:** name and short name "Vectra"; `start_url` `./workspace.html`; scope `./`; `display: standalone`; background and theme `#191a1c` (`background` token); icons `icon-192.png`, `icon-512.png` and `icon-maskable-512.png` (`purpose: maskable`).
- **Surfaces left alone, so no screen was created for the logo:**
  - the landing page / P0 workbench `h1`, which has no brand mark today;
  - the empty-state sheet, which shows an upload icon, not branding;
  - no splash or loading screen exists.
- **Offline contract.**
  - The new files are in `public/`. `scripts/generate-sw.mjs` precaches them (20 precached files, up from 13), and `scripts/check-dist.mjs` passes.
  - `vite.config.ts` hashes `public/` into the build ID: the ID changed from `5f101dbcfb92ba95` (main) when the icons were added. The service-worker VERSION hashes the template and every file.
  - Unlike other assets, the icons and manifest are not content-hashed (fixed names). They are never executed, so a network fallback can only return the same bytes, another build's icon, or fail. The generator comment records this.
- **Self-contained generator.**
  - **What failed.** The first version of the recovery-page change read the master from `branding/`. That broke the update tests' template-only variant, which runs a copy of the generator from a temporary directory: 6 failures, 3 engines (log below).
  - **Fix.** The symbol is now inline, with the drift test covering it.
- **Test changes:**
  - **`tests/browser/privacy.spec.ts`.** Its filename guard rejects any request URL containing `.png`. It now exempts exactly the four same-origin icon URLs (`apple-touch-icon`, `icon-192`, `icon-512`, `icon-maskable-512`); every other check is unchanged.
    - Before the change, it failed in Chromium (the service worker precaches the PNGs) and Firefox (it loads `apple-touch-icon.png` as a page icon).
    - Observed requests: Chromium fetched the 7 icon/manifest files from the service worker; Firefox loaded `apple-touch-icon.png` and `favicon.svg`; WebKit loaded the manifest.
  - **`tests/browser/sw-site.ts`.** The test origin serves `.svg`, `.png`, `.ico` and `.webmanifest` with their real types; it served `application/octet-stream`, and with `nosniff` that would misrepresent the deployment.
  - **`tests/browser/ui-shell.spec.ts`.** The top-bar test also checks that the mark is `aria-hidden`, centred on the wordmark (< 1 px) and placed before it, at 1024×640 and 1920×1080.
- **CSP.** `public/_headers` is unchanged.
  - The header mark and recovery-page symbol are inline SVG with presentation attributes; there is no `<style>` and no inline script.
  - The manifest falls under `default-src 'self'`; icons under `img-src 'self'`.

## 7. Qualification
All runs use the production build, served by my own `pnpm exec vp preview --host 127.0.0.1 --port 4195 --strictPort` with `PW_BASE_URL=http://127.0.0.1:4195`; the server was stopped afterwards.

**Not run:**
- real Safari (it is the lead's);
- `cargo test` (no Rust workspace change; the rasteriser crate is outside the workspace);
- a screenshot of the service worker's recovery page (it is exercised by the lifecycle specs);
- a real browser tab strip (the favicon "in context" is simulated in the contact sheet).

**Builds** (`pnpm run build`: WASM, `vp build`, notices check, service worker, `check-dist`):

| Build | Notices | Service worker | Build ID | Dist |
|---|---|---|---|---|
| Final, at `962d9dc` | 55 components verified | VERSION `5441379d9f451517`, 20 precached files | `69b8618a0497ded6` | 22 files, 1,800,567 bytes; dist check passed |
| `a1be285` (before the docs commit) | — | identical | identical | — |
| `main` | — | VERSION `726db44da5393af1`, 13 files | `5f101dbcfb92ba95` | 15 files, 1,768,426 bytes |

The `a1be285` build is identical to the final one, so docs do not enter the build.

**Checks:**

| Check | Command | Result | Load (1-min) |
|---|---|---|---|
| Dist references | Script over `dist/*.html` and `dist/manifest.webmanifest` | All four links in both pages, `start_url` and the three manifest icons resolve to files in `dist/`; all seven files are in the precache list | — |
| `favicon.ico` decode | `file`; `Image.decode()` of the file in Chromium, Firefox and WebKit | Two PNG entries, 16×16 and 32×32 RGBA; each engine decodes it (natural size 32×32) | — |
| Served types | `curl -I` on port 4195 | `image/x-icon`, `image/svg+xml`, `image/png`, `application/manifest+json`, all 200 | — |
| Format, lint, types | `pnpm exec vp check` | Pass: 314 files formatted; 0 warnings or errors in 174 files. `--fix` was scoped to individual new files only | — |
| Unit tests | `pnpm exec vp test` | **396 passed** (27 files), including the 2 brand-mark drift tests | — |
| Rasteriser crate | `cargo fmt --check` and `cargo clippy --release --locked` with `--manifest-path branding/rasterize/Cargo.toml` | Clean | — |
| Bundle | `node docs/research/g-ui/measure-bundle.mjs` | All three budgets met (detail below) | 1.85 |

**Bundle**, main → G-BRAND, gzip KiB:

| Measure | main | G-BRAND | Budget |
|---|---|---|---|
| Workspace initial JS | 231.0 | **231.2** | 250 |
| Workspace initial CSS | 9.5 | **9.5** | 15 (design-system CSS) |
| Design-system JS | 114.3 | **114.3** | 150 |
| Shell JS | 15.9 | 16.2 | — |
| Workbench initial JS | 114.8 | 114.8 | — |
| Baseline | 66.2 | 66.2 | — |

The icons are static files outside the JS/CSS budget (largest: `icon-512.png`, 11,869 bytes).

**Playwright: targeted specs, 3 engines:**

| Run | Result | Load (1-min) |
|---|---|---|
| `sw-update-lifecycle`, `workspace-offline`, `ui-shell` (with its CSP guard), `ui-document` at `f8d1989` | 138 passed, **6 failed**. Each engine failed `a service-worker-only update…` and `a template-only update waits…`. Cause: the generator read `branding/` relative to its own location, and the tests run a copy elsewhere. Fixed in `a1be285` | 1.08 → 1.56 |
| Same specs at `a1be285` | **143 passed, 1 failed** in Chromium: `canvas edges… 1024×640: what is under the e handle` got `null` from `elementFromPoint` | 0.95 → 2.16 |

- **The `canvas edges` failure is flaky.** That test passed in the run before and in 5/5 repeats right after (`--repeat-each=5`, load 1.76 → 1.72). The final full run passed it in all 3 engines. It is unrelated to the brand change: the canvas region and the code under it are untouched.

**Playwright: full suite**, `pnpm exec playwright test`, 3 engines:

| Run | Result | Time | Load (1-min) |
|---|---|---|---|
| First run at `a1be285` | 370 passed, **2 failed**, 39 skipped. The failures were `renderer-behaviour` `render-worker crash…` (worker and offline-worker), Chromium, `spawnSync target/release/examples/render_compare ENOENT` | 9.1 min | 1.58 → 2.37 |
| `renderer-behaviour.spec.ts` rerun | **24 passed** | — | 1.64 → 1.57 |
| **Final at `962d9dc`** | **372 passed, 0 failed**, 39 skipped (no retries configured, so Playwright reports no flaky tests; see the flaky count below) | 8.9 min | 2.62 → 1.78 |

- **Flaky count: 1.** The `canvas edges` test failed once (targeted run) and then passed. Nothing failed in the final full run.
- **The `render_compare` failure is environmental.** `renderer-correctness.spec.ts` builds `render_compare` in a `beforeAll`, but `renderer-behaviour.spec.ts` runs earlier and uses it without building it. In a fresh worktree the first full run therefore fails there. This dependency pre-exists G-BRAND; it is worth a technical-debt note.
- **Skips: 13 per engine,** all opt-in: benchmarks, perf, screenshot sets, the owner bundle, and `pdf-eval`.
  - `pdf-eval` needs `export_samples`, which was not run in this worktree. That is why there are 39 skips rather than G-UI-R's 36.

**Accessibility:**

| Check | Result |
|---|---|
| Accessibility snapshot of the banner (Chromium, Firefox, WebKit) | `- text: vectra` once; no `img`; the mark is `aria-hidden` |
| `ui-shell` top-bar test (3 engines) | Passes: mark and wordmark centred within 1 px at 1024×640 and 1920×1080 |
| Evidence script (Chromium) | 0.000 px centre offset at 1024×640, 1280×720, 1366×768, 1440×900 and 1920×1080 |
| Mark contrast on the bar (`panel`) | Ivory 13.02:1, lime 11.29:1 (non-text ≥ 3:1) |

**Protected paths:** `git diff d7bdfcf` is empty for:
- `src/document`, `src/renderer`, `src/hit-test`, `src/jobs`, `src/persistence`, `src/canvas-host`, `src/export`, `src/ui/registry`;
- `crates`, `packages`;
- `public/_headers`, `package.json`, `pnpm-lock.yaml`, root `Cargo.toml` and `Cargo.lock`, `vite.config.ts`.

## 8. Evidence
**Committed under `docs/research/g-brand/`** (the full set is in `tests/output/g-brand/`, ignored by git):

| File | Shows |
|---|---|
| `contact-sheet.png` | Every master on white, ivory and charcoal; the tint proposal; the social kit with the YouTube safe area and X avatar zone; the profile picture at 32/48/64 (1×, circular crop, 4×); the favicon in simulated light and dark tab strips and at 8×/4×; transparent and handle-omission comparisons; the app icons with the maskable 80 % zone |
| `header-1366x768.png`, `header-1920x1080.png` | Top-bar crops |
| `header-1366x768@3x.png` | The mark at its real size, at a device scale of 3 |
| `workspace-1366x768.png` | The workspace at 1366×768 |
| `landing-1366x768.png` | The P0 workbench at `/`, unchanged apart from its icons |
| `header-alignment.json` | Mark and wordmark boxes at five viewports |
| `evidence.mjs` | The script that produced all of the above (headless Chromium) |

- **Header alignment** (`header-alignment.json`). The mark's centre equals the wordmark's centre (0.000 px offset) at 1024×640, 1280×720, 1366×768, 1440×900 and 1920×1080. The gap is 6 px, and the mark sits 0.5 px above the bar's centre, which is the bar's 1 px bottom border.
- **Favicon in context.** Headless Chromium has no tab strip, so the contact sheet shows simulated tabs. A real browser check is left to the lead's Safari and desktop passes.

## 9. For maintainer approval (as submitted; decisions in §10)
1. **Monochrome.** By colour substitution alone, the two ribbon paths merge and the anchors fuse. Options: accept the silhouette masters as delivered, or approve the two-tone tint proposal (`branding/proposals/`), which is colour only with no new geometry.
2. **16 px favicon.** The canonical geometry ships. At 16 px it reads as the ribbon plus one block, and omitting the handles does not help. Options: accept this, or commission a redrawn small-size variant (new geometry, a design task).
3. **Banner text.** The banners are text-free. Adding "Vectra" (and at most the tagline) needs an OFL-class font vendored under `branding/` with its licence.
4. **Installability.** Install becomes possible: a `standalone` manifest with icons plus the existing service worker lets Chromium offer to install Vectra, while ROADMAP lists PWA under P3. Choices made here are `start_url` `./workspace.html` (the product workspace, also from the workbench) and `display: standalone`. Changing it to `display: browser` would keep the manifest as metadata only.
5. **DESIGN-SYSTEM §6 deviation:** it says "no fonts, images or remote assets", and the build now ships local icon files and a manifest (recorded in §14). The UI itself still has no image files: the mark is inline SVG.
6. **Brand values in the mark.** The top-bar mark uses literal brand hex rather than tokens, because the identity is not themed. The values equal `paper` and `primary` today; §4 calls `paper` display-only.
7. **Privacy test.** `privacy.spec.ts` exempts exactly the four icon PNG URLs from its `.png` guard.
8. **Licence.** No licence or trademark statement is made for the mark. That is for the maintainer.
9. **Rasteriser crate.** `branding/rasterize` is a standalone crate with its own lockfile (`resvg =0.50.0`), following the `experiments/` precedent. It adds no package version beyond the root `Cargo.lock` and is never shipped.
10. **Test harness.** `tests/browser/sw-site.ts` now serves `.svg`, `.png`, `.ico` and `.webmanifest` with their real types (alongside item 7).

## 10. Closure (maintainer decisions, 2026-11-25)
Committed on top of `47d44e4`; nothing amended or rewritten.

**Decisions applied:**

| Decision | Applied |
|---|---|
| Tonal variants | The two-tone proposals are now official masters: `branding/vectra-symbol-tonal-charcoal.svg` (`b155c9e4154e81c7446531f00d233f3e3509c319d5e9e1278d378d7a2def720b`) and `-tonal-ivory.svg` (`02609a991ee238abf03033abf68582bd29ed81f70d8e8df621a86f04cdc0220f`), 1,004 bytes each, with 453×343 and 1812×1372 PNGs. `branding/proposals/` is removed. The generator derives them by colour substitution and checks them like the other masters. `BRAND.md` separates solid monochrome from tonal reproduction and says the tonal files are RGB screen tints, not print-qualified single-ink separations. The four colour masters are unchanged |
| 16 px favicon | Accepted as is; no change |
| Standalone manifest, early installability | Recorded as approved (`BRAND.md`, DESIGN-SYSTEM §14); no behaviour change |
| §6 local branding-asset exception | Recorded as approved |
| Literal brand colours | Recorded as approved |
| `privacy.spec.ts` icon exemption | Recorded as approved. `git diff d7bdfcf -- tests/browser/privacy.spec.ts` touches two lines only: the `icons` list and the guard `if (!icons.includes(r.url))` before the unchanged `.png`/fixture-name assertion. The GET-only, zero-body, same-origin, token and no-network-during-session assertions are unchanged |
| Standalone rasteriser | Recorded as approved; isolation proven below |
| MIME-type corrections (`sw-site.ts`) | Recorded as approved |
| Shared-edge anti-aliasing | Recorded as accepted; geometry untouched |
| Logo licensing and trademark | Open public-release decision in `BRAND.md`; the MIT licence is unchanged and no terms were added |

**`branding/` stays out of the runtime build:**
- `vite.config.ts` has no reference to `branding` (0 matches). Its build inputs are `index.html` and `workspace.html`. The build ID hashes `src/`, `public/`, the WASM package and six named root files.
- No runtime source imports from `branding/`. The only `src/` mentions are a comment in `Workspace.tsx` and the unit test `brand-mark.test.ts`, which reads the masters at test time. `grep -rl branding dist` finds nothing.
- The service-worker precache is exactly the files in `dist/`; `check-dist.mjs` already enforced this.
- New guard in `scripts/check-dist.mjs` (runs in `pnpm run build`). It fails the build if `dist/` contains a font file (`.ttf`, `.otf`, `.woff`, `.woff2`), or any file whose bytes match a file under `branding/`, other than the six shipped icons copied from `branding/web/`.
  - Negative control: a copied master (`dist/leak.svg`) and a stray `dist/assets/x.woff2` were both reported, alongside the existing precache mismatch. After their removal the check passed.
- Rebuild after the closure changes: build ID `69b8618a0497ded6` and SW VERSION `5441379d9f451517`, both unchanged, so the runtime output is byte-identical. 20 precached files; dist check passed.

**Banner preparation (blocked on the text engine; nothing rendered):**
- **Safe areas.** The generator now checks every banner against a per-platform safe area. It runs on today's text-free banners and is written for the text block's box to join it:
  - X: clear of the avatar zone, x < 27 % and y > 60 % of 1500×500;
  - GitHub: inside its 1.91:1 crop with a 40 px margin (69–1211 × 40–600);
  - YouTube: inside the centred 1546×423 area.
  - Negative control: moving the X avatar zone to the centre and narrowing the GitHub area made both checks fail.
- **Blocker.** The requested path, resvg/usvg's `fontdb` loading only the vendored files, needs resvg's `text` feature.
  - That feature pulls in `fontdb` 0.24, `harfrust`, `skrifa` (with `read-fonts` and `font-types`), `unicode-bidi`, `unicode-script`, `unicode-vo`, `xmlwriter` and `base64` 0.23.
  - None of these is in the root `Cargo.lock` or the local cargo cache. Resolving offline fails: `cargo generate-lockfile --offline` reports "no matching package named `fontdb` found".
  - Enabling it would mean downloading crates, which this closure forbids. No dependency was added; the rasteriser is unchanged.
- **Options** (decision needed):
  1. Permit fetching those crates (MIT/Apache) into `branding/rasterize/Cargo.lock`: real HarfRust shaping, as specified.
  2. Stay offline: a small owned TrueType outliner in `generate.mjs` reads exactly the vendored Inter files (cmap, glyf with composite glyphs, hmtx, GPOS pair kerning) and emits glyph outlines as SVG paths, rendered by resvg as today. It uses no system fonts by construction. Its shaping is limited (no contextual alternates), which is adequate for "vectra" and "From pixels to paths.". Outlining an OFL font in an image is permitted.
  3. Chromium text rendering with `@font-face`: not resvg, and weaker determinism; not recommended.
- **Composition plan once unblocked:** symbol left, wordmark "vectra" (Inter SemiBold) with the tagline (Inter Regular) right, ivory with one restrained lime accent, centred as a block and optically aligned. The text-free banners stay in place until then.

**Qualification of the closure changes:**

| Check | Result |
|---|---|
| `node branding/generate.mjs` | 32 rasters, 5 derived masters, all checks passed |
| Re-run of the generator | `git status --porcelain branding public` empty: byte-identical |
| `pnpm exec vp check` | Pass |
| `pnpm exec vp test` | Pass |
| `pnpm run build` | Notices verified; dist check passed with the new guard |
| Contact sheet | Regenerated with the tonal masters on white, ivory and charcoal |
| App screenshots | Byte-identical to the committed ones |
| Playwright | Not re-run: no runtime, test or `dist` change (same build ID and SW VERSION) |


## 11. Text banners (2026-11-26)
The maintainer approved Inter 4.1 (SIL OFL 1.1) and chose HarfBuzz `hb-view` as the text engine. This supersedes §10's blocker and its options: no crate was added, no outliner written, and the rasteriser is unchanged.

**Font.** `branding/fonts/` holds `Inter-Regular.ttf` (`40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82`) and `Inter-SemiBold.ttf` (`78a843fade9d4612a5567302fb595b56976eb5fcebf4fea5a5912d638bafcde3`), unmodified from the official v4.1 release.
- It also holds `LICENSE.txt` (OFL 1.1, `262481e8…935a`) and `SOURCE.md` (source URL, archive and per-file SHA-256, the approval). The hashes above were re-verified, and `SOURCE.md` is accurate as placed.
- 837,491 bytes in all; no other font files.
- The generator refuses either file unless its SHA-256 matches, next to the canonical-symbol check.

**Pipeline** (`branding/generate.mjs`):
1. **Version check.** `hb-view --version` must report HarfBuzz 15.x: found `hb-view (HarfBuzz) 15.2.0` (`/opt/homebrew/bin/hb-view`). Negative control: with `hb-view` off the `PATH`, the generator stops with "hb-view (HarfBuzz 15.x) is required for the banners: spawnSync hb-view ENOENT".
2. **Shaping.** `hb-view --font-file=<vendored file> --font-size=1000 --margin=0 --background=none --output-format=svg --text=…` shapes the text and writes glyph outlines.
   - The `--font-file` is the only font source, and HarfBuzz has no font fallback.
   - It runs twice per string and the bytes must match. They do: the output has no timestamps or random ids, so no normalisation was needed.
   - The generator also checks one glyph per character on one baseline.
3. **Composition.** Each glyph becomes a `<path>` with a translate and scale, after the nested symbol master, in ivory; the tagline's full stop is lime.
   - Each banner SVG is kept as `branding/social/<name>.svg` and records the HarfBuzz version in a comment.
   - The generator fails if a banner contains `<text>`, `<style>`, `<image>`, `data:` or a font reference. Each has 0 `<text>`, at 31.7 KB.
4. **Rasterisation** uses the unchanged resvg crate.

**Layout.** A horizontal lockup on charcoal: symbol, then "vectra" (SemiBold) over "From pixels to paths." (Regular).
- **Proportions** of the symbol's geometry height H: wordmark 0.54 H, tagline 0.168 H, gap 0.26 H, baseline-to-baseline 0.36 H.
- **Alignment.** The text is aligned on its ink. The wordmark-top-to-tagline-baseline span is centred on the symbol.
- **Placement,** in banner pixels, all checked by the generator:

| Banner | H | Lockup box | Safe area |
|---|---|---|---|
| X 1500×500 | 150 | 507.5–992.5 × 175–325 | Clear of the avatar zone (x < 405, y > 300); inside a 40 px margin |
| GitHub 1280×640 | 210 | 300.5–979.5 × 215–425 | Inside the 1.91:1 crop with a 40 px margin (69–1211 × 40–600) |
| YouTube 2560×1440 | 250 | 875.8–1684.2 × 595–845 | Inside the centred 1546×423 area (507–2053 × 508.5–931.5) |

The profile pictures and app icons are unchanged, byte for byte.

**Determinism.** Two consecutive runs of `node branding/generate.mjs` gave identical SHA-256 for all 72 output files under `branding/`, `public/` and the check/intermediate folders. The two console logs were identical too.

**Font isolation.**
- The rebuilt `dist` contains no font. Build ID `69b8618a0497ded6` and SW VERSION `5441379d9f451517` are unchanged, so the runtime is byte-identical.
- Negative control: `Inter-Regular.ttf` copied into `dist/assets/x.bin` and `Inter-SemiBold.ttf` into `dist/assets/y.ttf` both failed `check-dist`, as a font file and as branding sources (the renamed `.bin` was caught by content). After their removal the check passed.

**Evidence.** `docs/research/g-brand/contact-sheet.png` is regenerated. The banners appear with their safe-area overlays: X avatar zone and margin, the GitHub 1.91:1 crop and margin, and the YouTube 1546×423 area.

**Qualification:**

| Check | Result | Load (1-min) |
|---|---|---|
| `pnpm exec vp check` | Pass: 314 files formatted; 0 warnings or errors in 174 files | — |
| `pnpm exec vp test` | 396 passed (27 files) | — |
| `pnpm run build` | 55 notices verified; 20 precached files; dist check passed, including the font-leak guard; build ID `69b8618a0497ded6` | — |
| Bundle (`node docs/research/g-ui/measure-bundle.mjs`, gzip KiB) | Workspace JS 231.2 (budget 250), CSS 9.5 (budget 15), design-system JS 114.3 (budget 150); shell 16.2, workbench 114.8; unchanged since §7; all budgets met | 2.76 → 2.70 |
| Playwright, 3 engines: `ui-shell`, `ui-document`, `privacy`, `sw-update-lifecycle`, `workspace-offline` | **150 passed, 0 failed**, 3.3 min | 0.26 → 3.08 |

All Playwright runs used my own `vp preview` on port 4195, stopped afterwards; real Safari was not run.
