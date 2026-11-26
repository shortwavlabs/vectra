# Vectra brand

**Status:** the symbol ("Refined Minimal: Pixel to Path") is approved by the maintainer. Its integration (G-BRAND) is on a review branch and not yet accepted. Normative UI rules stay in [DESIGN-SYSTEM](../docs/DESIGN-SYSTEM.md) and [RFC-002 §16](../docs/RFC-002.md). Report: [G-BRAND-REPORT](../docs/research/g-brand/G-BRAND-REPORT.md).

The symbol has no wordmark. Where the name appears next to it, as in the app's top bar ("vectra"), the name is typeset separately in the system font.

## Canonical assets
The masters are editable vector SVGs: shapes only, with no `<image>`, raster data, text, fonts or styles. All four share the canonical geometry: the viewBox `0 13 453 343`, three pixel squares, two ribbon paths, two control handles (lines and r=11 circles) and two anchor squares. Only the colours differ.

| File | Colours | Use | SHA-256 |
|---|---|---|---|
| `vectra-symbol.svg` | charcoal + lime | **canonical**; light backgrounds | `fad9ae97a0a82349647f25b03283814c13700055f9a5da3c2521547333d7881a` (as supplied, 1,004 bytes) |
| `vectra-symbol-ivory.svg` | ivory + lime | dark backgrounds | `a80db5a3780811e6077ba17acfb5720fc569df3de300ced8d933bc06e71d96c7` |
| `vectra-symbol-mono-charcoal.svg` | charcoal | one colour, light backgrounds | `fb580f20375a0a951edb95b479dec6c8cc50a68c89c820f7263f0d45f5a102cf` |
| `vectra-symbol-mono-ivory.svg` | ivory | one colour, dark backgrounds | `1a6d2ba4ff0266cc619d4714264ab32b83cea23f8adc08533522530da0219e72` |

- **The canonical file is the source of truth.** The other three are generated from it by colour substitution only. In the ivory variant, charcoal becomes ivory everywhere, including the anchor squares' stroke.
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
| White, ivory/paper, light greys | `vectra-symbol.svg` (canonical) or `-mono-charcoal` |
| Charcoal, the app chrome, dark greys | `vectra-symbol-ivory.svg` or `-mono-ivory` |
| Mid-tones, photographs, patterns | Place the symbol on a solid charcoal or ivory field first |

The app's top bar is dark (`panel`), so it uses the ivory + lime variant.

## Monochrome (finding; decision pending)
Colour substitution alone has a cost in one colour. It merges the two ribbon paths into one silhouette, and fuses the anchor squares with the ribbon tips and handle lines. The symbol stays recognisable as pixels, a curve and handles, but the two-tone ribbon is lost. See the contact sheet.

The mono masters stay pure substitutions, as specified.

**Proposal for maintainer approval (not a master, not used anywhere):** `proposals/vectra-symbol-mono-*-tint.svg`. They are single-ink and two-tone: the lime parts become a 50 % screen of the ink, `#8c8d8e` (charcoal at 50 % on white) and `#84817a` (ivory at 50 % on charcoal). This is still colour substitution only, with no new geometry. It keeps the ribbon's two paths and the anchors distinct.

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
Files are in `social/`.
- Each one is the ivory + lime symbol on charcoal, centred, with no text.
- None of them uses a gradient, illustration or claim.

| File | Size | Notes |
|---|---|---|
| `profile-1024.png`, `profile-512.png` | square | **Primary profile picture.** The geometry is 58 % of the side, and its corners sit at 72 % of the radius of a circular crop. Checked at 32, 48 and 64 px. |
| `x-banner-1500x500.png` | 1500×500 | Centred, so it is clear of the avatar overlap at the bottom left. |
| `github-social-1280x640.png` | 1280×640 | Repository social preview. |
| `youtube-banner-2560x1440.png` | 2560×1440 | The geometry is 254 px high, within the 1546×423 centred safe area. |

- **Why there is no text.** The banners carry no text: this was the smallest compliant option.
  - Typesetting "Vectra" (or the README tagline "From pixels to paths.") deterministically needs a vendored font with a licence that permits it, for example an OFL font. That font needs maintainer approval.
  - Proprietary system fonts must not be converted to outlines in distributable assets.
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
- Do not use colours outside the four variants. Do not swap lime for another accent.
- Do not add effects: no gradients, shadows, glows, strokes around the symbol or textures.
- Do not use the canonical file on dark backgrounds or the ivory variant on light ones. Never put mono charcoal on dark or mono ivory on light (they disappear; see the contact sheet).
- Do not use the symbol below 32 px outside the favicon tile.
- Do not lock it up with a wordmark set in a proprietary font converted to outlines.
- Do not place it on busy imagery without a solid field.

## Rendering note
The two ribbon paths share their first curve exactly. Anti-aliased renderers therefore show a faint hairline of the back path along the front path's outer edge: charcoal on the canonical file, ivory on the ivory variant. This is a property of the approved geometry, visible only at large sizes, and it is left as supplied.

## Reproducible generation
```bash
node branding/generate.mjs                     # every derived SVG and raster, the ICO and the public/ copies
git status --porcelain branding public         # empty after a re-run: byte-identical
```

**What the script does:**
- Verifies the canonical SHA-256 and derives the three colour masters. It checks they equal the canonical file byte for byte once each `#rrggbb` is masked, and that they are vector-only.
- Builds each composition by nesting a master's own markup in its viewBox, so no coordinate is retyped.
- Renders with `branding/rasterize`, a standalone Rust crate on resvg 0.50.0.
  - Its lockfile resolves only to versions already in the root `Cargo.lock`.
  - It refuses any non-uniform scale and reports each output's size and the bounding box of its non-transparent pixels.
- Checks the exact sizes, the viewBox margin of every transparent export (nothing clipped or stretched), and the circular and YouTube safe zones.
- Packs the ICO, and copies the shipped icons to `public/`.

**Tools:** Node 24.22.1, Rust 1.96.0 (`rust-toolchain.toml`), resvg/usvg 0.50.0, tiny-skia 0.12.0, png 0.18.1.

**Evidence:** small-size checks go to `tests/output/g-brand/checks` (ignored by git). The contact sheet and app screenshots come from `docs/research/g-brand/evidence.mjs`.
