# R-COLOR-02 — ICC colour-management engines

Status: research, 2026-11-25. Desk research (sources below, all accessed 2026-11-25) plus isolated prototypes in `experiments/r-color/cmm` ([REPRODUCING](REPRODUCING.md)). No dependency is added to production.

**Provenance of desk research.** The desk-research claims in this document were gathered on 2026-11-25 by delegated research agents. They worked from public pages under this gate's rules: no logins, no personal data. Their full notes, with quotations, are kept outside the repository in the gate's shared notes folder (`r-color-research-*.md`).

The author re-read these primary sources directly:

- the veraPDF validation scope;
- the ICC-registry licence for PSO Coated v3;
- NVD CVE-2026-41254 and CVE-2026-42798;
- Gelato's PDF requirements (which corrected "required" to "should" for PDF/X-4);
- IngramSpark's file-creation guide;
- Firefox's `StaticPrefList.yaml` colour-management defaults.

Every other desk claim is agent-gathered and was not re-read. Measured results come from the prototypes and are reproducible ([REPRODUCING](REPRODUCING.md)).

## 1. Result

**Shortlist, not a final choice:**

- **moxcms 0.9.2** (pure Rust): the only candidate that builds for `wasm32-unknown-unknown` with the pinned toolchain today. Its RGB→CMYK output agrees closely with Little CMS on the one CMYK profile we could test locally. It lacks several prepress functions that Vectra would have to own or forgo.
- **Little CMS 2.20** (C, MIT): the most complete engine and the right **independent reference**. Shipping it in the browser needs a C-to-WASM toolchain (emscripten or wasi-sdk), which the project does not have.

**Final selection belongs to the P2 dependency gate.** It must be re-run with registered characterisation profiles (FOGRA51, GRACoL 2013) that have distinct per-intent tables. The only locally available CMYK profile shares one table across all intents (§4.1).

**Compiling a library to WASM does not qualify its colour accuracy.** We measured accuracy separately against two independent engines: Little CMS and Apple ColorSync.

## 2. Candidates (desk research)

| Capability | Little CMS 2.20 | `lcms2` 6.3.0 / `lcms2-sys` 4.2.0 | moxcms 0.9.2 | qcms 0.3.0 | skcms |
|---|---|---|---|---|---|
| Licence | MIT (core); `fast_float` and `threaded` plug-ins are GPL-3 | MIT / MIT | BSD-3-Clause OR Apache-2.0 | MIT (crates.io) | BSD-3-Clause |
| ICC v2 / v4 | yes / yes | yes (wraps C) | yes / yes | yes / yes | yes / yes |
| LUT tags (mft1/mft2/mAB/mBA) | yes | yes | yes | A2B0/B2A0 only | yes |
| RGB→CMYK (B2A) | yes (**measured**) | yes (**measured**) | yes (**measured**) | **no** | yes |
| CMYK→RGB / Lab | yes | yes | yes | to RGB8 only | yes |
| Four rendering intents | yes | yes | partial: absolute does not adapt the media white (**measured**, §4.3) | enum only | table priority only |
| Black-point compensation | yes | yes | **no** for CMYK, no user option (source: commented-out field; `bpc.rs` returns `None` for CMYK) | no | no |
| Gamut check / soft proof | yes / yes (**measured**) | yes | no / no | no | no |
| K-only / K-plane preservation | yes (CMYK→CMYK intents 10–15) | yes | no | no | no |
| Ink limiting / TAC detection | yes (`cmsCreateInkLimitingDeviceLink`, `cmsDetectTAC`) | yes | no | no | no |
| Writes profiles | yes | yes | yes (always writes a v4 header) | no | no |
| `wasm32-unknown-unknown` | no (needs libc: emscripten or wasi-sdk) | not attempted: the build script expects libc (UNVERIFIED by build) | **yes (measured)** | UNVERIFIED | UNVERIFIED |
| Fuzzing | OSS-Fuzz | inherits C | own nightly cargo-fuzz (not OSS-Fuzz) | OSS-Fuzz | OSS-Fuzz |
| Maintainers | effectively one (mm2: 1,122 commits; next 29) | one | effectively one (awxkee: 678; next 15) | Mozilla (in mozilla-central) | Google (Skia) |

**Not suitable for bundling:**

- **ArgyllCMS 3.5.0:** AGPL v3. It may be used only as an external test oracle.
- **iccDEV** (formerly DemoIccMAX), BSD-3-Clause, v2.4.2.6: the ICC reference implementation, with at least 100 GitHub security advisories in 2026. Use it offline, on trusted profiles only.
- **Apple ColorSync:** proprietary, macOS only. Test reference only.
- **`lcms-wasm` 1.0.5:** MIT, emscripten. It bundles a Little CMS commit from 2024-01-23, which predates the 2026 CVE fixes.
- **jsColorEngine 1.7.1:** MPL-2.0, pure JS, one maintainer. It *claims* 1-LSB agreement with Little CMS 2.20, from its own harness.

**Security record (2026):**

- **Little CMS:** CVE-2026-41254 (CubeSize integer overflow, ≤ 2.18) and CVE-2026-42798 (ParseCube overflow, 2.16–2.18, fixed in 2.19). The 2.20 release notes list a crash fix for malformed profiles.
- **Integration risk:** CVE-2026-1837 is a libjxl bug in how it *calls* lcms2. It shows that channel-count and buffer mismatches at the integration layer are their own risk.
- **Rust candidates:** no RustSec advisories for moxcms, lcms2 or qcms.

**Licensing:** all candidate cores are MIT-compatible for distribution in an MIT application with notices, except ArgyllCMS (AGPL) and the Little CMS GPL plug-ins. The Little CMS plug-in README was changed on 2026-11-24 to say commercial licences for plug-ins are no longer offered. Vectra must use core Little CMS only.

## 3. Prototype method

`experiments/r-color/cmm` is a standalone Cargo workspace excluded from the root build. It has its own lockfile and exact pins:

- `moxcms =0.9.2` with `default-features = false, features = ["lut"]`, plus feature switches for NEON paths and tetrahedral interpolation;
- `lcms2 =6.3.0` / `lcms2-sys 4.2.0` (vendored Little CMS 2.20, `LCMS_VERSION 2200`);
- `sips` (Apple ColorSync, macOS 26.6.2).

**Inputs:**

- a 257-patch corpus (`patches()` in `src/lib.rs`): primaries, a 17-step grey ramp, black, saturated and likely out-of-gamut colours, Vectra identity colours, skin and dark tones, and a 6×6×6 cube;
- macOS system profiles, used **in place and never copied**. Their SHA-256 values are in [artifacts/cmm/profiles.sha256](artifacts/cmm/profiles.sha256).

| Profile | Version / class | Tables |
|---|---|---|
| sRGB Profile.icc | 2.1.0 `mntr` RGB, XYZ PCS | matrix/shaper |
| Generic CMYK Profile.icc (55,280 B) | 2.2.0 `prtr` CMYK, Lab PCS | A2B0/1/2 and B2A0/1/2, **all three intents point to the same tag data**, plus `gamt` |
| Display P3.icc | 4.0.0 `mntr` | matrix/shaper |
| AdobeRGB1998.icc | 2.1.0 `mntr` | matrix/shaper |

**Metric:** CIEDE2000, implemented in the prototype and checked against Sharma, Wu and Dalal (2005) test pairs to 1e-4 (`cargo test`). Each engine's device values are mapped to D50 Lab by the reference engine (Little CMS, relative colorimetric), so CMYK differences become perceptual differences.

**Conditions:** load average 1.4–2.6 on a shared Apple M5 Max ([artifacts/conditions.txt](artifacts/conditions.txt)).

## 4. Measurements

### 4.1 sRGB → CMYK (Generic CMYK), relative colorimetric, without BPC

vs Little CMS float:

| Engine | ΔE00 mean | ΔE00 p95 | ΔE00 max | max ink difference | black → CMYK % | white → CMYK % |
|---|---|---|---|---|---|---|
| Little CMS 2.20 float (reference) | 0 | 0 | 0 | 0 | 72.5 / 70.5 / 64.4 / 86.6 | 0 / 0.4 / 0.4 / 0 |
| Little CMS + BPC | 0.37 | 1.11 | 1.93 | 8.2 % | 74.4 / 71.0 / 65.3 / 79.9 | 0 / 0.4 / 0.4 / 0 |
| moxcms f32, trilinear (default) | 0.046 | 0.149 | 0.673 | 2.9 % | 72.5 / 70.5 / 64.4 / 86.6 | 0 / 0.4 / 0.4 / 0 |
| moxcms f32, tetrahedral (`options` feature) | 0.031 | 0.101 | **0.281** | 1.2 % | same | same |
| moxcms 8-bit | 0.135 | 0.308 | 0.772 | 3.1 % | 72.5 / 70.6 / 64.3 / 86.7 | same |
| ColorSync (`sips`, 8-bit) | 0.345 | 0.850 | 1.266 | 2.2 % | 73.7 / 70.6 / 64.3 / 87.1 | **0 / 0 / 0 / 0** |

- **Engine agreement.** On this profile, moxcms is within 0.7 ΔE00 of Little CMS on all 257 patches, and within 0.3 with tetrahedral interpolation. ColorSync matches Little CMS *without* BPC more closely than with it: its black has K 87.1, against 86.6 without BPC and 79.9 with BPC.
- **Intents.** Perceptual, relative and saturation give identical numbers in every engine, because the profile shares one table. **Intent handling for CMYK is therefore NOT RUN.** It needs a profile with distinct per-intent tables.
- **White.** Both Little CMS and moxcms map sRGB white to 0.4 % M and Y; ColorSync maps it to 0 %. Vectra must own a "white stays unprinted" rule rather than rely on engine behaviour.
- **Total ink (TAC).** The maximum is 294 % for this profile.

### 4.2 Gamut

With Little CMS relative colorimetric, 183 of 257 patches have a source → CMYK colour difference above 2 ΔE00, 142 above 5 and 69 above 10. The worst are saturated violets, magentas and greens (up to 19.5 ΔE00).

Little CMS's own gamut check (proofing transform with GAMUT_CHECK and a distinct alarm colour) flags 182 patches. It agrees with the "ΔE00 > 2" rule on 240 of 257.

moxcms has no gamut check, but it can supply a round-trip ΔE: sRGB → CMYK, then CMYK → Lab with moxcms itself. A Vectra-owned warning can use that ([PRINT-QUALIFICATION-PLAN](PRINT-QUALIFICATION-PLAN.md) sets the threshold).

### 4.3 Absolute colorimetric

Little CMS adapts to the profile's media white: white → C 3.5 M 2.2 Y 0 K 0. moxcms and ColorSync do not; both differ from Little CMS by about 4.6 mean and 7.3 max ΔE00. Absolute colorimetric is a proofing intent, not an export intent. If it is ever offered, the engine choice changes its meaning.

### 4.4 RGB → RGB (matrix/shaper), relative colorimetric

vs Little CMS float:

| Conversion | moxcms f32 max ΔE00 | moxcms 8-bit max | ColorSync 8-bit max |
|---|---|---|---|
| sRGB → Display P3 | 0.033 | 0.432 | 0.432 |
| sRGB → Adobe RGB (1998) | 0.024 | 0.626 | 0.626 |

The 8-bit maxima are quantisation, not disagreement.

### 4.5 Native versus WASM determinism (moxcms)

The same moxcms code path was compiled for:

- aarch64 with NEON features;
- aarch64 scalar;
- `wasm32-unknown-unknown`, run in Node 24.22.1.

Source: [artifacts/cmm/wasm-check.json](artifacts/cmm/wasm-check.json).

| Path | Values | Bit-identical native vs WASM |
|---|---|---|
| sRGB → CMYK, 8-bit output | 4 intents × 1,028 | **1,028 / 1,028** (NEON and scalar native) |
| sRGB → CMYK, 16-bit output | 4 × 1,028 | 1,026 / 1,028 (two values differ by 1 LSB) |
| sRGB → CMYK, f32 output | 4 × 1,028 | 356 / 1,028 (max \|Δ\| 4.8 × 10⁻⁷) |
| sRGB → P3 / Adobe RGB, f32 | 771 | 771 / 771 |

**Root cause of the f32 difference:** moxcms's `mlaf` helper uses fused multiply-add when the target has NEON (aarch64) or x86 FMA, and separate multiply-and-add otherwise (`src/mlaf.rs`). wasm32 never fuses.

- **Native builds agree.** NEON and scalar aarch64 builds are bit-identical to each other, because both fuse.
- **Upstream position.** Upstream issue #192 reports 8-bit differences between x86_64 and aarch64; the maintainer does not treat cross-architecture identity as a goal.

**Consequence.** The repository's determinism promise is per target (TD-PLATFORM-007). Any export conversion must therefore:

1. run in one place (the WASM worker) for user exports;
2. quantise device values to a fixed integer grid before they reach a writer;
3. be regression-tested natively against WASM with a stated tolerance (1 LSB at 16-bit). Do not assume byte identity.

### 4.6 Size and speed (WASM)

| Item | Bytes |
|---|---|
| Prototype cdylib (moxcms 8/16-bit + f32, RGB and CMYK paths, C ABI wrapper) | 458,048 raw · 144,521 gzip -9 · 119,395 brotli 11 |
| Empty cdylib with an allocator, same profile settings | 16,650 raw |
| Production `vector_engine_wasm_bg.wasm` (this baseline) | 646,325 raw |

The colour engine would add roughly 440 KB raw (about 115 KB brotli) to the engine module, or about 68 % of its current raw size. A production build would expose fewer paths. Feature-gating the f32 and 16-bit paths is a measurable optimisation, not yet measured.

**Speed.** One sRGB → CMYK f32 conversion of 1,048,576 pixels, including transform construction, took **35–38 ms** in WASM (Node 24.22.1, three runs, load average 2.0–2.5). Linear memory grew to 53 MB, dominated by the test buffers.

### 4.7 Malformed profiles

A seeded, reproducible mutation set was applied to two bases: a Little CMS-generated sRGB v4 profile and the local CMYK LUT profile. Mutations covered truncation, bit flips, tag offsets and sizes, tag count, declared size and tag-body bytes. The set is 2,000 cases per base, so it is **not** a fuzz campaign. Source: [artifacts/fuzz/icc-fuzz.json](artifacts/fuzz/icc-fuzz.json).

| Base | Rejected by Vectra-style structural check | moxcms parsed / converted / panics | Little CMS parsed / converted / crashes | slowest case |
|---|---|---|---|---|
| sRGB v4 (588 B) | 1,558 | 769 / 651 / **0** | 1,421 / 801 / **0** | 1 ms |
| CMYK LUT (55,280 B) | 1,295 | 1,059 / 1,059 / **0** | 1,692 / 1,435 / **0** | 7 ms |

Peak resident memory for the whole run was 5.7 MB.

**Neither engine crashed or panicked, but both accepted and *used* many structurally corrupted profiles.** A corrupted profile does not fail; it silently produces wrong colours. Untrusted printer profiles therefore need Vectra-owned validation before use. That means structure, a size cap, class and colour-space checks, and a neutral-axis sanity check ([ICC-PROFILE-LIFECYCLE §4.4](ICC-PROFILE-LIFECYCLE.md)).

## 5. Assessment against the brief

| Criterion | moxcms 0.9.2 | Little CMS 2.20 |
|---|---|---|
| v2/v4, LUT profiles | yes | yes |
| RGB→RGB, RGB→CMYK, CMYK→RGB | yes | yes |
| Rendering intents | perceptual, relative, saturation; absolute without media-white adaptation | all four |
| BPC | **no** for CMYK | yes |
| Gamut check | no; Vectra can compute a round-trip ΔE | yes |
| Neutral / black preservation | no; Vectra needs explicit palette overrides | K-only and K-plane, for CMYK→CMYK only |
| Total ink | no; Vectra sums channels | detection plus ink-limiting device links |
| Determinism | per target; 8-bit integer path bit-identical native↔WASM on our corpus | not measured across targets (NOT RUN) |
| Native Rust | yes | via FFI (C) |
| Browser WASM | yes (measured, Node) | needs emscripten or wasi-sdk (NOT RUN) |
| Runtime memory | small (measured, §4.6–4.7) | not measured in WASM |
| Bundle impact | about 440 KB raw, about 115 KB brotli (prototype) | not measured |
| Maintenance | one maintainer, very active, fast-moving LUT fixes | one maintainer, 30-year record, OSS-Fuzz |
| Licence | BSD-3-Clause OR Apache-2.0 | MIT (core only) |
| Malformed profiles | no panic in 4,000 cases; accepts corrupt data | no crash in 4,000 cases; accepts corrupt data |

**Explicitly unsupported by moxcms, needed for professional print, and therefore owned by Vectra or deferred:**

- BPC;
- soft-proof and gamut-check transforms;
- K-only black generation for RGB sources;
- ink limiting;
- named-colour profiles.

**Recommendation for the P2 dependency gate:**

1. **Engine.** moxcms (exact pin, with the `options` feature for tetrahedral interpolation) is the candidate for in-browser export conversion. Use it with relative colorimetric (and perceptual where the profile differs), integer outputs, and explicit Vectra overrides for black, white and spot inks.
2. **Reference.** Little CMS 2.20 is the native, test-only reference. ColorSync is a second, independent reference on macOS.
3. **Fallback.** Re-open the Little-CMS-in-WASM option (emscripten or wasi-sdk) only if a provider qualification shows that BPC or ink limiting are required for acceptance.

## Sources (accessed 2026-11-25)

- Little CMS releases <https://api.github.com/repos/mm2/Little-CMS/releases>; header <https://raw.githubusercontent.com/mm2/Little-CMS/master/include/lcms2.h>; plug-in licence <https://raw.githubusercontent.com/mm2/Little-CMS/master/plugins/README.1ST>; contributors <https://api.github.com/repos/mm2/Little-CMS/contributors>.
- CVEs: <https://nvd.nist.gov/vuln/detail/CVE-2026-41254>, <https://nvd.nist.gov/vuln/detail/CVE-2026-42798>, <https://nvd.nist.gov/vuln/detail/CVE-2025-29069>, <https://nvd.nist.gov/vuln/detail/CVE-2026-1837>.
- lcms2 / lcms2-sys: <https://crates.io/api/v1/crates/lcms2>, <https://crates.io/api/v1/crates/lcms2-sys>, <https://docs.rs/crate/lcms2-sys/4.2.0/source/vendor/include/lcms2.h>, <https://raw.githubusercontent.com/kornelski/rust-lcms2-sys/main/src/build.rs>, <https://raw.githubusercontent.com/kornelski/rust-lcms2/main/src/flags.rs>.
- moxcms: <https://crates.io/api/v1/crates/moxcms>, <https://docs.rs/crate/moxcms/0.9.2/source/src/conversions/bpc.rs>, <https://github.com/awxkee/moxcms/issues/162>, <https://github.com/awxkee/moxcms/issues/144>, <https://github.com/awxkee/moxcms/issues/192>, <https://raw.githubusercontent.com/awxkee/moxcms/master/src/mlaf.rs>, <https://raw.githubusercontent.com/awxkee/moxcms/master/.github/workflows/nightly_fuzzing.yml>, <https://raw.githubusercontent.com/awxkee/moxcms/master/.github/workflows/build_push.yml>. The pinned crate source was also read locally (`~/.cargo/registry/src/*/moxcms-0.9.2`).
- qcms: <https://raw.githubusercontent.com/FirefoxGraphics/qcms/main/src/transform.rs>, <https://raw.githubusercontent.com/google/oss-fuzz/master/projects/qcms/project.yaml>.
- skcms: <https://skia.googlesource.com/skcms/+/refs/heads/main/src/skcms_public.h>.
- iccDEV: <https://github.com/InternationalColorConsortium/iccDEV/security/advisories>. ArgyllCMS: <https://www.argyllcms.com/doc/ArgyllDoc.html>. ColorSync: <https://developer.apple.com/documentation/colorsync/kcolorsyncblackpointcompensation>.
- WASM ports: <https://github.com/mattdesl/lcms-wasm>, <https://registry.npmjs.org/@kittl/little-cms>, <https://github.com/glennwilton/jsColorEngine>.
