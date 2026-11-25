//! Three-engine ICC comparison: moxcms 0.9.2 (pure Rust), Little CMS 2.20 (C, via lcms2-sys,
//! the reference) and Apple ColorSync (through `sips`, run by run-cmm.sh).
//!
//!   cmm_compare chart <out.png>                 untagged 1-row chart of the patch corpus
//!   cmm_compare compare <sips-dir> <out-dir>    writes cmm-comparison.json, cmm-patches.csv,
//!                                               moxcms-native.json (bit-exact moxcms outputs)
//!
//! Profiles are read from the paths in the environment (RC_SRGB, RC_CMYK, RC_P3, RC_ADOBE).
//! They are local system files and are never copied into the repository.

use std::fmt::Write as _;
use std::fs;

use lcms2::{CIExyY, Flags, Intent, PixelFormat, Profile, ThreadContext, Transform};
use r_color_cmm::{ciede2000, inspect_icc, moxcms_convert, patches};
use serde_json::{Value, json};

const INTENTS: [(u32, &str, Intent); 4] = [
    (0, "perceptual", Intent::Perceptual),
    (1, "relative", Intent::RelativeColorimetric),
    (2, "saturation", Intent::Saturation),
    (3, "absolute", Intent::AbsoluteColorimetric),
];

fn env_path(k: &str) -> String {
    std::env::var(k).unwrap_or_else(|_| panic!("{k} must name an ICC profile file"))
}

fn lab_profile() -> Profile {
    Profile::new_lab4_context(
        lcms2::GlobalContext::new(),
        &CIExyY {
            x: 0.3457,
            y: 0.3585,
            Y: 1.0,
        },
    )
    .unwrap()
}

/// Lab (D50) of device values through the reference engine, relative colorimetric.
fn to_lab_cmyk(cmyk: &Profile, v: &[[f32; 4]]) -> Vec<[f64; 3]> {
    let t: Transform<[f32; 4], [f64; 3]> = Transform::new(
        cmyk,
        PixelFormat::CMYK_FLT,
        &lab_profile(),
        PixelFormat::Lab_DBL,
        Intent::RelativeColorimetric,
    )
    .unwrap();
    let mut out = vec![[0f64; 3]; v.len()];
    t.transform_pixels(v, &mut out);
    out
}

fn to_lab_rgb(rgb: &Profile, v: &[[f32; 3]]) -> Vec<[f64; 3]> {
    let t: Transform<[f32; 3], [f64; 3]> = Transform::new(
        rgb,
        PixelFormat::RGB_FLT,
        &lab_profile(),
        PixelFormat::Lab_DBL,
        Intent::RelativeColorimetric,
    )
    .unwrap();
    let mut out = vec![[0f64; 3]; v.len()];
    t.transform_pixels(v, &mut out);
    out
}

fn stats(d: &[f64]) -> Value {
    let mut s = d.to_vec();
    s.sort_by(f64::total_cmp);
    let mean = s.iter().sum::<f64>() / s.len() as f64;
    let p95 = s[((s.len() as f64 * 0.95).ceil() as usize).min(s.len()) - 1];
    json!({ "mean": r4(mean), "p95": r4(p95), "max": r4(*s.last().unwrap()) })
}

fn r4(v: f64) -> f64 {
    (v * 10_000.0).round() / 10_000.0
}

fn read_tiff(path: &str) -> Option<(Vec<u8>, String)> {
    let f = fs::File::open(path).ok()?;
    let mut d = tiff::decoder::Decoder::new(f).ok()?;
    let ct = format!("{:?}", d.colortype().ok()?);
    match d.read_image().ok()? {
        tiff::decoder::DecodingResult::U8(v) => Some((v, ct)),
        _ => None,
    }
}

fn write_chart(path: &str) {
    let p = patches();
    let mut data = Vec::with_capacity(p.len() * 3);
    for x in &p {
        data.extend_from_slice(&x.rgb);
    }
    let f = fs::File::create(path).unwrap();
    let mut e = png::Encoder::new(f, p.len() as u32, 1);
    e.set_color(png::ColorType::Rgb);
    e.set_depth(png::BitDepth::Eight);
    e.write_header().unwrap().write_image_data(&data).unwrap();
}

fn cmyk4(v: &[f32], scale: f32) -> Vec<[f32; 4]> {
    v.chunks_exact(4)
        .map(|c| [c[0] * scale, c[1] * scale, c[2] * scale, c[3] * scale])
        .collect()
}

fn compare(sips_dir: &str, out_dir: &str) {
    let (srgb_p, cmyk_p, p3_p, adobe_p) = (
        env_path("RC_SRGB"),
        env_path("RC_CMYK"),
        env_path("RC_P3"),
        env_path("RC_ADOBE"),
    );
    let srgb_b = fs::read(&srgb_p).unwrap();
    let cmyk_b = fs::read(&cmyk_p).unwrap();
    let srgb = Profile::new_icc(&srgb_b).unwrap();
    let cmyk = Profile::new_icc(&cmyk_b).unwrap();
    let pts = patches();
    let rgb: Vec<[u8; 3]> = pts.iter().map(|p| p.rgb).collect();
    let flat: Vec<u8> = rgb.iter().flatten().copied().collect();
    let idx = |n: &str| pts.iter().position(|p| p.name == n).unwrap();
    let watch = [
        "black",
        "near-black",
        "grey-128",
        "white",
        "vectra-charcoal",
        "vectra-lime",
        "blue",
        "cyan",
    ];

    let mut profiles = json!({});
    for (k, path) in [("srgb", &srgb_p), ("cmyk", &cmyk_p), ("p3", &p3_p), ("adobe", &adobe_p)] {
        let b = fs::read(path).unwrap();
        let s = inspect_icc(&b).unwrap();
        profiles[k] = json!({ "file": path.rsplit('/').next(), "bytes": b.len(), "version": s.version,
            "class": s.class, "colorSpace": s.color_space, "pcs": s.pcs,
            "tags": s.tags.iter().map(|t| t.0.clone()).collect::<Vec<_>>() });
    }

    // Reference Lab of the source patches (sRGB, relative colorimetric to D50).
    let src_lab = to_lab_rgb(
        &srgb,
        &rgb.iter().map(|c| c.map(|v| f32::from(v) / 255.0)).collect::<Vec<_>>(),
    );

    let mut cases = Vec::new();
    let mut csv = String::from("intent,patch,r,g,b,engine,c,m,y,k,tac,dE00_vs_lcms,gamut_dE00,lcms_gamut_alarm\n");
    let mut native_bits = json!({ "inputRgb": flat.clone(), "simd": cfg!(feature = "simd") });

    // lcms gamut check (proofing transform, alarm colour (1,254,3)) for relative colorimetric.
    let mut ctx = ThreadContext::new();
    let mut alarm = [0u16; 16];
    alarm[0] = 0x0101; // 8-bit exact (v * 257)
    alarm[1] = 0xFEFE;
    alarm[2] = 0x0303;
    ctx.set_alarm_codes(alarm);
    let srgb_c = Profile::new_icc_context(&ctx, &srgb_b).unwrap();
    let cmyk_c = Profile::new_icc_context(&ctx, &cmyk_b).unwrap();
    let gc: Transform<[u8; 3], [u8; 3], ThreadContext> = Transform::new_proofing_context(
        &ctx,
        &srgb_c,
        PixelFormat::RGB_8,
        &srgb_c,
        PixelFormat::RGB_8,
        &cmyk_c,
        Intent::RelativeColorimetric,
        Intent::RelativeColorimetric,
        Flags::GAMUT_CHECK | Flags::SOFT_PROOFING,
    )
    .unwrap();
    let mut proof = vec![[0u8; 3]; rgb.len()];
    gc.transform_pixels(&rgb, &mut proof);
    let alarmed: Vec<bool> = proof.iter().map(|p| *p == [1, 254, 3]).collect();

    for (code, name, intent) in INTENTS {
        let mut engines: Vec<(String, Vec<[f32; 4]>)> = Vec::new();
        for bpc in [false, true] {
            let flags = if bpc {
                Flags::BLACKPOINT_COMPENSATION
            } else {
                Flags::default()
            };
            let t: Transform<[u8; 3], [f32; 4]> =
                Transform::new_flags(&srgb, PixelFormat::RGB_8, &cmyk, PixelFormat::CMYK_FLT, intent, flags).unwrap();
            let mut out = vec![[0f32; 4]; rgb.len()];
            t.transform_pixels(&rgb, &mut out);
            engines.push((format!("lcms-float{}", if bpc { "-bpc" } else { "" }), out));
        }
        match moxcms_convert(&srgb_b, &cmyk_b, 4, code, false, 0, &flat) {
            Ok(v) => {
                native_bits[format!("cmyk-f32-{name}")] =
                    json!(v.iter().map(|f| format!("{:08x}", f.to_bits())).collect::<Vec<_>>());
                engines.push(("moxcms-f32".into(), cmyk4(&v, 100.0)));
            }
            Err(e) => eprintln!("moxcms f32 {name}: {e}"),
        }
        if let Ok(v) = moxcms_convert(&srgb_b, &cmyk_b, 4, code, true, 16, &flat) {
            native_bits[format!("cmyk-u16-{name}")] = json!(v.iter().map(|f| *f as u16).collect::<Vec<_>>());
            engines.push(("moxcms-u16".into(), cmyk4(&v, 100.0 / 65535.0)));
        }
        match moxcms_convert(&srgb_b, &cmyk_b, 4, code, true, 8, &flat) {
            Ok(v) => {
                native_bits[format!("cmyk-u8-{name}")] = json!(v.iter().map(|f| *f as u8).collect::<Vec<_>>());
                engines.push(("moxcms-u8".into(), cmyk4(&v, 100.0 / 255.0)));
            }
            Err(e) => eprintln!("moxcms u8 {name}: {e}"),
        }
        let sips_ct = match read_tiff(&format!("{sips_dir}/sips-cmyk-{name}.tif")) {
            Some((v, ct)) if v.len() == rgb.len() * 4 => {
                let f: Vec<f32> = v.iter().map(|&b| f32::from(b)).collect();
                engines.push(("colorsync-sips-u8".into(), cmyk4(&f, 100.0 / 255.0)));
                ct
            }
            other => format!("unavailable ({:?})", other.map(|o| o.1)),
        };
        let reference = engines[0].1.clone();
        let ref_lab = to_lab_cmyk(&cmyk, &reference);
        let mut per_engine = json!({});
        for (en, vals) in &engines {
            let lab = to_lab_cmyk(&cmyk, vals);
            let de: Vec<f64> = lab.iter().zip(&ref_lab).map(|(a, b)| ciede2000(*a, *b)).collect();
            let gamut: Vec<f64> = lab.iter().zip(&src_lab).map(|(a, b)| ciede2000(*a, *b)).collect();
            let chan = vals
                .iter()
                .zip(&reference)
                .flat_map(|(a, b)| (0..4).map(move |i| f64::from((a[i] - b[i]).abs())))
                .fold(0f64, f64::max);
            let tac: Vec<f64> = vals.iter().map(|c| f64::from(c.iter().sum::<f32>())).collect();
            let mut w = json!({});
            for n in watch {
                let c = vals[idx(n)];
                w[n] = json!(c.map(|v| (f64::from(v) * 10.0).round() / 10.0));
            }
            per_engine[en] = json!({
                "dE00VsLcmsFloat": stats(&de),
                "maxChannelDiffPercentInk": r4(chan),
                "tacMaxPercent": r4(tac.iter().copied().fold(0.0, f64::max)),
                "gamutMappingDE00VsSource": stats(&gamut),
                "watchCmykPercent": w,
            });
            for (i, p) in pts.iter().enumerate() {
                let c = vals[i];
                let _ = writeln!(
                    csv,
                    "{name},{},{},{},{},{en},{:.2},{:.2},{:.2},{:.2},{:.2},{:.4},{:.4},{}",
                    p.name, p.rgb[0], p.rgb[1], p.rgb[2], c[0], c[1], c[2], c[3], tac[i], de[i], gamut[i], alarmed[i]
                );
            }
        }
        cases.push(json!({ "conversion": "sRGB -> CMYK", "intent": name, "sipsTiffColorType": sips_ct, "engines": per_engine }));
    }

    // Gamut summary: relative colorimetric, lcms reference.
    let t: Transform<[u8; 3], [f32; 4]> = Transform::new(
        &srgb,
        PixelFormat::RGB_8,
        &cmyk,
        PixelFormat::CMYK_FLT,
        Intent::RelativeColorimetric,
    )
    .unwrap();
    let mut rel = vec![[0f32; 4]; rgb.len()];
    t.transform_pixels(&rgb, &mut rel);
    let gde: Vec<f64> = to_lab_cmyk(&cmyk, &rel)
        .iter()
        .zip(&src_lab)
        .map(|(a, b)| ciede2000(*a, *b))
        .collect();
    let mut worst: Vec<(f64, &str)> = gde.iter().zip(&pts).map(|(d, p)| (*d, p.name.as_str())).collect();
    worst.sort_by(|a, b| b.0.total_cmp(&a.0));
    let gamut = json!({
        "patches": pts.len(),
        "lcmsGamutAlarm": alarmed.iter().filter(|a| **a).count(),
        "roundTripDE00Over2": gde.iter().filter(|d| **d > 2.0).count(),
        "roundTripDE00Over5": gde.iter().filter(|d| **d > 5.0).count(),
        "roundTripDE00Over10": gde.iter().filter(|d| **d > 10.0).count(),
        "alarmAndOver2Agree": gde.iter().zip(&alarmed).filter(|(d, a)| (**d > 2.0) == **a).count(),
        "worst": worst.iter().take(8).map(|(d, n)| json!({ "patch": n, "dE00": r4(*d) })).collect::<Vec<_>>(),
    });

    // RGB -> RGB (matrix/shaper): sRGB -> Display P3 and Adobe RGB, relative colorimetric.
    let mut rgb_cases = Vec::new();
    for (key, path) in [("p3", &p3_p), ("adobe", &adobe_p)] {
        let db = fs::read(path).unwrap();
        let dp = Profile::new_icc(&db).unwrap();
        let t: Transform<[u8; 3], [f32; 3]> = Transform::new(
            &srgb,
            PixelFormat::RGB_8,
            &dp,
            PixelFormat::RGB_FLT,
            Intent::RelativeColorimetric,
        )
        .unwrap();
        let mut lc = vec![[0f32; 3]; rgb.len()];
        t.transform_pixels(&rgb, &mut lc);
        let mut engines: Vec<(String, Vec<[f32; 3]>)> = vec![("lcms-float".into(), lc)];
        if let Ok(v) = moxcms_convert(&srgb_b, &db, 3, 1, false, 0, &flat) {
            native_bits[format!("{key}-f32-relative")] =
                json!(v.iter().map(|f| format!("{:08x}", f.to_bits())).collect::<Vec<_>>());
            engines.push((
                "moxcms-f32".into(),
                v.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect(),
            ));
        }
        if let Ok(v) = moxcms_convert(&srgb_b, &db, 3, 1, true, 8, &flat) {
            engines.push((
                "moxcms-u8".into(),
                v.chunks_exact(3)
                    .map(|c| [c[0] / 255.0, c[1] / 255.0, c[2] / 255.0])
                    .collect(),
            ));
        }
        if let Some((v, _)) = read_tiff(&format!("{sips_dir}/sips-{key}-relative.tif")) {
            if v.len() == rgb.len() * 3 {
                engines.push((
                    "colorsync-sips-u8".into(),
                    v.chunks_exact(3)
                        .map(|c| [c[0], c[1], c[2]].map(|b| f32::from(b) / 255.0))
                        .collect(),
                ));
            }
        }
        let ref_lab = to_lab_rgb(&dp, &engines[0].1);
        let mut per = json!({});
        for (en, vals) in &engines {
            let de: Vec<f64> = to_lab_rgb(&dp, vals)
                .iter()
                .zip(&ref_lab)
                .map(|(a, b)| ciede2000(*a, *b))
                .collect();
            per[en] = json!({ "dE00VsLcmsFloat": stats(&de) });
        }
        rgb_cases.push(json!({ "conversion": format!("sRGB -> {key}"), "intent": "relative", "engines": per }));
    }

    let out = json!({
        "tool": "experiments/r-color/cmm cmm_compare",
        "engines": { "moxcms": "0.9.2 (lut + NEON features as built)", "littleCms": lcms2::version(),
                     "colorsync": "macOS sips (version recorded by run-cmm.sh)" },
        "simdFeature": cfg!(feature = "simd"),
        "profiles": profiles,
        "cmyk": cases,
        "gamutRelativeColorimetric": gamut,
        "rgbToRgb": rgb_cases,
        "notes": [
            "dE00 is computed in D50 Lab through Little CMS (relative colorimetric) from each engine's device values.",
            "colorsync-sips-u8 and moxcms-u8 are 8-bit outputs; lcms-float and moxcms-f32 are float.",
            "gamutMappingDE00VsSource compares the converted colour with the source sRGB colour (both D50, relative)."
        ]
    });
    fs::write(
        format!("{out_dir}/cmm-comparison.json"),
        serde_json::to_string_pretty(&out).unwrap() + "\n",
    )
    .unwrap();
    fs::write(format!("{out_dir}/cmm-patches.csv"), csv).unwrap();
    fs::write(
        format!("{out_dir}/moxcms-native.json"),
        serde_json::to_string(&native_bits).unwrap() + "\n",
    )
    .unwrap();
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    match a.get(1).map(String::as_str) {
        Some("chart") => write_chart(&a[2]),
        Some("compare") => compare(&a[2], &a[3]),
        _ => eprintln!("usage: cmm_compare chart <out.png> | compare <sips-dir> <out-dir>"),
    }
}
