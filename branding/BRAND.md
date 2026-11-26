# Vectra brand

**Status:** the symbol ("Refined Minimal: Pixel to Path") and the G-BRAND integration are approved by the maintainer, subject to closure (PR #21). Normative UI rules stay in [DESIGN-SYSTEM](../docs/DESIGN-SYSTEM.md) and [RFC-002 §16](../docs/RFC-002.md). Report: [G-BRAND-REPORT](../docs/research/g-brand/G-BRAND-REPORT.md).

The symbol has no wordmark. Where the name appears next to it, it is typeset separately: "vectra" in the system font in the app's top bar, and in Inter SemiBold on the social banners.

## Canonical assets
The masters are editable vector SVGs: shapes only, with no `<image>`, raster data, text, fonts or styles. All six share the canonical geometry: the viewBox `0 13 453 343`, three pixel squares, two ribbon paths, two control handles (lines and r=11 circles) and two anchor squares. Only the colours differ.

| File | Colours | Use | SHA-256 |
|---|---|---|---|
| `vectra-symbol.svg` | charcoal + lime | **canonical**; light backgrounds | `fad9ae97a0a82349647f25b03283814c13700055f9a5da3c2521547333d7881a` (as supplied, 1,004 bytes) |
| `vectra-symbol-ivory.svg` | ivory + lime | dark backgrounds | `a80db5a3780811e6077ba17acfb5720fc569df3de300ced8d933bc06e71d96c7` |
| `vectra-symbol-mono-charcoal.svg` | charcoal | one colour, light backgrounds | `fb580f20375a0a951edb95b479dec6c8cc50a68c89c820f7263f0d45f5a102cf` |
| `vectra-symbol-mono-ivory.svg` | ivory | one colour, dark backgrounds | `1a6d2ba4ff0266cc619d4714264ab32b83cea23f8adc08533522530da0219e72` |
| `vectra-symbol-tonal-charcoal.svg` | charcoal + `#8c8d8e` | tonal, light backgrounds | `b155c9e4154e81c7446531f00d233f3e3509c319d5e9e1278d378d7a2def720b` |
| `vectra-symbol-tonal-ivory.svg` | ivory + `#84817a` | tonal, dark backgrounds | `02609a991ee238abf03033abf68582bd29ed81f70d8e8df621a86f04cdc0220f` |

- **The canonical file is the source of truth.** The five other masters (ivory, the two mono and the two tonal files) are generated from it by colour substitution only. The four colour masters are unchanged since review; the tonal files were added at closure. In the ivory variant, charcoal becomes ivory everywhere, including the anchor squares' stroke.
- **Never edit the geometry.** Do not redraw, retrace, simplify, re-path or optimise it. SVGO-style rewriting of path data is forbidden.

## Colours
| Name | Value | Matching UI token (DESIGN-SYSTEM §4) |
|---|---|---|
| Charcoal | `#191a1c` | `background` |
| Lime | `#b9e87b` | `primary` |
| Ivory | `#eee8d8` | `paper` |

The mark uses these brand values directly, not themed tokens. The app's top-bar mark is written with the literal hex values for that reason.

**Contrast** (WCAG relative luminance):

| Pair | Ratio |
|---|---|
| Charcoal on white | 17.41:1 |
| Charcoal on ivory | 14.24:1 |
| Ivory on charcoal | 14.24:1 |
| Ivory on the app's `panel` (#212224) | 13.02:1 |
| Lime on charcoal | 12.35:1 |
| Lime on white | 1.41:1 |
| Lime on ivory | 1.15:1 |

On light backgrounds, lime is an accent, not structure: charcoal carries the form.

## Light and dark
| Background | Use |
|---|---|
| White, ivory/paper, light greys | `vectra-symbol.svg` (canonical), `-mono-charcoal` or `-tonal-charcoal` |
| Charcoal, the app chrome, dark greys | `vectra-symbol-ivory.svg`, `-mono-ivory` or `-tonal-ivory` |
| Mid-tones, photographs, patterns | Place the symbol on a solid charcoal or ivory field first |

The app's top bar is dark (`panel`), so it uses the ivory + lime variant.

## Solid monochrome and tonal reproduction (approved)
Two kinds of one-colour reproduction exist; choose by what the medium can hold.
- **Solid monochrome** (`-mono-charcoal`, `-mono-ivory`): one flat ink. The two ribbon paths merge into one silhouette, and the anchor squares fuse with the ribbon tips and handle lines. The symbol stays recognisable as pixels, a curve and handles, but the two-tone ribbon is lost. Use it where only a single flat colour is possible (stamps, embossing, single-colour engraving or cutting).
- **Tonal reproduction** (`-tonal-charcoal`, `-tonal-ivory`): the ink plus an RGB tint of it for the inner ribbon, the middle pixel, the handles and the anchors' fill. The tints are `#8c8d8e` (charcoal at 50 % on white) and `#84817a` (ivory at 50 % on charcoal). The ribbon's two paths and the anchors stay distinct. Colour substitution only; the geometry is unchanged.
- **Tonal files are screen tints, not print-qualified separations.** They are RGB colours for screens and RGB documents. They are not qualified as physical single-ink separations (no halftone screen, ink, paper or press has been validated). A print job that needs one ink plus a screen must prepare and proof its own separation.

## Clear space
The unit is **A**, the anchor square's side: 29 units, or 6.4 % of the 453-unit symbol width.
- Keep at least **1 A** clear on every side of the visible geometry.
- The master files already include 16 units (0.55 A) of margin inside their viewBox. So when you place a master file of width *W*, keep at least **0.03 *W*** clear outside its edges.

## Minimum sizes
- **Screen:** at least **32 px wide** (24 px high) for the full symbol. The app's top-bar mark is exactly that size, and every element stays identifiable (header close-up in the report).
- **Below 32 px:** use only the favicon tile.
  - At 32 px the tile is legible, with the handles reduced to hairlines.
  - At 16 px it reduces to the ribbon's diagonal and one light block.
  - Omitting the handles changes almost nothing at 16 px (tested). A useful 16 px variant would need redrawn geometry, which is a design decision not taken here.
- **Print:** at least **15 mm wide**, so the handle stroke is 0.17 mm. This is derived from the geometry; it has not been print-tested.

## Social media
Files are in `social/`. None of them uses a gradient, illustration or claim.

| File | Size | Notes |
|---|---|---|
| `profile-1024.png`, `profile-512.png` | square | **Primary profile picture**: the ivory + lime symbol on charcoal, centred, no text. The geometry is 58 % of the side, and its corners sit at 72 % of the radius of a circular crop. Checked at 32, 48 and 64 px. |
| `x-banner-1500x500.png` (+ `.svg`) | 1500×500 | Lockup 507–993 × 175–325: clear of the avatar zone, inside a 40 px margin |
| `github-social-1280x640.png` (+ `.svg`) | 1280×640 | Repository social preview. Lockup 301–980 × 215–425: inside the 1.91:1 crop with a 40 px margin |
| `youtube-banner-2560x1440.png` (+ `.svg`) | 2560×1440 | Lockup 876–1684 × 595–845: inside the centred 1546×423 area |

**Banners.** A minimal horizontal lockup on charcoal: the ivory + lime symbol, then the lowercase wordmark "vectra" (Inter SemiBold) over the tagline "From pixels to paths." (Inter Regular), in ivory, with one restrained lime accent, the tagline's full stop.
- **Proportions** are fractions of the symbol's geometry height H (X 150 px, GitHub 210, YouTube 250): wordmark 0.54 H, tagline 0.168 H (so the tagline runs about as wide as the wordmark), symbol-to-text gap 0.26 H, wordmark baseline to tagline baseline 0.36 H.
- **Optical alignment:** the text starts at its ink (no side bearing), and the span from the wordmark's ink top to the tagline's baseline is centred on the symbol; descenders hang.
- **The wordmark is separate from the canonical symbol.** It is typeset next to it, never merged into the master files.
- **Safe areas**, checked by the generator in banner pixels:
  - X: clear of the avatar zone (x < 27 %, y > 60 %), inside a 40 px margin;
  - GitHub: inside the 1.91:1 crop (1222×640, centred) with a 40 px margin (69–1211 × 40–600);
  - YouTube: inside the centred 1546×423 area.
- **The `.svg` files** are the vector sources of the banner PNGs: the master's markup plus the glyph outlines as paths. They contain no `<text>` and no font software.

**Font (generation only).** Inter 4.1, SIL OFL 1.1, © 2016 The Inter Project Authors: `fonts/Inter-Regular.ttf` and `fonts/Inter-SemiBold.ttf`, unmodified. Source, checksums and approval are in `fonts/SOURCE.md`; the licence is `fonts/LICENSE.txt`.
- The generator checks both files byte for byte before use.
- The fonts never enter the runtime bundle, `public/`, `dist` or the precache: `scripts/check-dist.mjs` fails the build on any font file in `dist`, and on any `dist` file whose bytes match a file under `branding/`, other than the shipped icons.
- Proprietary system fonts must never be converted to outlines in distributable assets.
- **Publishing.** Nothing here has been published to any account.

## Favicons and app icons
Files are in `web/`. The subset the app ships is copied into `public/`.

| File | Use |
|---|---|
| `favicon.svg` | SVG favicon: the ivory + lime symbol on a rounded charcoal tile (radius 18.75 %, geometry 84 % of the side) |
| `favicon.ico` | 16 and 32 px, PNG-encoded entries |
| `favicon-16.png`, `favicon-32.png` | Raster favicons (not linked; the ICO carries both sizes) |
| `apple-touch-icon.png` | 180×180, full bleed; iOS rounds the corners |
| `icon-192.png`, `icon-512.png` | PWA icons (`any`): the favicon tile |
| `icon-maskable-512.png` | PWA maskable icon: full bleed, geometry inside the 80 % safe zone |

- **Why a tile.** The transparent symbol loses its charcoal parts on dark tab strips and its ivory parts on light ones. A tile reads on both.
- **No `<style>` or `prefers-color-scheme`.** The favicon SVG has neither: the site's CSP header is sent with it too.

## Incorrect usage
- Do not redraw, simplify, retrace, re-path, outline or optimise the geometry.
- Do not change its proportions:
  - no stretching or skewing;
  - no rotating;
  - no cropping into the geometry.
- Do not use colours outside the six masters. Do not swap lime for another accent.
- Do not add effects: no gradients, shadows, glows, strokes around the symbol or textures.
- Do not use the canonical file on dark backgrounds or the ivory variant on light ones. Never put a charcoal mono or tonal variant on dark, or an ivory one on light (they disappear; see the contact sheet).
- Do not present the tonal files as print-ready single-ink separations.
- Do not use the symbol below 32 px outside the favicon tile.
- Do not lock it up with a wordmark set in a proprietary font converted to outlines.
- Do not place it on busy imagery without a solid field.

## Rendering note (accepted)
The two ribbon paths share their first curve exactly. Anti-aliased renderers therefore show a faint hairline of the back path along the front path's outer edge: charcoal on the canonical file, ivory on the ivory variant. This is a property of the approved geometry, visible only at large sizes. The maintainer accepted it with the master geometry untouched.

## Decisions (maintainer, closure)
Approved, without changing behaviour:
- **Web manifest and early installability.** `display: standalone`, `start_url` `./workspace.html`; browsers may offer to install the app before ROADMAP's P3.
- **Local branding-asset exception to DESIGN-SYSTEM §6.** Local icon files and the manifest ship in `public/`; no fonts, remote assets or images in the UI itself.
- **Literal brand colours** in the app's mark, independent of theme tokens.
- **The privacy-test icon exemption:** `tests/browser/privacy.spec.ts` exempts exactly the four same-origin icon PNG URLs from its `.png` filename guard; its other assertions are unchanged.
- **The standalone rasteriser** (`branding/rasterize`, own lockfile), outside the runtime build: nothing under `branding/` enters `dist`, the `vite.config.ts` inputs or the service-worker precache, apart from the icons copied into `public/` (`scripts/check-dist.mjs` enforces it).
- **The MIME-type corrections** in the service-worker test origin (`tests/browser/sw-site.ts`).
- **The 16 px favicon** as shipped (canonical geometry).
- **Tonal variants** as official masters (above).

## Licensing and trademark (open: public-release decision)
The repository's MIT licence is unchanged, and no restrictive or trademark terms are added here. The Inter files under `fonts/` keep their own SIL OFL 1.1 licence. How the Vectra name and symbol may be used by others (logo licensing and any trademark clarification) is an open item to decide before public release.

## Reproducible generation
```bash
node branding/generate.mjs                     # every derived SVG and raster, the ICO and the public/ copies
git status --porcelain branding public         # empty after a re-run: byte-identical
```

**What the script does:**
- Verifies the canonical SHA-256 and derives the five other masters (three colour, two tonal). It checks they equal the canonical file byte for byte once each `#rrggbb` is masked, and that they are vector-only.
- Builds each composition by nesting a master's own markup in its viewBox, so no coordinate is retyped.
- Sets the banner text with HarfBuzz `hb-view` 15.x, given only the two vendored font files (`--font-file`; HarfBuzz has no font fallback). It shapes "vectra" and the tagline (kerning included) and writes their glyph outlines as SVG; the generator places them as paths.
  - It fails clearly if `hb-view` is missing or is not HarfBuzz 15.x.
  - It runs `hb-view` twice per string and fails unless the bytes match; it checks one glyph per character on one baseline.
  - It fails if a banner SVG contains `<text>`, `<style>`, `<image>`, `data:` or a font reference. The HarfBuzz version is recorded in each banner SVG.
- Renders with `branding/rasterize`, a standalone Rust crate on resvg 0.50.0.
  - Its lockfile resolves only to versions already in the root `Cargo.lock`.
  - It refuses any non-uniform scale and reports each output's size and the bounding box of its non-transparent pixels.
- Checks the exact sizes, the viewBox margin of every transparent export (nothing clipped or stretched), the circular safe zones and the banner safe areas (X avatar, GitHub crop, YouTube).
- Packs the ICO, and copies the shipped icons to `public/`.

**Tools:** Node 24.22.1, Rust 1.96.0 (`rust-toolchain.toml`), resvg/usvg 0.50.0, tiny-skia 0.12.0, png 0.18.1, HarfBuzz `hb-view` 15.2.0 (Homebrew), Inter 4.1.

**Evidence:** small-size checks go to `tests/output/g-brand/checks` (ignored by git). The contact sheet and app screenshots come from `docs/research/g-brand/evidence.mjs`.
