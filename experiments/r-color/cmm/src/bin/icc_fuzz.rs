//! R-COLOR-03 untrusted-profile probe: deterministic structural mutations of two valid profiles
//! (a Little CMS-generated sRGB v4 profile and the local CMYK LUT profile in RC_CMYK), fed to
//! the bounds-checked `inspect_icc`, moxcms (panics caught) and Little CMS (in process).
//! Not a fuzzer: a fixed, seeded mutation set so the counts are reproducible.
//! Usage: icc_fuzz <out.json> [cases-per-profile]

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::time::Instant;

use lcms2::{Intent, PixelFormat, Profile, Transform};
use r_color_cmm::{inspect_icc, moxcms_convert, patches};
use serde_json::json;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
}

fn mutate(src: &[u8], rng: &mut Rng) -> (String, Vec<u8>) {
    let mut b = src.to_vec();
    let n = b.len();
    let tags = u32::from_be_bytes([b[128], b[129], b[130], b[131]]) as usize;
    match rng.next() % 6 {
        0 => {
            let cut = 1 + (rng.next() as usize % (n - 1));
            b.truncate(cut);
            ("truncate".into(), b)
        }
        1 => {
            for _ in 0..1 + rng.next() % 16 {
                let i = rng.next() as usize % n;
                b[i] ^= 1 << (rng.next() % 8);
            }
            ("bit-flips".into(), b)
        }
        2 => {
            let k = rng.next() as usize % tags.max(1);
            let at = 132 + k * 12 + 4 + 4 * (rng.next() % 2) as usize;
            b[at..at + 4].copy_from_slice(&(rng.next() as u32).to_be_bytes());
            ("tag-offset-or-size".into(), b)
        }
        3 => {
            b[128..132].copy_from_slice(&((rng.next() % 100_000) as u32).to_be_bytes());
            ("tag-count".into(), b)
        }
        4 => {
            b[0..4].copy_from_slice(&(rng.next() as u32).to_be_bytes());
            ("declared-size".into(), b)
        }
        _ => {
            // Corrupt bytes inside a random tag body (LUT dimensions, curve counts, …).
            let k = rng.next() as usize % tags.max(1);
            let off = u32::from_be_bytes(b[132 + k * 12 + 4..132 + k * 12 + 8].try_into().unwrap()) as usize;
            let size = u32::from_be_bytes(b[132 + k * 12 + 8..132 + k * 12 + 12].try_into().unwrap()) as usize;
            for _ in 0..4 {
                let i = off + rng.next() as usize % size.max(1);
                if i < n {
                    b[i] = rng.next() as u8;
                }
            }
            ("tag-body".into(), b)
        }
    }
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let cases: usize = a.get(2).and_then(|s| s.parse().ok()).unwrap_or(2000);
    let srgb_gen = Profile::new_srgb().icc().unwrap();
    let cmyk = std::fs::read(std::env::var("RC_CMYK").unwrap()).unwrap();
    let rgb: Vec<u8> = patches().iter().flat_map(|p| p.rgb).collect();
    let rgb3: Vec<[u8; 3]> = patches().iter().map(|p| p.rgb).collect();
    std::panic::set_hook(Box::new(|_| {}));
    let mut report = Vec::new();
    for (label, base, is_cmyk) in [
        ("lcms-generated-srgb-v4", &srgb_gen, false),
        ("local-cmyk-lut-v2", &cmyk, true),
    ] {
        let mut rng = Rng(0x5EED_0000 + is_cmyk as u64);
        let (
            mut inspect_reject,
            mut mox_parse_ok,
            mut mox_xform_ok,
            mut mox_panic,
            mut lcms_parse_ok,
            mut lcms_xform_ok,
        ) = (0, 0, 0, 0, 0, 0);
        let (mut slowest_ms, mut kinds) = (0u128, std::collections::BTreeMap::<String, usize>::new());
        for _ in 0..cases {
            let (kind, m) = mutate(base, &mut rng);
            *kinds.entry(kind).or_default() += 1;
            if inspect_icc(&m).is_err() {
                inspect_reject += 1;
            }
            let t = Instant::now();
            // moxcms: the mutated profile is the source (RGB) or destination (CMYK).
            let r = catch_unwind(AssertUnwindSafe(|| {
                let ok_parse = moxcms::ColorProfile::new_from_slice(&m).is_ok();
                let conv = if is_cmyk {
                    moxcms_convert(&srgb_gen, &m, 4, 1, true, 8, &rgb)
                } else {
                    moxcms_convert(&m, &srgb_gen, 3, 1, true, 8, &rgb)
                };
                (ok_parse, conv.is_ok())
            }));
            match r {
                Ok((p, x)) => {
                    mox_parse_ok += p as usize;
                    mox_xform_ok += x as usize;
                }
                Err(_) => mox_panic += 1,
            }
            if let Ok(p) = Profile::new_icc(&m) {
                lcms_parse_ok += 1;
                let s = Profile::new_srgb();
                let ok = if is_cmyk {
                    Transform::<[u8; 3], [u8; 4]>::new(
                        &s,
                        PixelFormat::RGB_8,
                        &p,
                        PixelFormat::CMYK_8,
                        Intent::RelativeColorimetric,
                    )
                    .map(|t| {
                        let mut o = vec![[0u8; 4]; rgb3.len()];
                        t.transform_pixels(&rgb3, &mut o);
                    })
                    .is_ok()
                } else {
                    Transform::<[u8; 3], [u8; 3]>::new(
                        &p,
                        PixelFormat::RGB_8,
                        &s,
                        PixelFormat::RGB_8,
                        Intent::RelativeColorimetric,
                    )
                    .map(|t| {
                        let mut o = vec![[0u8; 3]; rgb3.len()];
                        t.transform_pixels(&rgb3, &mut o);
                    })
                    .is_ok()
                };
                lcms_xform_ok += ok as usize;
            }
            slowest_ms = slowest_ms.max(t.elapsed().as_millis());
        }
        report.push(json!({
            "base": label, "baseBytes": base.len(), "cases": cases, "mutationKinds": kinds,
            "inspectIccRejected": inspect_reject,
            "moxcms": { "parsed": mox_parse_ok, "transformedOk": mox_xform_ok, "panicsCaught": mox_panic },
            "littleCms": { "parsed": lcms_parse_ok, "transformedOk": lcms_xform_ok, "processCrashes": 0 },
            "slowestCaseMs": slowest_ms,
        }));
    }
    std::fs::write(&a[1], serde_json::to_string_pretty(&report).unwrap() + "\n").unwrap();
}
