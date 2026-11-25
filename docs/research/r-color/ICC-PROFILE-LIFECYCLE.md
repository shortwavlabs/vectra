# R-COLOR-03 — ICC profile lifecycle

Status: research, 2026-11-25. Measurements: `experiments/r-color` ([REPRODUCING](REPRODUCING.md)). Desk sources are listed at the end, all accessed 2026-11-25.

**Provenance of desk research.** The desk-research claims in this document were gathered on 2026-11-25 by delegated research agents. They worked from public pages under this gate's rules: no logins, no personal data. Their full notes, with quotations, are kept outside the repository in the gate's shared notes folder (`r-color-research-*.md`).

The author re-read these primary sources directly:

- the veraPDF validation scope;
- the ICC-registry licence for PSO Coated v3;
- NVD CVE-2026-41254 and CVE-2026-42798;
- Gelato's PDF requirements (which corrected "required" to "should" for PDF/X-4);
- IngramSpark's file-creation guide;
- Firefox's `StaticPrefList.yaml` colour-management defaults.

Every other desk claim is agent-gathered and was not re-read. Measured results come from the prototypes and are reproducible ([REPRODUCING](REPRODUCING.md)).

## 1. Two kinds of profile, two lifecycles

| | **Input (source) profiles** | **Output profiles** |
|---|---|---|
| Arrive with | the user's image (PNG iCCP or cICP, JPEG APP2, WebP ICCP) | the user (printer or provider download), or bundled by Vectra |
| Used for | turning decoded pixels into the document's sRGB working values, once, at intake | turning document sRGB into device values, at each export |
| Lifetime | decode only; the original bytes (with the profile) are identified by the source digest | the export request, and optionally the project, by reference or embedded |
| Trust | untrusted file content | untrusted file content, even when the user chose it |

## 2. What the current pipeline does

`decodeImage` (`src/vectorization/intake.ts:146–187`) uses:

- `createImageBitmap(file, { colorSpaceConversion: "default", … })`;
- a 2D context with no `colorSpace` option (so `srgb`);
- `getImageData`.

The header sniffer reads no colour signalling. **No profile information reaches Vectra: it is either applied by the browser or discarded by it.** The original file bytes are hashed (`SourceAsset.digest`, `src/shell/jobs.ts:98`), so the profile stays recoverable from the original file through digest-verified relinking. It is not embedded in projects by default.

**Measured** (production options; [CURRENT-COLOR-ARCHITECTURE §4](CURRENT-COLOR-ARCHITECTURE.md); [artifacts/decode/browser-decode.json](artifacts/decode/browser-decode.json)):

- **macOS, default settings.** Chromium 159, WebKit 27.2 and Firefox 159 (with its default `gfx.color_management.mode` 2 and `rendering_intent` 0 restored) convert ICC- and cICP-tagged PNG and JPEG to sRGB. All three match Little CMS relative colorimetric to within 1 level. gAMA-only PNGs differ by up to 2 levels between engines.
- **Playwright's Firefox build** forces mode 0 (and rendering intent 3), so tagged images pass through unconverted. The repository's Playwright configuration sets no Firefox preferences, so its automated Firefox tests do not represent a default Firefox for tagged sources.
- **WebKit** ignores `colorSpaceConversion: "none"`. It always converts.

**From engine source and specifications (desk research, not reproduced):**

- **Spec.** The HTML spec leaves `"default"` implementation-specific. The canvas spec says images drawn into a canvas are converted to the canvas's colour space, and untagged images are treated as sRGB. `getImageData` uses relative colorimetric.
- **Firefox.** With mode 2, Firefox decodes tagged images to its *output* profile:
  - sRGB on macOS (`native_srgb`) and Wayland;
  - **the display profile on Windows and Linux/X11**.

  On those platforms the RGBA that Vectra traces would depend on the user's monitor profile. This needs a Windows wide-gamut test: **NOT RUN**.
- **CMYK JPEGs.**
  - Firefox ignores CMYK ICC profiles ("We don't currently support CMYK profiles") and inverts CMYK naively.
  - Chromium's handling is unclear.
  - Safari uses closed ImageIO.

  Cross-browser CMYK-JPEG decoding is therefore not reproducible.
- **PNG 3rd edition** precedence is cICP > iCCP > sRGB > cHRM+gAMA. Chromium ignores cICP unless it is full-range.

## 3. Proposed policy: explicit, not browser-defined

**Working colour space: sRGB (IEC 61966-2-1), 8-bit encoded, straight alpha.** This is already the engine's documented meaning (`color.rs:10`). The proposal makes it normative for Document v1 ([PROPOSED-RFC-AMENDMENTS](PROPOSED-RFC-AMENDMENTS.md) AM-C1).

**Intake classifies colour signalling from the header before decoding.** The header is already read for dimensions, so this is cheap and changes no pixels:

| Signal found | Class | P1 behaviour (browser decode, unchanged) | Proposed behaviour with a Vectra decoder |
|---|---|---|---|
| none | `untagged` | browser treats it as sRGB | **assume sRGB, and say so** in the import summary ("No colour profile: interpreted as sRGB"). Never silently |
| PNG `sRGB` chunk, or an ICC profile that is sRGB-equivalent | `srgb` | pass-through | pass-through |
| ICC RGB profile (not sRGB) or cICP | `rgb-profile` | browser converts (engine- and platform-dependent) | convert to sRGB in WASM with a pinned CMM, relative colorimetric, clipped; report the profile description, its digest, and the count of out-of-sRGB pixels |
| PNG gAMA / cHRM only | `legacy-gamma` | engines differ by ≤ 2 levels (measured) | convert using the stated gamma (and primaries, if present); warn |
| JPEG Adobe APP14 CMYK, with or without ICC | `cmyk` | engine-dependent (source-derived) | with ICC: convert CMYK → sRGB in WASM. Without ICC: **ask** the user for an assumed CMYK profile, or reject; never guess silently |
| Grey ICC | `gray-profile` | browser converts | convert to sRGB grey |
| malformed or unsupported profile | `invalid` | browser decides | reject the profile, ask "decode as untagged sRGB?", and record the choice |

- **This is a new `decodePolicy` value.** For example `"wasm-icc-srgb-v1"`, beside the existing `"browser-canvas-v1"`. C10 already requires a new enum value for any new decoder, and the TD-GEO-007 plan (P2-C) already calls for a deterministic WASM decoder. The colour step joins that work; it is not separate work.
- **Until then,** P1 keeps `browser-canvas-v1` exactly as it is. The text amendment documents what it does (AM-C2).
- **The signal class is informational.** It can live in the import UI and, from Document v2, in source provenance. The source digest already identifies the bytes, so the class can be re-derived whenever the original file is relinked. **No Document v1 field is needed.**

## 4. Output profiles

### 4.1 Identity and provenance

- **Identity.** A profile is identified by **the SHA-256 of its bytes**, the same rule as `SourceAsset.digest`. The ICC header profile ID (bytes 84–99, MD5) is optional and often zero, so it is recorded but never trusted.
- **Display name.** Taken from the profile's `desc` tag, sanitised and length-capped. It is never used as identity.
- **Provenance.** One of:
  - `bundled` (with the Vectra version);
  - `user-import`;
  - `registered-characterisation` (for example "FOGRA51") with the exact file the user supplied.

  No file names, paths or clocks are recorded, consistent with C7.

### 4.2 Where profiles live

| Option | Phase | Notes |
|---|---|---|
| Chosen per export, not persisted | **P2 first CMYK export** | Zero schema impact. The user re-selects on each export; offer an in-session last-used choice |
| Referenced by digest in project export presets | P2/P3 | Needs Document v2 fields (export presets). Missing profile → name the profile, ask to relink, verify the digest (the same flow as sources, RFC-002 §14) |
| Embedded in the project | later, opt-in | Needs a new `.vectra` section kind (`profile`) or a container version, because the kind set is closed (`container.ts:117`). Respect redistribution terms: embedding a third-party profile in a shared project is redistribution |
| Stored in browser storage (OPFS or IndexedDB) | later, opt-in | RFC-002 §14 excludes automatic artwork persistence; a profile library is the same kind of opt-in |

### 4.3 Bundling and licensing

- **sRGB needs no file.** Both candidate engines construct sRGB internally (moxcms `new_srgb`, Little CMS `cmsCreate_sRGBProfile`). Where a PDF must embed an sRGB profile, generate it at build time with the chosen engine and commit it as a small generated asset with provenance: about 600 bytes from Little CMS, 3 KB from Apple. No third-party licence applies to Vectra's own generated bytes. Record the generator and version. Both engines write the **current date and time** into the profile header (bytes 24–35, measured), so generate the profile once and commit it; never generate it at export time.
- **CMYK reference profiles.** FOGRA39, FOGRA51 and GRACoL profiles come from ECI, Idealliance, VIGC and JPMA under their own terms ([PDFX-FEASIBILITY §3](PDFX-FEASIBILITY.md)):
  - every licence found forbids alteration;
  - several forbid sale;
  - ECI's need written permission to redistribute.

  None can be relicensed under MIT. **Ship no CMYK profile.** Require user import, and link to the official download pages from the docs; never mirror the files. Any bundling needs a separate licence review by the maintainer.
- **Apple ColorSync profiles** (used locally in this research) are not ours to redistribute. None was committed; the artifacts record only their SHA-256 values.

### 4.4 Untrusted-profile validation (proposed)

**Measured:** 4,000 seeded corruptions of two valid profiles produced no crash or panic in moxcms 0.9.2 or Little CMS 2.20. But both accepted and *converted with* many structurally corrupt profiles ([ICC-ENGINE-EVALUATION §4.7](ICC-ENGINE-EVALUATION.md)). Vectra therefore validates before use, in the compute worker:

1. **Size cap.** 4 MiB to start: real CMYK output profiles are roughly 0.5–3 MB, and the local one is 55 KB. The cap is checked before reading.
2. **Structure.** Declared size equals the file length; `acsp` signature present; tag count ≤ 1,024; every tag in bounds. This is the bounds-checked reader prototyped as `inspect_icc`. It rejected 78 % and 65 % of the two mutation sets. On the same sets, moxcms parsed 38 % and 53 %, and Little CMS 71 % and 85 %.
3. **Allowlist.** Class `prtr` (output) or `mntr`/`scnr` (input). Colour space RGB, CMYK or GRAY. PCS Lab or XYZ. Version 2.x or 4.x. Device-link, abstract and named-colour classes are rejected in the first release.
4. **Required tags.** Output CMYK profiles need B2A0 or B2A1 for conversion and A2B0 or A2B1 for proofing and gamut warnings.
5. **Semantic sanity.**
   - Paper white (`#ffffff`) converts to Lab L* ≥ 90 with |a*|, |b*| ≤ 10.
   - Black converts to L* ≤ 35.
   - A grey ramp is monotonic in L*.
   - The round trip sRGB → device → Lab is finite everywhere.

   Failure gives a typed error naming the profile, never a silent fallback.
6. **Budget.** Parse and transform construction run in the compute worker under the job scheduler. Measured worst case is 7 ms per case, peak memory 5.7 MB for the whole run. Cache transforms by (profile digest, intent, engine version).

### 4.5 Offline availability

All of the above is local. No profile download is ever automatic. Documentation may link to official sources, which the user downloads with their own browser. The service-worker precache needs no change unless an sRGB profile asset is bundled (about 1 KB).

## 5. Browser colour management and reproducible tracing

The reproducibility promise (RFC-002 §13) is "identical decoded RGBA, versions and seed, and the same WASM build". The measurements show the decoded RGBA for a **tagged** source depends on all of these:

- the engine (gAMA ±2 levels);
- the platform (Firefox Windows and Linux: display profile, source-derived);
- user and automation preferences (Firefox mode 0 vs 2).

**Untagged and sRGB-tagged PNGs decoded identically** in every run.

Recommendations:

1. **Keep the promise as worded.** It is correct: it conditions on decoded RGBA.
2. **Show the signal class at import.** Display it, and warn when a tagged non-sRGB source is decoded by `browser-canvas-v1`: "colours depend on your browser's colour management".
3. **Make the WASM decoder (P2-C, TD-GEO-007) convert profiles itself.** That gives cross-browser identical RGBA for tagged sources, which the browser path cannot provide.
4. **Make browser tests explicit about Firefox colour management.** Set `gfx.color_management.mode` explicitly, so tagged-source tests are deliberate.

## Sources (accessed 2026-11-25)

- WHATWG HTML, ImageBitmap: <https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html>; canvas: <https://html.spec.whatwg.org/multipage/canvas.html>.
- CSS Color 4 (CRD 2026-11-23): <https://www.w3.org/TR/css-color-4/>. PNG 3rd edition (REC 2025-06-24): <https://www.w3.org/TR/png-3/>.
- Firefox source (main): <https://raw.githubusercontent.com/mozilla-firefox/firefox/main/modules/libpref/init/StaticPrefList.yaml>, `gfx/thebes/gfxPlatform.cpp`, `gfx/thebes/gfxWindowsPlatform.cpp`, `image/Decoder.cpp`, `image/decoders/nsJPEGDecoder.cpp`. Bugs: <https://bugzilla.mozilla.org/show_bug.cgi?id=867594>, <https://bugzilla.mozilla.org/show_bug.cgi?id=2080824>.
- Chromium source (main): `third_party/blink/renderer/modules/canvas/imagebitmap/image_bitmap_factories.cc`, `platform/image-decoders/`. Skia PNG codec: <https://raw.githubusercontent.com/google/skia/main/src/codec/SkPngRustCodec.cpp>.
- WebKit source (main): `Source/WebCore/html/ImageBitmap.cpp`. Blog posts: <https://webkit.org/blog/6682/improving-color-on-the-web/>, <https://webkit.org/blog/12058/wide-gamut-2d-graphics-using-html-canvas/>.
- wpt: <https://wpt.fyi/results/html/canvas/element/manual/imagebitmap/createImageBitmap-colorSpaceConversion.html?label=master&label=stable>. MDN compat data: <https://github.com/mdn/browser-compat-data>.
- Playwright Firefox preference: `playwright.cfg` line 103 in the installed Playwright Firefox build (`firefox-1572`), read locally.
