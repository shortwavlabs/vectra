//! Old Print feasibility spike: procedural vector halftone (P0 experiment, not the P2 preset).
//!
//! Tone → coverage: darkness = 1 − luminance/255, then contrast around 0.5 and a gamma curve,
//! multiplied by alpha (transparent areas get no ink). Coverage maps to dot *area*: each cell
//! of a rotated square grid gets one circle whose area inside its cell equals the coverage.
//! Up to π/4 (≈78.5 %) that is r = p·√(c/π); beyond it dots overlap their neighbours and the
//! radius is found by inverting the circle–square intersection area, reaching full coverage at
//! r = p/√2. Overlaps are unioned by the nonzero fill rule (all dots share one winding), so a
//! compound path stays correct where an even-odd fill would punch holes.
//! Everything is a pure function of the input and settings: no randomness is used.

use crate::color::Luma;
use crate::error::EngineError;
use crate::image::RgbaImage;
use crate::params::{DotPaths, HalftoneSettings};
use crate::scene::{Fill, FillRule, Path, PathBuilder};

/// Bézier circle constant (4 cubic arcs).
const KAPPA: f64 = 0.552_284_749_830_793_4;
const RADIUS_LUT: usize = 1024;

/// Fraction of a unit cell covered by a centred circle of radius `r` (in pitch units).
pub fn cell_coverage(r: f64) -> f64 {
    let h = 0.5;
    if r <= h {
        std::f64::consts::PI * r * r
    } else if r >= h * std::f64::consts::SQRT_2 {
        1.0
    } else {
        let segment = r * r * (h / r).acos() - h * (r * r - h * h).sqrt();
        std::f64::consts::PI * r * r - 4.0 * segment
    }
}

/// radius(coverage) in pitch units, tabulated by bisection over `cell_coverage`.
fn radius_table() -> Vec<f64> {
    (0..=RADIUS_LUT)
        .map(|i| {
            let target = i as f64 / RADIUS_LUT as f64;
            let (mut lo, mut hi) = (0.0f64, 0.5 * std::f64::consts::SQRT_2);
            for _ in 0..60 {
                let mid = 0.5 * (lo + hi);
                if cell_coverage(mid) < target {
                    lo = mid
                } else {
                    hi = mid
                }
            }
            hi
        })
        .collect()
}

fn round2(v: f64) -> f64 {
    let r = (v * 100.0).round() / 100.0;
    if r == 0.0 { 0.0 } else { r }
}

pub struct HalftoneResult {
    pub paths: Vec<Path>,
    pub dots: u64,
}

/// Generates halftone dots. Fails with `TooManyPrimitives` instead of silently degrading.
pub fn halftone(
    img: &RgbaImage,
    s: &HalftoneSettings,
    luma: &Luma,
    max_anchors: u64,
) -> Result<HalftoneResult, EngineError> {
    let (w, h) = (img.width as usize, img.height as usize);
    // Tone curve LUT (luminance -> ink coverage in 1/65535 units).
    let tone: Vec<u32> = (0..256)
        .map(|l| {
            let d = 1.0 - l as f64 / 255.0;
            let d = ((d - 0.5) * (1.0 + s.contrast) + 0.5).clamp(0.0, 1.0).powf(s.gamma);
            (d * 65535.0).round() as u32
        })
        .collect();
    let coverage: Vec<u32> = img
        .data
        .chunks_exact(4)
        .map(|p| tone[luma.luma(p[0], p[1], p[2]) as usize] * u32::from(p[3]) / 255)
        .collect();
    let radii = radius_table();

    let p = s.pitch;
    let (sin, cos) = s.angle.to_radians().sin_cos();
    let (cx, cy) = (w as f64 / 2.0, h as f64 / 2.0);
    let r_max = p * 0.5 * std::f64::consts::SQRT_2 * 1.01;
    let reach = ((cx * cx + cy * cy).sqrt() / p).ceil() as i64 + 1;
    // Sample the cell's axis-aligned footprint on a sub-grid (≤ 9×9 samples).
    let step = (p / 8.0).max(1.0);
    let n = ((p / 2.0) / step).floor() as i64;

    let ink = Fill {
        color: s.ink,
        palette_id: Some("ink".into()),
    };
    let mut compound = PathBuilder::default();
    let mut per_dot = Vec::new();
    let mut dots = 0u64;
    for j in -reach..=reach {
        for i in -reach..=reach {
            let x = cx + (i as f64) * p * cos - (j as f64) * p * sin;
            let y = cy + (i as f64) * p * sin + (j as f64) * p * cos;
            if x < -r_max || y < -r_max || x > w as f64 + r_max || y > h as f64 + r_max {
                continue;
            }
            let (mut sum, mut count) = (0u64, 0u64);
            for sy in -n..=n {
                let py = (y + sy as f64 * step).floor();
                if py < 0.0 || py >= h as f64 {
                    continue;
                }
                for sx in -n..=n {
                    let px = (x + sx as f64 * step).floor();
                    if px < 0.0 || px >= w as f64 {
                        continue;
                    }
                    sum += u64::from(coverage[py as usize * w + px as usize]);
                    count += 1;
                }
            }
            if count == 0 {
                continue;
            }
            let c = sum as f64 / count as f64 / 65535.0;
            if c < s.min_coverage.max(1e-6) {
                continue;
            }
            let r = if c >= 0.999 {
                r_max
            } else {
                let f = c * RADIUS_LUT as f64;
                let k = f.floor() as usize;
                let t = f - k as f64;
                p * (radii[k] * (1.0 - t) + radii[(k + 1).min(RADIUS_LUT)] * t)
            };
            dots += 1;
            if dots.saturating_mul(5) > max_anchors {
                return Err(EngineError::TooManyPrimitives {
                    count: dots * 5,
                    limit: max_anchors,
                });
            }
            let mut b = PathBuilder::default();
            let target = if s.dot_paths == DotPaths::Compound {
                &mut compound
            } else {
                &mut b
            };
            circle(target, x, y, r);
            if s.dot_paths == DotPaths::PerDot {
                per_dot.push(b.finish(Some(ink.clone()), FillRule::Nonzero));
            }
        }
    }
    let paths = match s.dot_paths {
        DotPaths::Compound if !compound.is_empty() => vec![compound.finish(Some(ink), FillRule::Nonzero)],
        DotPaths::Compound => Vec::new(),
        DotPaths::PerDot => per_dot,
    };
    Ok(HalftoneResult { paths, dots })
}

/// Clockwise (in y-down space) circle from 4 cubic Béziers; every dot has the same winding.
fn circle(b: &mut PathBuilder, x: f64, y: f64, r: f64) {
    let k = KAPPA * r;
    b.move_to(round2(x + r), round2(y));
    for c in [
        [x + r, y + k, x + k, y + r, x, y + r],
        [x - k, y + r, x - r, y + k, x - r, y],
        [x - r, y - k, x - k, y - r, x, y - r],
        [x + k, y - r, x + r, y - k, x + r, y],
    ] {
        b.cubic_to(c.map(round2));
    }
    b.close();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coverage_function_is_monotone_and_hits_the_documented_landmarks() {
        assert!((cell_coverage(0.5) - std::f64::consts::FRAC_PI_4).abs() < 1e-12);
        assert_eq!(cell_coverage(0.5 * std::f64::consts::SQRT_2), 1.0);
        let mut prev = 0.0;
        for i in 1..=100 {
            let c = cell_coverage(i as f64 / 100.0 * 0.71);
            assert!(c >= prev);
            prev = c;
        }
        let t = radius_table();
        for (i, r) in t.iter().enumerate().step_by(64) {
            assert!((cell_coverage(*r) - i as f64 / RADIUS_LUT as f64).abs() < 1e-9);
        }
    }
}
