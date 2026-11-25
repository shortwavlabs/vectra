//! R-COLOR prototype library (research only, never shipped).
//!
//! - `patches`: the colour corpus of the qualification plan (PRINT-QUALIFICATION-PLAN.md).
//! - `ciede2000`: colour difference, checked against Sharma, Wu and Dalal (2005) test pairs.
//! - `inspect_icc`: bounds-checked ICC header and tag-table reader (no profile semantics).
//! - `moxcms_convert`: the single moxcms code path used by both the native comparison and the
//!   wasm32 build, so native and WASM outputs can be compared bit for bit.

use moxcms::{ColorProfile, Layout, RenderingIntent, TransformOptions};

/// One colour patch: a stable name and an 8-bit sRGB-encoded value.
pub struct Patch {
    pub name: String,
    pub rgb: [u8; 3],
}

/// The R-COLOR-10 colour corpus: primaries, neutrals, black, saturated and likely
/// out-of-CMYK-gamut colours, Vectra identity colours, skin and dark tones, plus a 6×6×6 cube.
pub fn patches() -> Vec<Patch> {
    let mut v = Vec::new();
    let mut add = |name: &str, hex: u32| {
        v.push(Patch {
            name: name.to_string(),
            rgb: [(hex >> 16) as u8, (hex >> 8) as u8, hex as u8],
        })
    };
    for (n, h) in [
        ("white", 0xffffff),
        ("black", 0x000000),
        ("red", 0xff0000),
        ("green", 0x00ff00),
        ("blue", 0x0000ff),
        ("cyan", 0x00ffff),
        ("magenta", 0xff00ff),
        ("yellow", 0xffff00),
        ("orange", 0xff6600),
        ("process-magenta-like", 0xec008c),
        ("deep-green", 0x00a651),
        ("deep-blue", 0x2e3192),
        ("violet", 0x7f00ff),
        ("chartreuse", 0x80ff00),
        ("vectra-lime", 0xb9e87b),
        ("vectra-charcoal", 0x191a1c),
        ("vectra-panel", 0x212224),
        ("vectra-ivory", 0xeee8d8),
        ("skin-light", 0xe0ac69),
        ("skin-mid", 0xc68642),
        ("skin-dark", 0x8d5524),
        ("near-black", 0x101010),
        ("dark-navy", 0x0b1f3a),
        ("dark-red", 0x3a0b0b),
    ] {
        add(n, h);
    }
    for g in (0..=240u32).step_by(16).chain([255]) {
        add(&format!("grey-{g:03}"), g << 16 | g << 8 | g);
    }
    let steps = [0u32, 51, 102, 153, 204, 255];
    for r in steps {
        for g in steps {
            for b in steps {
                add(&format!("cube-{r:02x}{g:02x}{b:02x}"), r << 16 | g << 8 | b);
            }
        }
    }
    v
}

/// CIEDE2000 colour difference (kL = kC = kH = 1), Sharma, Wu and Dalal (2005).
pub fn ciede2000(lab1: [f64; 3], lab2: [f64; 3]) -> f64 {
    use std::f64::consts::PI;
    let (l1, a1, b1) = (lab1[0], lab1[1], lab1[2]);
    let (l2, a2, b2) = (lab2[0], lab2[1], lab2[2]);
    let c1 = a1.hypot(b1);
    let c2 = a2.hypot(b2);
    let cm = (c1 + c2) / 2.0;
    let g = 0.5 * (1.0 - (cm.powi(7) / (cm.powi(7) + 25f64.powi(7))).sqrt());
    let a1p = (1.0 + g) * a1;
    let a2p = (1.0 + g) * a2;
    let c1p = a1p.hypot(b1);
    let c2p = a2p.hypot(b2);
    let hue = |b: f64, a: f64| {
        if a == 0.0 && b == 0.0 {
            0.0
        } else {
            let h = b.atan2(a).to_degrees();
            if h < 0.0 { h + 360.0 } else { h }
        }
    };
    let h1p = hue(b1, a1p);
    let h2p = hue(b2, a2p);
    let dlp = l2 - l1;
    let dcp = c2p - c1p;
    let dhp = if c1p * c2p == 0.0 {
        0.0
    } else if (h2p - h1p).abs() <= 180.0 {
        h2p - h1p
    } else if h2p - h1p > 180.0 {
        h2p - h1p - 360.0
    } else {
        h2p - h1p + 360.0
    };
    let dhp_big = 2.0 * (c1p * c2p).sqrt() * (dhp.to_radians() / 2.0).sin();
    let lpm = (l1 + l2) / 2.0;
    let cpm = (c1p + c2p) / 2.0;
    let hpm = if c1p * c2p == 0.0 {
        h1p + h2p
    } else if (h1p - h2p).abs() <= 180.0 {
        (h1p + h2p) / 2.0
    } else if h1p + h2p < 360.0 {
        (h1p + h2p + 360.0) / 2.0
    } else {
        (h1p + h2p - 360.0) / 2.0
    };
    let t = 1.0 - 0.17 * (hpm - 30.0).to_radians().cos()
        + 0.24 * (2.0 * hpm).to_radians().cos()
        + 0.32 * (3.0 * hpm + 6.0).to_radians().cos()
        - 0.20 * (4.0 * hpm - 63.0).to_radians().cos();
    let dtheta = 30.0 * (-((hpm - 275.0) / 25.0).powi(2)).exp();
    let rc = 2.0 * (cpm.powi(7) / (cpm.powi(7) + 25f64.powi(7))).sqrt();
    let sl = 1.0 + 0.015 * (lpm - 50.0).powi(2) / (20.0 + (lpm - 50.0).powi(2)).sqrt();
    let sc = 1.0 + 0.045 * cpm;
    let sh = 1.0 + 0.015 * cpm * t;
    let rt = -(2.0 * dtheta * PI / 180.0).sin() * rc;
    ((dlp / sl).powi(2) + (dcp / sc).powi(2) + (dhp_big / sh).powi(2) + rt * (dcp / sc) * (dhp_big / sh)).sqrt()
}

/// ICC header and tag table, read with checked bounds. Semantics are left to the CMM.
#[derive(Debug)]
pub struct IccSummary {
    pub declared_size: u32,
    pub version: String,
    pub class: String,
    pub color_space: String,
    pub pcs: String,
    pub rendering_intent: u32,
    pub tags: Vec<(String, u32, u32)>,
}

fn sig(b: &[u8]) -> String {
    b.iter()
        .map(|&c| {
            if c.is_ascii_graphic() || c == b' ' {
                c as char
            } else {
                '?'
            }
        })
        .collect()
}

/// Rejects anything that is not a structurally sound ICC container: short buffers, a declared
/// size that disagrees with the buffer, a missing `acsp` signature, a tag count that cannot fit,
/// or a tag whose offset + size leaves the buffer. Caps the tag count at 1,024.
pub fn inspect_icc(b: &[u8]) -> Result<IccSummary, String> {
    let be = |i: usize| u32::from_be_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]);
    if b.len() < 132 {
        return Err(format!("too short: {} bytes", b.len()));
    }
    let declared = be(0);
    if declared as usize != b.len() {
        return Err(format!("declared size {declared} != buffer {}", b.len()));
    }
    if &b[36..40] != b"acsp" {
        return Err("missing acsp signature".into());
    }
    let count = be(128) as usize;
    if count > 1024 || 132 + count * 12 > b.len() {
        return Err(format!("tag count {count} does not fit"));
    }
    let mut tags = Vec::with_capacity(count);
    for k in 0..count {
        let o = 132 + k * 12;
        let (off, size) = (be(o + 4), be(o + 8));
        match off.checked_add(size) {
            Some(end) if off >= 128 && end as usize <= b.len() => {}
            _ => return Err(format!("tag {k} out of bounds: offset {off} size {size}")),
        }
        tags.push((sig(&b[o..o + 4]), off, size));
    }
    Ok(IccSummary {
        declared_size: declared,
        version: format!("{}.{}.{}", b[8], b[9] >> 4, b[9] & 15),
        class: sig(&b[12..16]),
        color_space: sig(&b[16..20]),
        pcs: sig(&b[20..24]),
        rendering_intent: be(64),
        tags,
    })
}

pub fn intent_from(n: u32) -> RenderingIntent {
    match n {
        0 => RenderingIntent::Perceptual,
        2 => RenderingIntent::Saturation,
        3 => RenderingIntent::AbsoluteColorimetric,
        _ => RenderingIntent::RelativeColorimetric,
    }
}

/// Converts packed 8-bit RGB through moxcms. `dst_channels` is 3 (RGB) or 4 (CMYK).
/// `out_bits` 8 or 16 selects the integer transforms (values returned unscaled: 0–255 or
/// 0–65535); 0 runs the f32 transform and values are in 0–1 (CMYK as ink fraction, not percent).
pub fn moxcms_convert(
    src_icc: &[u8],
    dst_icc: &[u8],
    dst_channels: usize,
    intent: u32,
    prefer_fixed_point: bool,
    out_bits: u32,
    rgb: &[u8],
) -> Result<Vec<f32>, String> {
    let src = ColorProfile::new_from_slice(src_icc).map_err(|e| format!("src: {e:?}"))?;
    let dst = ColorProfile::new_from_slice(dst_icc).map_err(|e| format!("dst: {e:?}"))?;
    let options = TransformOptions {
        rendering_intent: intent_from(intent),
        prefer_fixed_point,
        #[cfg(feature = "tetra")]
        interpolation_method: moxcms::InterpolationMethod::Tetrahedral,
        ..TransformOptions::default()
    };
    let dl = if dst_channels == 4 { Layout::Rgba } else { Layout::Rgb };
    let n = rgb.len() / 3;
    if out_bits == 16 {
        let t = src
            .create_transform_16bit(Layout::Rgb, &dst, dl, options)
            .map_err(|e| format!("{e:?}"))?;
        let input: Vec<u16> = rgb.iter().map(|&v| u16::from(v) * 257).collect();
        let mut out = vec![0u16; n * dst_channels];
        t.transform(&input, &mut out).map_err(|e| format!("{e:?}"))?;
        Ok(out.into_iter().map(f32::from).collect())
    } else if out_bits == 8 {
        let t = src
            .create_transform_8bit(Layout::Rgb, &dst, dl, options)
            .map_err(|e| format!("{e:?}"))?;
        let mut out = vec![0u8; n * dst_channels];
        t.transform(rgb, &mut out).map_err(|e| format!("{e:?}"))?;
        Ok(out.into_iter().map(f32::from).collect())
    } else {
        let t = src
            .create_transform_f32(Layout::Rgb, &dst, dl, options)
            .map_err(|e| format!("{e:?}"))?;
        let input: Vec<f32> = rgb.iter().map(|&v| f32::from(v) / 255.0).collect();
        let mut out = vec![0f32; n * dst_channels];
        t.transform(&input, &mut out).map_err(|e| format!("{e:?}"))?;
        Ok(out)
    }
}

// ---- wasm32 C ABI (also compiled natively; harmless there) -------------------------------

#[unsafe(no_mangle)]
pub extern "C" fn rc_alloc(n: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(n.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// `flags`: bit 0 prefer fixed point; bit 1 8-bit output; bit 2 16-bit output.
/// Returns 0 on success, -1 on error. `out` receives `n * dst_channels` f32 values.
///
/// # Safety
/// All pointers must reference buffers of the stated lengths inside this module's memory.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rc_convert(
    src: *const u8,
    src_len: usize,
    dst: *const u8,
    dst_len: usize,
    dst_channels: u32,
    intent: u32,
    flags: u32,
    rgb: *const u8,
    n: usize,
    out: *mut f32,
) -> i32 {
    let (src, dst, rgb, out) = unsafe {
        (
            std::slice::from_raw_parts(src, src_len),
            std::slice::from_raw_parts(dst, dst_len),
            std::slice::from_raw_parts(rgb, n * 3),
            std::slice::from_raw_parts_mut(out, n * dst_channels as usize),
        )
    };
    match moxcms_convert(
        src,
        dst,
        dst_channels as usize,
        intent,
        flags & 1 != 0,
        if flags & 4 != 0 {
            16
        } else if flags & 2 != 0 {
            8
        } else {
            0
        },
        rgb,
    ) {
        Ok(v) => {
            out.copy_from_slice(&v);
            0
        }
        Err(_) => -1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ciede2000_matches_sharma_2005_pairs() {
        let cases = [
            ([50.0, 2.6772, -79.7751], [50.0, 0.0, -82.7485], 2.0425),
            ([50.0, 0.0, 0.0], [50.0, -1.0, 2.0], 2.3669),
            ([50.0, 2.5, 0.0], [73.0, 25.0, -18.0], 27.1492),
            ([60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644),
        ];
        for (a, b, want) in cases {
            let got = ciede2000(a, b);
            assert!((got - want).abs() < 1e-4, "{a:?} {b:?}: {got} != {want}");
        }
    }

    #[test]
    fn inspect_icc_rejects_out_of_bounds_tags() {
        let mut b = vec![0u8; 144];
        b[0..4].copy_from_slice(&144u32.to_be_bytes());
        b[36..40].copy_from_slice(b"acsp");
        b[128..132].copy_from_slice(&1u32.to_be_bytes());
        b[136..140].copy_from_slice(&140u32.to_be_bytes());
        b[140..144].copy_from_slice(&8u32.to_be_bytes()); // 140 + 8 > 144
        assert!(inspect_icc(&b).is_err());
        b[140..144].copy_from_slice(&4u32.to_be_bytes());
        assert_eq!(inspect_icc(&b).unwrap().tags.len(), 1);
    }
}
