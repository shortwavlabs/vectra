//! Samples renders of the pdf_proto variants at known scene points and compares them with the
//! two compositing expectations (sRGB-space and CMYK-space). Renders come from run-pdf.sh
//! (poppler `pdftoppm` and macOS Quartz via `sips`), 72 dpi, so 1 px = 1 pt.
//! Usage: render_sample <out-dir>   (needs RC_SRGB, RC_CMYK, RC_P3)

use std::fs;

use lcms2::{CIExyY, Intent, PixelFormat, Profile, Transform};
use r_color_cmm::{ciede2000, moxcms_convert};
use serde_json::json;

const S: f64 = 566.929_133_858_267_7 / 600.0; // 200 mm page / 600-unit scene
const MARGIN: f64 = 10.0 * 72.0 / 25.4;

fn decode(path: &str) -> Option<(u32, u32, usize, Vec<u8>)> {
    let d = png::Decoder::new(std::io::BufReader::new(fs::File::open(path).ok()?));
    let mut r = d.read_info().ok()?;
    let mut buf = vec![0; r.output_buffer_size()?];
    let info = r.next_frame(&mut buf).ok()?;
    let ch = info.color_type.samples();
    Some((info.width, info.height, ch, buf))
}

fn main() {
    let out = std::env::args().nth(1).unwrap();
    let srgb_b = fs::read(std::env::var("RC_SRGB").unwrap()).unwrap();
    let cmyk_b = fs::read(std::env::var("RC_CMYK").unwrap()).unwrap();
    let srgb = Profile::new_icc(&srgb_b).unwrap();
    let cmyk = Profile::new_icc(&cmyk_b).unwrap();
    let lab = Profile::new_lab4_context(
        lcms2::GlobalContext::new(),
        &CIExyY {
            x: 0.3457,
            y: 0.3585,
            Y: 1.0,
        },
    )
    .unwrap();
    let rgb_lab: Transform<[f32; 3], [f64; 3]> = Transform::new(
        &srgb,
        PixelFormat::RGB_FLT,
        &lab,
        PixelFormat::Lab_DBL,
        Intent::RelativeColorimetric,
    )
    .unwrap();
    // Quartz (sips) writes renders tagged Display P3; poppler writes untagged sRGB values.
    let p3 = Profile::new_icc(&fs::read(std::env::var("RC_P3").unwrap()).unwrap()).unwrap();
    let p3_lab: Transform<[f32; 3], [f64; 3]> = Transform::new(
        &p3,
        PixelFormat::RGB_FLT,
        &lab,
        PixelFormat::Lab_DBL,
        Intent::RelativeColorimetric,
    )
    .unwrap();
    let cmyk_lab: Transform<[f32; 4], [f64; 3]> = Transform::new(
        &cmyk,
        PixelFormat::CMYK_FLT,
        &lab,
        PixelFormat::Lab_DBL,
        Intent::RelativeColorimetric,
    )
    .unwrap();
    let to_cmyk = |c: [u8; 3]| -> [f32; 4] {
        let v = moxcms_convert(&srgb_b, &cmyk_b, 4, 1, true, 8, &c).unwrap();
        [v[0], v[1], v[2], v[3]].map(|x| x / 255.0)
    };
    let a = 128.0f32 / 255.0;
    let ivory = [0xee, 0xe8, 0xd8];
    // (name, scene x, y, opaque colour stack over the ivory background, alpha of each layer)
    let points: [(&str, f64, f64, &[[u8; 3]], f32); 10] = [
        ("black-bar", 140.0, 52.0, &[[0, 0, 0]], 1.0),
        ("lime-solid", 270.0, 50.0, &[[0xb9, 0xe8, 0x7b]], 1.0),
        ("evenodd-hole", 320.0, 100.0, &[], 1.0),
        ("red-only", 75.0, 185.0, &[[255, 0, 0]], a),
        ("red+green", 135.0, 160.0, &[[255, 0, 0], [0, 255, 0]], a),
        (
            "red+green+blue",
            135.0,
            205.0,
            &[[255, 0, 0], [0, 255, 0], [0, 0, 255]],
            a,
        ),
        ("grey-128", 360.0, 220.0, &[[128, 128, 128]], 1.0),
        ("white", 440.0, 220.0, &[[255, 255, 255]], 1.0),
        ("oog-blue", 460.0, 70.0, &[[0, 0, 255]], 1.0),
        ("spot-lime", 490.0, 330.0, &[[0xb9, 0xe8, 0x7b]], 1.0),
    ];
    let mut rows = Vec::new();
    for variant in [
        "A-device-rgb",
        "A2-device-rgb-group",
        "B-icc-rgb",
        "B2-icc-rgb-group",
        "C-cmyk",
        "D-cmyk-spot",
    ] {
        let print = variant.starts_with('C') || variant.starts_with('D');
        let off = if print { MARGIN } else { 0.0 };
        for renderer in ["poppler", "quartz"] {
            let Some((w, h, ch, px)) = decode(&format!("{out}/{variant}.{renderer}.png")) else {
                continue;
            };
            let mut samples = Vec::new();
            for (name, x, y, stack, alpha) in points {
                let (px_x, px_y) = ((off + x * S).round() as usize, (off + y * S).round() as usize);
                let i = (px_y * w as usize + px_x) * ch;
                let got = [px[i], px[i + 1], px[i + 2]].map(|v| f32::from(v) / 255.0);
                // Expectation 1: composite in sRGB (the editor preview).
                let mut r = ivory.map(|v| f32::from(v) / 255.0);
                let mut k = to_cmyk(ivory);
                for c in stack {
                    let s = c.map(|v| f32::from(v) / 255.0);
                    let kc = if variant.starts_with('D') && *c == [0, 0, 0] {
                        [0.0, 0.0, 0.0, 1.0]
                    } else {
                        to_cmyk(*c)
                    };
                    for j in 0..3 {
                        r[j] = alpha * s[j] + (1.0 - alpha) * r[j];
                    }
                    for j in 0..4 {
                        k[j] = alpha * kc[j] + (1.0 - alpha) * k[j];
                    }
                }
                let mut lg = [[0f64; 3]];
                let mut l1 = [[0f64; 3]];
                let mut l2 = [[0f64; 3]];
                if renderer == "quartz" {
                    p3_lab.transform_pixels(&[got], &mut lg)
                } else {
                    rgb_lab.transform_pixels(&[got], &mut lg)
                }
                rgb_lab.transform_pixels(&[r], &mut l1);
                cmyk_lab.transform_pixels(&[k.map(|v| v * 100.0)], &mut l2);
                samples.push(json!({
                    "point": name,
                    "renderedSrgb": format!("#{:02x}{:02x}{:02x}", px[i], px[i + 1], px[i + 2]),
                    "dE00_vs_srgbComposite": (ciede2000(lg[0], l1[0]) * 100.0).round() / 100.0,
                    "dE00_vs_cmykCompositeProof": (ciede2000(lg[0], l2[0]) * 100.0).round() / 100.0,
                }));
            }
            rows.push(json!({ "variant": variant, "renderer": renderer, "imagePx": [w, h], "samples": samples }));
        }
    }
    fs::write(
        format!("{out}/render-samples.json"),
        serde_json::to_string_pretty(&rows).unwrap() + "\n",
    )
    .unwrap();
}
