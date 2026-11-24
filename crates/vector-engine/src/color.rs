//! Colour handling: RGBA type, perceptual luminance and deterministic palette reduction.
//!
//! Luminance (all presets): linearise sRGB, Rec.709 relative luminance Y, re-encode with the
//! sRGB transfer curve to 0–255. Neutral greys map to themselves, so threshold 128 is mid-grey.
//! After the 256-entry LUT is built the computation is integer-only, so results do not depend
//! on platform floating-point libraries.

use serde::{Deserialize, Serialize};

/// Straight (non-premultiplied) sRGB colour with 8-bit alpha. Serialised as `#rrggbb` or `#rrggbbaa`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct Rgba {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

impl Rgba {
    pub const BLACK: Rgba = Rgba::rgb(0, 0, 0);
    pub const fn rgb(r: u8, g: u8, b: u8) -> Self {
        Self { r, g, b, a: 255 }
    }
    pub fn hex_rgb(&self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.r, self.g, self.b)
    }
}

impl From<Rgba> for String {
    fn from(c: Rgba) -> String {
        if c.a == 255 {
            c.hex_rgb()
        } else {
            format!("{}{:02x}", c.hex_rgb(), c.a)
        }
    }
}

impl TryFrom<String> for Rgba {
    type Error = String;
    fn try_from(s: String) -> Result<Self, String> {
        let h = s
            .strip_prefix('#')
            .ok_or_else(|| format!("colour {s:?} must start with #"))?;
        if !(h.len() == 6 || h.len() == 8) || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(format!("colour {s:?} must be #rrggbb or #rrggbbaa"));
        }
        let byte = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).map_err(|e| e.to_string());
        Ok(Rgba {
            r: byte(0)?,
            g: byte(2)?,
            b: byte(4)?,
            a: if h.len() == 8 { byte(6)? } else { 255 },
        })
    }
}

const LUT_SCALE: f64 = (1u64 << 24) as f64;

fn srgb_to_linear(v: f64) -> f64 {
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

fn linear_to_srgb(v: f64) -> f64 {
    if v <= 0.003_130_8 {
        v * 12.92
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    }
}

/// Perceptual luminance calculator (see module docs).
pub struct Luma {
    lin: [u32; 256],
    mids: [u32; 255],
}

impl Default for Luma {
    fn default() -> Self {
        Self::new()
    }
}

impl Luma {
    pub fn new() -> Self {
        let mut lin = [0u32; 256];
        for (v, slot) in lin.iter_mut().enumerate() {
            *slot = (srgb_to_linear(v as f64 / 255.0) * LUT_SCALE).round() as u32;
        }
        let mut mids = [0u32; 255];
        for v in 0..255 {
            mids[v] = (lin[v] + lin[v + 1]).div_ceil(2);
        }
        Self { lin, mids }
    }

    /// Luminance 0..=255 in the sRGB-encoded scale.
    #[inline]
    pub fn luma(&self, r: u8, g: u8, b: u8) -> u8 {
        let y = (2126 * u64::from(self.lin[r as usize])
            + 7152 * u64::from(self.lin[g as usize])
            + 722 * u64::from(self.lin[b as usize])
            + 5000)
            / 10_000;
        self.mids.partition_point(|&m| u64::from(m) <= y) as u8
    }

    #[inline]
    pub fn linear(&self, v: u8) -> f64 {
        f64::from(self.lin[v as usize]) / LUT_SCALE
    }
}

/// OKLab coordinates (Björn Ottosson, 2020).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Oklab {
    pub l: f64,
    pub a: f64,
    pub b: f64,
}

impl Oklab {
    pub fn from_rgb(luma: &Luma, r: u8, g: u8, b: u8) -> Self {
        let (r, g, b) = (luma.linear(r), luma.linear(g), luma.linear(b));
        let l = (0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b).cbrt();
        let m = (0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b).cbrt();
        let s = (0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b).cbrt();
        Oklab {
            l: 0.210_454_255_3 * l + 0.793_617_785_0 * m - 0.004_072_046_8 * s,
            a: 1.977_998_495_1 * l - 2.428_592_205_0 * m + 0.450_593_709_9 * s,
            b: 0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766_0 * s,
        }
    }

    pub fn to_rgb(self) -> Rgba {
        let l = (self.l + 0.396_337_777_4 * self.a + 0.215_803_757_3 * self.b).powi(3);
        let m = (self.l - 0.105_561_345_8 * self.a - 0.063_854_172_8 * self.b).powi(3);
        let s = (self.l - 0.089_484_177_5 * self.a - 1.291_485_548_0 * self.b).powi(3);
        let enc = |v: f64| (linear_to_srgb(v.clamp(0.0, 1.0)) * 255.0).round() as u8;
        Rgba::rgb(
            enc(4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s),
            enc(-1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s),
            enc(-0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701_0 * s),
        )
    }

    #[inline]
    pub fn dist2(&self, o: &Oklab) -> f64 {
        (self.l - o.l).powi(2) + (self.a - o.a).powi(2) + (self.b - o.b).powi(2)
    }
}

/// SplitMix64: tiny deterministic PRNG for seeded stages.
pub struct SplitMix64(u64);

impl SplitMix64 {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }
    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    /// Uniform in [0, 1).
    pub fn next_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }
}

const MAX_SAMPLES: usize = 65_536;

/// Deterministic palette reduction: seeded k-means++ in OKLab over opaque pixels (subsampled
/// with a fixed stride), sorted dark to light. Returns fewer than `k` colours when the image
/// has fewer distinct colours.
pub fn kmeans_palette(luma: &Luma, rgba: &[u8], alpha_threshold: u8, k: usize, seed: u64) -> Vec<Rgba> {
    let opaque: usize = rgba.chunks_exact(4).filter(|p| p[3] >= alpha_threshold).count();
    if opaque == 0 || k == 0 {
        return Vec::new();
    }
    let stride = opaque.div_ceil(MAX_SAMPLES);
    let mut samples: Vec<Oklab> = Vec::with_capacity(opaque / stride + 1);
    let mut uniq: Vec<[u8; 3]> = Vec::new();
    for (i, p) in rgba.chunks_exact(4).filter(|p| p[3] >= alpha_threshold).enumerate() {
        if i % stride == 0 {
            samples.push(Oklab::from_rgb(luma, p[0], p[1], p[2]));
            if uniq.len() <= k {
                let c = [p[0], p[1], p[2]];
                if !uniq.contains(&c) {
                    uniq.push(c);
                }
            }
        }
    }
    let mut palette: Vec<Rgba> = if uniq.len() <= k {
        uniq.iter().map(|c| Rgba::rgb(c[0], c[1], c[2])).collect()
    } else {
        let mut rng = SplitMix64::new(seed);
        let mut centers = vec![samples[(rng.next_u64() % samples.len() as u64) as usize]];
        let mut d2: Vec<f64> = samples.iter().map(|s| s.dist2(&centers[0])).collect();
        while centers.len() < k {
            let total: f64 = d2.iter().sum();
            let pick = if total > 0.0 {
                let mut target = rng.next_f64() * total;
                let mut idx = d2.len() - 1;
                for (i, d) in d2.iter().enumerate() {
                    if target < *d {
                        idx = i;
                        break;
                    }
                    target -= d;
                }
                idx
            } else {
                (rng.next_u64() % samples.len() as u64) as usize
            };
            centers.push(samples[pick]);
            for (d, s) in d2.iter_mut().zip(&samples) {
                *d = d.min(s.dist2(&centers[centers.len() - 1]));
            }
        }
        let mut assign = vec![usize::MAX; samples.len()];
        for _ in 0..24 {
            let mut changed = false;
            for (s, a) in samples.iter().zip(assign.iter_mut()) {
                let best = nearest(&centers, s);
                if best != *a {
                    *a = best;
                    changed = true;
                }
            }
            let mut sums = vec![(0.0f64, 0.0f64, 0.0f64, 0usize); k];
            for (s, &a) in samples.iter().zip(&assign) {
                let e = &mut sums[a];
                e.0 += s.l;
                e.1 += s.a;
                e.2 += s.b;
                e.3 += 1;
            }
            for (c, e) in centers.iter_mut().zip(&sums) {
                if e.3 > 0 {
                    let n = e.3 as f64;
                    *c = Oklab {
                        l: e.0 / n,
                        a: e.1 / n,
                        b: e.2 / n,
                    };
                }
            }
            if !changed {
                break;
            }
        }
        centers.iter().map(|c| c.to_rgb()).collect()
    };
    palette.sort_by(|x, y| {
        let lx = luma.luma(x.r, x.g, x.b);
        let ly = luma.luma(y.r, y.g, y.b);
        lx.cmp(&ly).then(x.cmp(y))
    });
    palette.dedup();
    palette
}

pub fn nearest(centers: &[Oklab], s: &Oklab) -> usize {
    let mut best = 0;
    let mut best_d = f64::INFINITY;
    for (i, c) in centers.iter().enumerate() {
        let d = s.dist2(c);
        if d < best_d {
            best_d = d;
            best = i;
        }
    }
    best
}

/// Maps every RGB value to its nearest palette index, memoised over the 24-bit cube.
pub struct PaletteMapper {
    centers: Vec<Oklab>,
    memo: Vec<u8>,
}

impl PaletteMapper {
    pub fn new(luma: &Luma, palette: &[Rgba]) -> Self {
        assert!(palette.len() < 255, "palette larger than 254 entries");
        Self {
            centers: palette.iter().map(|c| Oklab::from_rgb(luma, c.r, c.g, c.b)).collect(),
            memo: vec![u8::MAX; 1 << 24],
        }
    }

    pub fn index(&mut self, luma: &Luma, r: u8, g: u8, b: u8) -> usize {
        let key = (usize::from(r) << 16) | (usize::from(g) << 8) | usize::from(b);
        if self.memo[key] == u8::MAX {
            self.memo[key] = nearest(&self.centers, &Oklab::from_rgb(luma, r, g, b)) as u8;
        }
        usize::from(self.memo[key])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neutral_greys_map_to_themselves_and_primaries_follow_rec709() {
        let l = Luma::new();
        for v in 0..=255u8 {
            assert_eq!(l.luma(v, v, v), v);
        }
        assert_eq!(l.luma(255, 255, 255), 255);
        assert_eq!(l.luma(0, 0, 0), 0);
        // Pure green is much brighter than pure blue.
        assert!(l.luma(0, 255, 0) > 200 && l.luma(0, 0, 255) < 90);
    }

    #[test]
    fn colour_hex_roundtrip_and_rejection() {
        let c: Rgba = Rgba::try_from("#1d1d1b".to_string()).unwrap();
        assert_eq!(c, Rgba::rgb(0x1d, 0x1d, 0x1b));
        assert_eq!(String::from(Rgba { a: 0x80, ..c }), "#1d1d1b80");
        assert!(Rgba::try_from("1d1d1b".to_string()).is_err());
        assert!(Rgba::try_from("#12345".to_string()).is_err());
        assert!(Rgba::try_from("#gg0000".to_string()).is_err());
    }

    #[test]
    fn oklab_roundtrip_is_close() {
        let l = Luma::new();
        for &(r, g, b) in &[(255, 0, 0), (12, 200, 99), (240, 230, 210), (0, 0, 0)] {
            let back = Oklab::from_rgb(&l, r, g, b).to_rgb();
            assert!((i16::from(back.r) - i16::from(r)).abs() <= 1);
            assert!((i16::from(back.g) - i16::from(g)).abs() <= 1);
            assert!((i16::from(back.b) - i16::from(b)).abs() <= 1);
        }
    }

    #[test]
    fn kmeans_is_seed_deterministic_and_exact_for_few_colours() {
        let l = Luma::new();
        let mut img = Vec::new();
        for i in 0..4000u32 {
            let c = match i % 4 {
                0 => [200, 30, 30, 255],
                1 => [30, 200, 30, 255],
                2 => [30, 30, 200, 255],
                _ => [0, 0, 0, 0],
            };
            img.extend_from_slice(&c);
        }
        let p = kmeans_palette(&l, &img, 128, 8, 1);
        assert_eq!(p.len(), 3, "only three opaque colours present");
        let mut grad = Vec::new();
        for i in 0..10_000u32 {
            let v = (i % 256) as u8;
            grad.extend_from_slice(&[v, v / 2, 255 - v, 255]);
        }
        let a = kmeans_palette(&l, &grad, 128, 6, 42);
        let b = kmeans_palette(&l, &grad, 128, 6, 42);
        assert_eq!(a, b);
        assert_eq!(a.len(), 6);
    }
}
