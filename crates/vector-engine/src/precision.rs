//! Precision boundary fitting (`fit.mode = "precision"`, P0-R-GEO).
//!
//! Replaces only the curve-fitting stage of stacked compositing. Segmentation and colour fitting
//! stay with VTracer, and the approved `spline` mode is untouched. Per layer:
//!
//! 1. **Crack contours.** Region boundary loops on the pixel lattice: inside pixels are
//!    4-connected, as in VTracer's region tracing, with holes as separate loops.
//! 2. **Sub-pixel refinement.** Each boundary crack separates an inside pixel `i` from an
//!    outside pixel `o` and becomes one point on the segment joining their centres, where the
//!    antialiased source crosses the boundary level:
//!    - alpha at the alpha threshold;
//!    - luminance at the B&W threshold;
//!    - colour: projection between the two regions' local colours, at 0.5.
//!
//!    The crossing is computed from the *visible* (topmost) labels on both sides, so stacked
//!    layers that share a visible boundary get bit-identical points. A point never leaves the
//!    segment between the two centres, so topology is preserved and thin features are never
//!    eroded below their pixel skeleton.
//! 3. **Corners.** Chord angle at a fixed arc-length scale, kept only at local maxima. Image
//!    border runs are pinned straight.
//! 4. **Fitting.**
//!    - Straight sections become lines.
//!    - Smooth sections become cubic chains, fitted by least squares with Newton
//!      reparameterisation (Schneider, *Graphics Gems*, 1990). Every internal join shares one
//!      tangent (G1).
//!    - Optional, conservative circle/arc recognition replaces a section only when its
//!      residuals prove it is circular.
//!
//! Deterministic. Scratch memory is the label map and one layer mask at a time.

use crate::color::Luma;
use crate::image::RgbaImage;
pub use crate::region::Mask;

/// Version of the precision fitting algorithm (reported with results; bump on any change
/// that alters output geometry).
pub const PRECISION_FIT_VERSION: u32 = 1;

const NONE: u32 = u32::MAX;
type P = [f64; 2];

/// How boundary cracks are moved to sub-pixel positions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Subpixel {
    /// Crack midpoints (lattice geometry, no use of antialiasing).
    Off,
    /// Linear interpolation of the boundary field between the two pixel centres.
    Linear,
    /// Coverage (area) estimate. Production choice.
    ///
    /// A variant that let crossings move past pixel centres was evaluated and rejected: it
    /// created local crossings and kinks (ALGORITHM-EVALUATION, commit `f51e265`).
    Area,
}

#[derive(Debug, Clone, Copy)]
pub struct Options {
    /// Maximum deviation (source px) of a fitted cubic from the refined contour.
    pub tolerance: f64,
    /// Degrees; a sharper turn at the corner scale becomes a corner.
    pub corner_threshold: f64,
    /// Arc length (source px) over which corners and tangents are measured.
    pub corner_scale: f64,
    pub subpixel: Subpixel,
    /// Conservative circle and circular-arc recognition (evaluation option).
    pub arcs: bool,
    /// Smoothing of the refined contour, applied after corner detection within each section
    /// (corners and pinned points stay fixed).
    pub smoothing: Smoothing,
    /// Rebuild corners at the intersection of the adjacent sections' end tangents, after
    /// trimming the antialiasing-rounded zone (`corner_scale` × 0.75) off each side.
    pub sharpen: bool,
}

impl Options {
    /// Production configuration of [`PRECISION_FIT_VERSION`] 1.
    pub fn production(corner_threshold_deg: i32) -> Self {
        Self {
            tolerance: 0.2,
            corner_threshold: f64::from(corner_threshold_deg),
            corner_scale: 2.0,
            subpixel: Subpixel::Area,
            arcs: true,
            smoothing: Smoothing::Taubin(2),
            sharpen: true,
        }
    }
}

/// Contour smoothing before fitting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Smoothing {
    None,
    /// `n` passes of [1,2,1]/4 (shrinks curves by ≈ n·ds²/4r).
    Binomial(u32),
    /// `n` Taubin λ|μ pairs (λ = 0.5, μ = −0.53): damps 2-sample noise without shrinking.
    Taubin(u32),
}

/// Which source quantity defines a boundary.
#[derive(Debug, Clone, Copy)]
pub enum EdgePolicy {
    /// B&W: ink is `luma < threshold` (or `>=` when inverted) and `alpha >= alpha_threshold`.
    Luma {
        threshold: u8,
        invert: bool,
        alpha_threshold: u8,
    },
    /// Colour regions: alpha edges at the threshold, colour edges by local colour projection.
    Color { alpha_threshold: u8 },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Seg {
    Line(P),
    /// Control 1, control 2, end.
    Cubic([f64; 6]),
}

/// One closed fitted outline (outer boundary or hole).
#[derive(Debug, Clone, PartialEq)]
pub struct FittedLoop {
    pub start: P,
    pub segs: Vec<Seg>,
    /// Sections replaced by a recognised circle or circular arc (diagnostics).
    pub recognised: usize,
}

/// A refined boundary loop before fitting (exposed for diagnostics).
#[derive(Debug, Clone)]
pub struct Contour {
    pub points: Vec<P>,
    /// Points on the image border (lattice vertices, never moved).
    pub pinned: Vec<bool>,
    /// Points whose crack lies under one higher layer on both sides (not a visible edge; no
    /// sub-pixel information).
    pub hidden: Vec<bool>,
    /// Crossings that hit the clamp: the true edge lies beyond the pixel centre, i.e. the
    /// segmentation put a blend pixel on the wrong side.
    pub saturated: Vec<bool>,
}

/// Topmost layer per pixel plus everything needed to place boundary crossings.
pub struct Field<'a> {
    img: RgbaImage<'a>,
    w: usize,
    h: usize,
    labels: Vec<u32>,
    pure: Vec<bool>,
    luma: &'a Luma,
    policy: EdgePolicy,
    subpixel: Subpixel,
}

impl<'a> Field<'a> {
    /// `layers` yields every layer's mask in paint order (bottom first).
    pub fn new(
        img: RgbaImage<'a>,
        luma: &'a Luma,
        policy: EdgePolicy,
        subpixel: Subpixel,
        layers: impl Iterator<Item = Mask>,
    ) -> Self {
        let (w, h) = (img.width as usize, img.height as usize);
        let mut labels = vec![NONE; w * h];
        for (k, m) in layers.enumerate() {
            for y in 0..m.h {
                for x in 0..m.w {
                    if m.bits[y * m.w + x] {
                        labels[(m.y0 + y) * w + m.x0 + x] = k as u32;
                    }
                }
            }
        }
        let mut pure = vec![true; w * h];
        for y in 0..h {
            for x in 0..w {
                let l = labels[y * w + x];
                'n: for dy in -1i64..=1 {
                    for dx in -1i64..=1 {
                        let (nx, ny) = (x as i64 + dx, y as i64 + dy);
                        if nx >= 0
                            && ny >= 0
                            && (nx as usize) < w
                            && (ny as usize) < h
                            && labels[ny as usize * w + nx as usize] != l
                        {
                            pure[y * w + x] = false;
                            break 'n;
                        }
                    }
                }
            }
        }
        Self {
            img,
            w,
            h,
            labels,
            pure,
            luma,
            policy,
            subpixel,
        }
    }

    fn premul(&self, i: usize) -> [f64; 4] {
        let p = &self.img.data[i * 4..i * 4 + 4];
        let a = f64::from(p[3]) / 255.0;
        [
            f64::from(p[0]) * a,
            f64::from(p[1]) * a,
            f64::from(p[2]) * a,
            f64::from(p[3]),
        ]
    }

    /// Mean premultiplied colour of pure pixels of `label` in the 5×5 window around `q`
    /// (falls back to `q` itself).
    fn local_mean(&self, label: u32, q: usize) -> [f64; 4] {
        let (qx, qy) = ((q % self.w) as i64, (q / self.w) as i64);
        let mut sum = [0.0; 4];
        let mut n = 0.0;
        for y in (qy - 2).max(0)..=(qy + 2).min(self.h as i64 - 1) {
            for x in (qx - 2).max(0)..=(qx + 2).min(self.w as i64 - 1) {
                let j = y as usize * self.w + x as usize;
                if self.labels[j] == label && self.pure[j] {
                    let c = self.premul(j);
                    for k in 0..4 {
                        sum[k] += c[k];
                    }
                    n += 1.0;
                }
            }
        }
        if n == 0.0 {
            return self.premul(q);
        }
        sum.map(|v| v / n)
    }

    /// Mean luminance of pure pixels of `label` in the 5×5 window around `q` (falls back to `q`).
    fn local_luma(&self, label: u32, q: usize) -> f64 {
        let (qx, qy) = ((q % self.w) as i64, (q / self.w) as i64);
        let (mut sum, mut n) = (0.0, 0.0);
        for y in (qy - 2).max(0)..=(qy + 2).min(self.h as i64 - 1) {
            for x in (qx - 2).max(0)..=(qx + 2).min(self.w as i64 - 1) {
                let j = y as usize * self.w + x as usize;
                if self.labels[j] == label && self.pure[j] {
                    let p = &self.img.data[j * 4..j * 4 + 3];
                    sum += f64::from(self.luma.luma(p[0], p[1], p[2]));
                    n += 1.0;
                }
            }
        }
        if n == 0.0 {
            let p = &self.img.data[q * 4..q * 4 + 3];
            return f64::from(self.luma.luma(p[0], p[1], p[2]));
        }
        sum / n
    }

    /// Fraction of the way from `i`'s centre to `o`'s centre where the boundary lies.
    fn crossing(&self, i: usize, o: usize) -> f64 {
        if self.subpixel == Subpixel::Off {
            return 0.5;
        }
        let (li, lo) = (self.labels[i], self.labels[o]);
        if li == lo {
            return 0.5; // hidden under a higher layer on both sides
        }
        let at = match self.policy {
            EdgePolicy::Luma { alpha_threshold, .. } | EdgePolicy::Color { alpha_threshold } => alpha_threshold,
        };
        let area = self.subpixel == Subpixel::Area;
        let (ai, ao) = (self.img.data[i * 4 + 3], self.img.data[o * 4 + 3]);
        if ai >= at && ao < at {
            return if area {
                self.area_sum(i, o, |q| f64::from(self.img.data[q * 4 + 3]) / 255.0)
            } else {
                level_t(f64::from(ai) - f64::from(at) + 0.5, f64::from(ao) - f64::from(at) + 0.5)
            };
        }
        match self.policy {
            EdgePolicy::Luma { threshold, invert, .. } => {
                let g = |q: usize| {
                    let p = &self.img.data[q * 4..q * 4 + 3];
                    let l = f64::from(self.luma.luma(p[0], p[1], p[2]));
                    if invert {
                        l - f64::from(threshold) + 0.5
                    } else {
                        f64::from(threshold) - l - 0.5
                    }
                };
                let (gi, go) = (g(i), g(o));
                if !(gi > 0.0 && go < 0.0) {
                    return 0.5;
                }
                if self.subpixel == Subpixel::Area {
                    // Coverage of ink from local ink/paper luminance; the threshold level shifts
                    // the crossing off the 50 % edge by (level - 0.5) px.
                    let (lin, lout) = (self.local_luma(li, i), self.local_luma(lo, o));
                    let span = lout - lin;
                    if span.abs() >= 8.0 {
                        let cov = |q: usize| {
                            let p = &self.img.data[q * 4..q * 4 + 3];
                            ((lout - f64::from(self.luma.luma(p[0], p[1], p[2]))) / span).clamp(0.0, 1.0)
                        };
                        let level = ((lout - f64::from(threshold)) / span).clamp(0.0, 1.0);
                        return self.area_sum(i, o, cov) - (level - 0.5);
                    }
                }
                level_t(gi, go)
            }
            EdgePolicy::Color { .. } => {
                if li == NONE || lo == NONE {
                    return 0.5;
                }
                let (cin, cout) = (self.local_mean(li, i), self.local_mean(lo, o));
                let d: Vec<f64> = (0..4).map(|k| cin[k] - cout[k]).collect();
                let dd: f64 = d.iter().map(|v| v * v).sum();
                if dd < 64.0 {
                    return 0.5; // colours too close to localise the edge
                }
                let mu = |q: usize| {
                    let c = self.premul(q);
                    (0..4).map(|k| (c[k] - cout[k]) * d[k]).sum::<f64>() / dd
                };
                if area {
                    return self.area_sum(i, o, |q| mu(q).clamp(0.0, 1.0));
                }
                let (mi, mo) = (mu(i), mu(o));
                level_t(mi.max(0.501) - 0.5, mo.min(0.499) - 0.5)
            }
        }
    }
}

impl Field<'_> {
    /// Coverage estimate of the edge position between `i` and `o` from their inside-coverages
    /// (exact for straight axis-aligned edges; a 4-pixel window was evaluated and was worse on
    /// curves). Returns the fraction from `i`'s centre towards `o`'s, unclamped.
    fn area_sum(&self, i: usize, o: usize, cov: impl Fn(usize) -> f64) -> f64 {
        0.5 + (cov(i) - 1.0) + cov(o)
    }
}

/// Level crossing between `vi > 0` (inside) and `vo < 0` (outside), kept strictly between centres.
fn level_t(vi: f64, vo: f64) -> f64 {
    (vi / (vi - vo)).clamp(0.02, 0.98)
}

const DX: [i64; 4] = [1, 0, -1, 0];
const DY: [i64; 4] = [0, 1, 0, -1];

/// Refined boundary loops of one layer (inside pixels 4-connected).
pub fn contours(field: &Field, m: &Mask) -> Vec<Contour> {
    let (vw, vh) = (m.w + 1, m.h + 1);
    let mut out = vec![0u8; vw * vh];
    for y in 0..m.h as i64 {
        for x in 0..m.w as i64 {
            if !m.at(x, y) {
                continue;
            }
            let v = |xx: i64, yy: i64| yy as usize * vw + xx as usize;
            if !m.at(x, y - 1) {
                out[v(x, y)] |= 1;
            }
            if !m.at(x + 1, y) {
                out[v(x + 1, y)] |= 2;
            }
            if !m.at(x, y + 1) {
                out[v(x + 1, y + 1)] |= 4;
            }
            if !m.at(x - 1, y) {
                out[v(x, y + 1)] |= 8;
            }
        }
    }
    let mut loops = Vec::new();
    for start_v in 0..out.len() {
        while out[start_v] != 0 {
            let start_d = out[start_v].trailing_zeros() as usize;
            let (mut vx, mut vy, mut d) = ((start_v % vw) as i64, (start_v / vw) as i64, start_d);
            let mut edges: Vec<(i64, i64, usize)> = Vec::new();
            loop {
                out[vy as usize * vw + vx as usize] &= !(1 << d);
                edges.push((vx, vy, d));
                vx += DX[d];
                vy += DY[d];
                let vi = vy as usize * vw + vx as usize;
                // Right turn first: keeps diagonal inside pixels apart (4-connected inside).
                let mut next = None;
                for c in [(d + 1) % 4, d, (d + 3) % 4] {
                    if vi == start_v && c == start_d {
                        break;
                    }
                    if out[vi] & (1 << c) != 0 {
                        next = Some(c);
                        break;
                    }
                }
                match next {
                    Some(c) => d = c,
                    None => break,
                }
            }
            loops.push(refine(field, m, &edges));
        }
    }
    loops
}

/// Inside and outside pixel (layer-local) of a directed crack edge starting at vertex (vx, vy).
fn crack_pixels(vx: i64, vy: i64, d: usize) -> ((i64, i64), (i64, i64)) {
    match d {
        0 => ((vx, vy), (vx, vy - 1)),
        1 => ((vx - 1, vy), (vx, vy)),
        2 => ((vx - 1, vy - 1), (vx - 1, vy)),
        _ => ((vx, vy - 1), (vx - 1, vy - 1)),
    }
}

fn refine(field: &Field, m: &Mask, edges: &[(i64, i64, usize)]) -> Contour {
    let (ox, oy) = (m.x0 as f64, m.y0 as f64);
    let (iw, ih) = (field.w as i64, field.h as i64);
    let mut points: Vec<P> = Vec::with_capacity(edges.len() + 4);
    let mut pinned = Vec::with_capacity(edges.len() + 4);
    let mut hidden = Vec::with_capacity(edges.len() + 4);
    let mut saturated = Vec::with_capacity(edges.len() + 4);
    let n = edges.len();
    let is_border = |k: usize| {
        let (vx, vy, d) = edges[k % n];
        let (_, (px, py)) = crack_pixels(vx, vy, d);
        let (gx, gy) = (px + m.x0 as i64, py + m.y0 as i64);
        gx < 0 || gy < 0 || gx >= iw || gy >= ih
    };
    for (k, &(vx, vy, d)) in edges.iter().enumerate() {
        let a = [vx as f64 + ox, vy as f64 + oy];
        if is_border(k) {
            points.push(a);
            pinned.push(true);
            hidden.push(false);
            saturated.push(false);
            if !is_border(k + 1) {
                points.push([a[0] + DX[d] as f64, a[1] + DY[d] as f64]);
                pinned.push(true);
                hidden.push(false);
                saturated.push(false);
            }
            continue;
        }
        let ((ix, iy), (px, py)) = crack_pixels(vx, vy, d);
        let gi = (iy + m.y0 as i64) as usize * field.w + (ix + m.x0 as i64) as usize;
        let go = (py + m.y0 as i64) as usize * field.w + (px + m.x0 as i64) as usize;
        let (lo, hi) = (0.02, 0.98);
        let raw = field.crossing(gi, go);
        let t = raw.clamp(lo, hi);
        saturated.push(raw < lo || raw > hi);
        // Midpoint of the crack, moved along the inside→outside normal (dy, -dx).
        let mid = [a[0] + 0.5 * DX[d] as f64, a[1] + 0.5 * DY[d] as f64];
        let s = t - 0.5;
        points.push([mid[0] + s * DY[d] as f64, mid[1] - s * DX[d] as f64]);
        pinned.push(false);
        hidden.push(field.labels[gi] == field.labels[go]);
    }
    // Drop consecutive duplicates (border runs emit shared vertices twice).
    let mut c = Contour {
        points: Vec::with_capacity(points.len()),
        pinned: Vec::with_capacity(points.len()),
        hidden: Vec::with_capacity(points.len()),
        saturated: Vec::with_capacity(points.len()),
    };
    for (((p, f), h), sat) in points.into_iter().zip(pinned).zip(hidden).zip(saturated) {
        if c.points.last().is_some_and(|q| dist(*q, p) < 1e-9) {
            continue;
        }
        c.points.push(p);
        c.pinned.push(f);
        c.hidden.push(h);
        c.saturated.push(sat);
    }
    while c.points.len() > 1 && dist(c.points[0], *c.points.last().unwrap()) < 1e-9 {
        c.points.pop();
        c.pinned.pop();
        c.hidden.pop();
        c.saturated.pop();
    }
    c
}

// ---------------------------------------------------------------------------------------------
// Geometry helpers

fn sub(a: P, b: P) -> P {
    [a[0] - b[0], a[1] - b[1]]
}
fn add(a: P, b: P) -> P {
    [a[0] + b[0], a[1] + b[1]]
}
fn mul(a: P, s: f64) -> P {
    [a[0] * s, a[1] * s]
}
fn dot(a: P, b: P) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}
fn cross(a: P, b: P) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}
fn dist(a: P, b: P) -> f64 {
    let d = sub(a, b);
    (d[0] * d[0] + d[1] * d[1]).sqrt()
}
fn unit(a: P) -> P {
    let l = (a[0] * a[0] + a[1] * a[1]).sqrt();
    if l < 1e-12 { [0.0, 0.0] } else { [a[0] / l, a[1] / l] }
}

/// Polyline with cumulative arc length; `closed` wraps queries.
struct Poly<'a> {
    p: &'a [P],
    s: Vec<f64>,
    total: f64,
    closed: bool,
}

impl<'a> Poly<'a> {
    fn new(p: &'a [P], closed: bool) -> Self {
        let mut s = Vec::with_capacity(p.len() + 1);
        s.push(0.0);
        for k in 1..p.len() {
            s.push(s[k - 1] + dist(p[k - 1], p[k]));
        }
        let total = if closed && p.len() > 1 {
            s[p.len() - 1] + dist(p[p.len() - 1], p[0])
        } else {
            s[p.len() - 1]
        };
        Self { p, s, total, closed }
    }

    fn at(&self, s: f64) -> P {
        let s = if self.closed {
            s.rem_euclid(self.total)
        } else {
            s.clamp(0.0, self.total)
        };
        let k = self.s.partition_point(|&v| v <= s).saturating_sub(1);
        let (a, sa) = (self.p[k], self.s[k]);
        let (b, sb) = if k + 1 < self.p.len() {
            (self.p[k + 1], self.s[k + 1])
        } else {
            (self.p[0], self.total)
        };
        if sb - sa < 1e-12 {
            return a;
        }
        add(a, mul(sub(b, a), (s - sa) / (sb - sa)))
    }

    /// Unit tangent at vertex `k` from chords `scale` before and after (clamped on open polylines).
    fn tangent(&self, k: usize, scale: f64) -> P {
        unit(sub(self.at(self.s[k] + scale), self.at(self.s[k] - scale)))
    }
}

/// Corner indices: forced at border-run ends and border turns; otherwise chord angle at
/// `scale` ≥ threshold and a local maximum within ±scale.
pub fn corners(c: &Contour, opts: &Options) -> Vec<usize> {
    let n = c.points.len();
    let poly = Poly::new(&c.points, true);
    let cos_t = opts.corner_threshold.to_radians().cos();
    let mut angle = vec![1.0f64; n]; // cosine of the turn; smaller = sharper
    let mut forced = vec![false; n];
    for k in 0..n {
        if c.pinned[k] {
            let (prev, next) = (c.pinned[(k + n - 1) % n], c.pinned[(k + 1) % n]);
            let a = sub(c.points[k], c.points[(k + n - 1) % n]);
            let b = sub(c.points[(k + 1) % n], c.points[k]);
            forced[k] = !prev || !next || cross(a, b).abs() > 1e-9;
            continue;
        }
        let a = unit(sub(c.points[k], poly.at(poly.s[k] - opts.corner_scale)));
        let b = unit(sub(poly.at(poly.s[k] + opts.corner_scale), c.points[k]));
        angle[k] = dot(a, b);
    }
    let mut out = Vec::new();
    for k in 0..n {
        if forced[k] {
            out.push(k);
            continue;
        }
        if angle[k] > cos_t {
            continue;
        }
        // Non-maximum suppression over ±scale of arc length (ties: lower index wins).
        let mut is_max = true;
        for dir in [1i64, -1] {
            let mut j = k as i64;
            loop {
                j += dir;
                let jj = j.rem_euclid(n as i64) as usize;
                if jj == k {
                    break;
                }
                let sep = (poly.s[jj] - poly.s[k]).abs();
                let sep = sep.min(poly.total - sep);
                if sep > opts.corner_scale {
                    break;
                }
                if angle[jj] < angle[k] || (angle[jj] == angle[k] && jj < k) || forced[jj] {
                    is_max = false;
                    break;
                }
            }
            if !is_max {
                break;
            }
        }
        if is_max {
            out.push(k);
        }
    }
    out
}

/// Fits one refined loop. `None` for degenerate loops.
/// Smooths a polyline in place; `closed` wraps, otherwise both ends stay fixed. Pinned points
/// never move.
fn smooth(p: &mut [P], pinned: &[bool], closed: bool, mode: Smoothing) {
    let n = p.len();
    if n < 3 {
        return;
    }
    let weights: Vec<f64> = match mode {
        Smoothing::None => return,
        Smoothing::Binomial(k) => vec![0.5; k as usize],
        Smoothing::Taubin(k) => (0..k).flat_map(|_| [0.5, -0.53]).collect(),
    };
    for w in weights {
        let q = p.to_vec();
        let (lo, hi) = if closed { (0, n) } else { (1, n - 1) };
        for k in lo..hi {
            if pinned[k] {
                continue;
            }
            let (a, b) = (q[(k + n - 1) % n], q[(k + 1) % n]);
            p[k] = [
                q[k][0] + w * ((a[0] + b[0]) / 2.0 - q[k][0]),
                q[k][1] + w * ((a[1] + b[1]) / 2.0 - q[k][1]),
            ];
        }
    }
}

/// Points of an open polyline between arc lengths `a` and `b` (interpolated ends).
fn sub_polyline(pts: &[P], a: f64, b: f64) -> Vec<P> {
    let poly = Poly::new(pts, false);
    let mut out = vec![poly.at(a)];
    for (k, &s) in poly.s.iter().enumerate() {
        if s > a + 1e-9 && s < b - 1e-9 {
            out.push(pts[k]);
        }
    }
    out.push(poly.at(b));
    out
}

/// Direction of travel at the start and end of a fitted chain starting at `start`.
fn chain_tangents(start: P, segs: &[Seg]) -> (P, P) {
    let mut prev = start;
    let mut first = None;
    let mut last = [0.0, 0.0];
    for s in segs {
        let (t0, t1, end) = match *s {
            Seg::Line(e) => (sub(e, prev), sub(e, prev), e),
            Seg::Cubic(c) => {
                let (c1, c2, e) = ([c[0], c[1]], [c[2], c[3]], [c[4], c[5]]);
                let t0 = if dist(c1, prev) > 1e-9 {
                    sub(c1, prev)
                } else {
                    sub(c2, prev)
                };
                let t1 = if dist(e, c2) > 1e-9 { sub(e, c2) } else { sub(e, c1) };
                (t0, t1, e)
            }
        };
        first.get_or_insert(unit(t0));
        last = unit(t1);
        prev = end;
    }
    (first.unwrap_or([0.0, 0.0]), last)
}

/// Corner point from the tangent lines ending one section (`p1`, travel `d1`) and starting the
/// next (`p2`, travel `d2`), if they meet ahead of `p1` and behind `p2` near the detected corner.
fn corner_point(p1: P, d1: P, p2: P, d2: P, near: P, reach: f64) -> Option<P> {
    let det = cross(d1, d2);
    if det.abs() < 0.17 {
        return None; // nearly parallel (< 10°)
    }
    let w = sub(p2, p1);
    let (s, u) = (cross(w, d2) / det, cross(d1, w) / det);
    let x = add(p1, mul(d1, s));
    ((0.0..=reach).contains(&s) && (0.0..=reach).contains(&u) && dist(x, near) <= reach).then_some(x)
}

/// Keep-mask that drops saturated crossings in runs of at most 3 between reliable points:
/// the neighbours then define the edge where segmentation misplaced a blend pixel. Longer runs
/// (thin features, regions without sub-pixel evidence) and protected points are kept.
fn keep_reliable(saturated: &[bool], protect: &[bool], closed: bool) -> Vec<bool> {
    let n = saturated.len();
    let mut keep = vec![true; n];
    if saturated.iter().all(|s| *s) {
        return keep;
    }
    let mut k = 0;
    while k < n {
        let prev_ok = if closed {
            !saturated[(k + n - 1) % n]
        } else {
            k > 0 && !saturated[k - 1]
        };
        if saturated[k] && prev_ok {
            let mut len = 0;
            while len < n && (closed || k + len < n) && saturated[(k + len) % n] {
                len += 1;
            }
            let bounded = closed || k + len < n;
            if len <= 3 && bounded {
                for j in 0..len {
                    if !protect[(k + j) % n] {
                        keep[(k + j) % n] = false;
                    }
                }
            }
            k += len.max(1);
        } else {
            k += 1;
        }
    }
    keep
}

fn filter<T: Copy>(v: &[T], keep: &[bool]) -> Vec<T> {
    v.iter().zip(keep).filter(|(_, k)| **k).map(|(x, _)| *x).collect()
}

pub fn fit_contour(c: &Contour, opts: &Options) -> Option<FittedLoop> {
    if c.points.len() < 3 {
        return None;
    }
    let cs = corners(c, opts);
    let n = c.points.len();
    let mut segs = Vec::new();
    if cs.is_empty() {
        let keep = keep_reliable(&c.saturated, &c.pinned, true);
        let mut pts = filter(&c.points, &keep);
        let pinned = filter(&c.pinned, &keep);
        let n = pts.len();
        if n < 3 {
            return None;
        }
        smooth(&mut pts, &pinned, true, opts.smoothing);
        let c = &Contour {
            points: pts,
            hidden: vec![false; n],
            saturated: vec![false; n],
            pinned,
        };
        let poly = Poly::new(&c.points, true);
        if opts.arcs
            && let Some(circle) = fit_circle(&c.points)
            && circle_ok(&c.points, &circle, true)
        {
            let start = c.points[0];
            full_circle(&circle, start, signed_area(&c.points) > 0.0, &mut segs);
            return Some(FittedLoop {
                start,
                segs,
                recognised: 1,
            });
        }
        // Four pieces of equal arc length with shared tangents at the joins.
        let mut idx: Vec<usize> = (0..4)
            .map(|q| poly.s.partition_point(|&v| v < poly.total * q as f64 / 4.0).min(n - 1))
            .collect();
        idx.dedup();
        if idx.len() < 3 {
            // A loop too small to split: its own vertices as a polygon.
            let segs = (1..=n).map(|k| Seg::Line(c.points[k % n])).collect();
            return Some(FittedLoop {
                start: c.points[0],
                segs,
                recognised: 0,
            });
        }
        let tan: Vec<P> = idx.iter().map(|&k| poly.tangent(k, opts.corner_scale)).collect();
        let m = idx.len();
        for q in 0..m {
            let (a, b) = (idx[q], idx[(q + 1) % m]);
            let piece = slice_wrap(&c.points, a, b);
            fit_open(&piece, tan[q], mul(tan[(q + 1) % m], -1.0), opts, &mut segs, 0);
        }
        return Some(FittedLoop {
            start: c.points[idx[0]],
            segs,
            recognised: 0,
        })
        .filter(|l| !l.segs.is_empty());
    }
    // Sections between corners. At a sharpenable corner, the antialiasing-rounded zone is
    // trimmed off both sides, each side is fitted, and the corner is rebuilt where the two end
    // tangents meet; each section is then refitted to end exactly there (no straight stubs).
    let m = cs.len();
    let poly = Poly::new(&c.points, true);
    let trim: Vec<f64> = cs
        .iter()
        .map(|&k| {
            let a = unit(sub(c.points[k], poly.at(poly.s[k] - opts.corner_scale)));
            let b = unit(sub(poly.at(poly.s[k] + opts.corner_scale), c.points[k]));
            let interior = std::f64::consts::PI - dot(a, b).clamp(-1.0, 1.0).acos();
            (0.75 * opts.corner_scale + 0.5 / (interior / 2.0).tan().max(0.2)).min(3.0 * opts.corner_scale)
        })
        .collect();
    let sharp: Vec<bool> = (0..m)
        .map(|j| {
            let k = cs[j];
            let reach = 1.5 * trim[j];
            opts.sharpen
                && !c.pinned[k]
                && !(0..n).any(|i| {
                    let d = (poly.s[i] - poly.s[k]).abs();
                    d.min(poly.total - d) <= reach && c.hidden[i]
                })
        })
        .collect();
    struct Sec {
        body: Vec<P>,
        t0: P,
        t1: P,
        trimmed: (bool, bool),
    }
    // A single corner: split its loop at the opposite point so no section closes on itself.
    let (cs, trim, sharp) = if m == 1 {
        let half = poly
            .s
            .partition_point(|&v| v < (poly.s[cs[0]] + poly.total / 2.0) % poly.total)
            .min(n - 1);
        let mut v = [(cs[0], trim[0], sharp[0]), (half, 0.0, false)];
        v.sort_by_key(|x| x.0);
        (
            v.iter().map(|x| x.0).collect::<Vec<_>>(),
            v.iter().map(|x| x.1).collect::<Vec<_>>(),
            v.iter().map(|x| x.2).collect::<Vec<_>>(),
        )
    } else {
        (cs, trim, sharp)
    };
    let m = cs.len();
    let mut secs = Vec::with_capacity(m);
    for j in 0..m {
        let (a, b) = (cs[j], cs[(j + 1) % m]);
        let raw = slice_wrap(&c.points, a, b);
        let len_raw = raw.len();
        let pins_raw: Vec<bool> = (0..len_raw).map(|k| c.pinned[(a + k) % n]).collect();
        let sat_raw: Vec<bool> = (0..len_raw).map(|k| c.saturated[(a + k) % n]).collect();
        let mut protect = pins_raw.clone();
        protect[0] = true;
        protect[len_raw - 1] = true;
        let keep = keep_reliable(&sat_raw, &protect, false);
        let mut piece = filter(&raw, &keep);
        let pins = filter(&pins_raw, &keep);
        smooth(&mut piece, &pins, false, opts.smoothing);
        let len = Poly::new(&piece, false).total;
        let jn = (j + 1) % m;
        let (ta, tb) = (sharp[j], sharp[jn]);
        let (ta, tb) = if len >= 2.0 * (trim[j] + trim[jn]) {
            (ta, tb)
        } else {
            (false, false)
        };
        let body = if ta || tb {
            sub_polyline(
                &piece,
                if ta { trim[j] } else { 0.0 },
                len - if tb { trim[jn] } else { 0.0 },
            )
        } else {
            piece
        };
        let mut first = Vec::new();
        let _ = fit_section(&body, opts, &mut first);
        let (t0, t1) = chain_tangents(body[0], &first);
        secs.push(Sec {
            body,
            t0,
            t1,
            trimmed: (ta, tb),
        });
    }
    // Junction j: between section j-1's end and section j's start.
    let joints: Vec<P> = (0..m)
        .map(|j| {
            let (prev, next) = (&secs[(j + m - 1) % m], &secs[j]);
            let (pe, ns) = (prev.body[prev.body.len() - 1], next.body[0]);
            if !prev.trimmed.1 || !next.trimmed.0 {
                return ns;
            }
            corner_point(pe, prev.t1, ns, next.t0, c.points[cs[j]], 2.0 * opts.corner_scale).unwrap_or(c.points[cs[j]])
        })
        .collect();
    let mut recognised = 0;
    for j in 0..m {
        let sec = &secs[j];
        let mut pts = Vec::with_capacity(sec.body.len() + 2);
        if dist(joints[j], sec.body[0]) > 1e-9 {
            pts.push(joints[j]);
        }
        pts.extend_from_slice(&sec.body);
        let end = joints[(j + 1) % m];
        if dist(end, sec.body[sec.body.len() - 1]) > 1e-9 {
            pts.push(end);
        }
        recognised += fit_section(&pts, opts, &mut segs);
    }
    if segs.is_empty() {
        // Degenerate sections: keep the refined outline as a polygon rather than dropping it.
        let segs = (1..=n).map(|k| Seg::Line(c.points[k % n])).collect();
        return Some(FittedLoop {
            start: c.points[0],
            segs,
            recognised: 0,
        });
    }
    Some(FittedLoop {
        start: joints[0],
        segs,
        recognised,
    })
}

/// Points a..=b following the loop (wrapping); a == b gives the whole loop back to a.
fn slice_wrap(p: &[P], a: usize, b: usize) -> Vec<P> {
    let n = p.len();
    let len = if b > a { b - a } else { b + n - a };
    (0..=len).map(|k| p[(a + k) % n]).collect()
}

/// Open section between two corners: line, recognised arc, or G1 cubic chain. Returns 1 when
/// the section was replaced by a recognised circular arc.
fn fit_section(pts: &[P], opts: &Options, out: &mut Vec<Seg>) -> usize {
    let (p0, p1) = (pts[0], pts[pts.len() - 1]);
    let chord = sub(p1, p0);
    let len = dist(p0, p1);
    if len > 1e-9
        && pts
            .iter()
            .all(|&q| (cross(chord, sub(q, p0)) / len).abs() <= opts.tolerance)
    {
        out.push(Seg::Line(p1));
        return 0;
    }
    if opts.arcs
        && let Some(circle) = fit_circle(pts)
        && circle_ok(pts, &circle, false)
    {
        arc(&circle, pts, out);
        return 1;
    }
    let poly = Poly::new(pts, false);
    let l = opts.corner_scale.min(poly.total / 3.0);
    let t1 = unit(sub(poly.at(l), p0));
    let t2 = unit(sub(poly.at(poly.total - l), p1));
    fit_open(pts, t1, t2, opts, out, 0);
    0
}

fn bez(p: &[P; 4], u: f64) -> P {
    let v = 1.0 - u;
    let (b0, b1, b2, b3) = (v * v * v, 3.0 * u * v * v, 3.0 * u * u * v, u * u * u);
    [
        b0 * p[0][0] + b1 * p[1][0] + b2 * p[2][0] + b3 * p[3][0],
        b0 * p[0][1] + b1 * p[1][1] + b2 * p[2][1] + b3 * p[3][1],
    ]
}

fn bez_d1(p: &[P; 4], u: f64) -> P {
    let v = 1.0 - u;
    let d = |k: usize| {
        3.0 * (v * v * (p[1][k] - p[0][k]) + 2.0 * u * v * (p[2][k] - p[1][k]) + u * u * (p[3][k] - p[2][k]))
    };
    [d(0), d(1)]
}

fn bez_d2(p: &[P; 4], u: f64) -> P {
    let d =
        |k: usize| 6.0 * ((1.0 - u) * (p[2][k] - 2.0 * p[1][k] + p[0][k]) + u * (p[3][k] - 2.0 * p[2][k] + p[1][k]));
    [d(0), d(1)]
}

/// Least-squares cubic with fixed end tangents (`t1` leaves `pts[0]`, `t2` leaves the last
/// point back into the curve); splits at the worst point with a shared tangent until every
/// sample is within tolerance.
fn fit_open(pts: &[P], t1: P, t2: P, opts: &Options, out: &mut Vec<Seg>, depth: u32) {
    let n = pts.len();
    let (p0, p3) = (pts[0], pts[n - 1]);
    let len = dist(p0, p3);
    if n <= 2 || len < 1e-9 {
        if len >= 1e-9 {
            out.push(Seg::Line(p3));
        }
        return;
    }
    let mut u = chord_params(pts);
    let mut c = generate(pts, &u, t1, t2);
    let tol2 = opts.tolerance * opts.tolerance;
    let (mut err, mut split) = max_error(pts, &c, &u);
    if err > tol2 && err < 16.0 * tol2 {
        for _ in 0..8 {
            for (k, q) in pts.iter().enumerate() {
                u[k] = newton(&c, *q, u[k]);
            }
            c = generate(pts, &u, t1, t2);
            (err, split) = max_error(pts, &c, &u);
            if err <= tol2 {
                break;
            }
        }
    }
    if err <= tol2 || depth >= 24 || n < 4 {
        out.push(Seg::Cubic([c[1][0], c[1][1], c[2][0], c[2][1], c[3][0], c[3][1]]));
        return;
    }
    let split = split.clamp(1, n - 2);
    let poly = Poly::new(pts, false);
    let tc = poly.tangent(
        split,
        opts.corner_scale
            .min(poly.s[split])
            .min(poly.total - poly.s[split])
            .max(0.5),
    );
    fit_open(&pts[..=split], t1, mul(tc, -1.0), opts, out, depth + 1);
    fit_open(&pts[split..], tc, t2, opts, out, depth + 1);
}

fn chord_params(pts: &[P]) -> Vec<f64> {
    let mut u = vec![0.0; pts.len()];
    for k in 1..pts.len() {
        u[k] = u[k - 1] + dist(pts[k - 1], pts[k]);
    }
    let total = u[pts.len() - 1];
    u.iter().map(|v| v / total).collect()
}

fn generate(pts: &[P], u: &[f64], t1: P, t2: P) -> [P; 4] {
    let (p0, p3) = (pts[0], pts[pts.len() - 1]);
    let (mut c00, mut c01, mut c11, mut x0, mut x1) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for (q, &t) in pts.iter().zip(u) {
        let v = 1.0 - t;
        let (b0, b1, b2, b3) = (v * v * v, 3.0 * t * v * v, 3.0 * t * t * v, t * t * t);
        let a1 = mul(t1, b1);
        let a2 = mul(t2, b2);
        c00 += dot(a1, a1);
        c01 += dot(a1, a2);
        c11 += dot(a2, a2);
        let tmp = sub(*q, add(mul(p0, b0 + b1), mul(p3, b2 + b3)));
        x0 += dot(a1, tmp);
        x1 += dot(a2, tmp);
    }
    let det = c00 * c11 - c01 * c01;
    let len = dist(p0, p3);
    let (mut al, mut ar) = if det.abs() > 1e-12 {
        ((x0 * c11 - x1 * c01) / det, (c00 * x1 - c01 * x0) / det)
    } else {
        (0.0, 0.0)
    };
    if al < 1e-6 * len || ar < 1e-6 * len || al > 2.0 * len || ar > 2.0 * len {
        al = len / 3.0;
        ar = len / 3.0;
    }
    [p0, add(p0, mul(t1, al)), add(p3, mul(t2, ar)), p3]
}

fn max_error(pts: &[P], c: &[P; 4], u: &[f64]) -> (f64, usize) {
    let mut best = (0.0, pts.len() / 2);
    for k in 1..pts.len() - 1 {
        let d = sub(bez(c, u[k]), pts[k]);
        let e = dot(d, d);
        if e > best.0 {
            best = (e, k);
        }
    }
    best
}

fn newton(c: &[P; 4], q: P, u: f64) -> f64 {
    let d = sub(bez(c, u), q);
    let (d1, d2) = (bez_d1(c, u), bez_d2(c, u));
    let den = dot(d1, d1) + dot(d, d2);
    if den.abs() < 1e-12 {
        return u;
    }
    (u - dot(d, d1) / den).clamp(0.0, 1.0)
}

fn signed_area(p: &[P]) -> f64 {
    (0..p.len()).map(|k| cross(p[k], p[(k + 1) % p.len()])).sum::<f64>() / 2.0
}

// ---------------------------------------------------------------------------------------------
// Conservative circle / arc recognition (evaluation option `arcs`).

#[derive(Debug, Clone, Copy)]
pub struct Circle {
    pub cx: f64,
    pub cy: f64,
    pub r: f64,
}

/// Algebraic (Kåsa) fit refined by Gauss–Newton on geometric distance.
pub fn fit_circle(pts: &[P]) -> Option<Circle> {
    let n = pts.len() as f64;
    if pts.len() < 6 {
        return None;
    }
    let (mx, my) = (
        pts.iter().map(|p| p[0]).sum::<f64>() / n,
        pts.iter().map(|p| p[1]).sum::<f64>() / n,
    );
    let (mut suu, mut suv, mut svv, mut suuu, mut svvv, mut suvv, mut svuu) = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    for p in pts {
        let (u, v) = (p[0] - mx, p[1] - my);
        suu += u * u;
        suv += u * v;
        svv += v * v;
        suuu += u * u * u;
        svvv += v * v * v;
        suvv += u * v * v;
        svuu += v * u * u;
    }
    let det = suu * svv - suv * suv;
    if det.abs() < 1e-9 {
        return None;
    }
    let (bu, bv) = (0.5 * (suuu + suvv), 0.5 * (svvv + svuu));
    let uc = (bu * svv - bv * suv) / det;
    let vc = (suu * bv - suv * bu) / det;
    let mut c = Circle {
        cx: uc + mx,
        cy: vc + my,
        r: (uc * uc + vc * vc + (suu + svv) / n).sqrt(),
    };
    for _ in 0..20 {
        // Gauss–Newton on r_i = |p - c| - r with unknowns (cx, cy, r).
        let mut jtj = [[0.0f64; 3]; 3];
        let mut jtr = [0.0f64; 3];
        for p in pts {
            let (dx, dy) = (p[0] - c.cx, p[1] - c.cy);
            let d = (dx * dx + dy * dy).sqrt();
            if d < 1e-12 {
                return None;
            }
            let j = [-dx / d, -dy / d, -1.0];
            let res = d - c.r;
            for a in 0..3 {
                jtr[a] += j[a] * res;
                for b in 0..3 {
                    jtj[a][b] += j[a] * j[b];
                }
            }
        }
        let step = solve3(jtj, jtr.map(|v| -v))?;
        c.cx += step[0];
        c.cy += step[1];
        c.r += step[2];
        if step.iter().map(|v| v.abs()).fold(0.0, f64::max) < 1e-10 {
            break;
        }
    }
    (c.r.is_finite() && c.r > 0.0).then_some(c)
}

fn solve3(a: [[f64; 3]; 3], b: [f64; 3]) -> Option<[f64; 3]> {
    let det = |m: [[f64; 3]; 3]| {
        m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
            + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    };
    let d = det(a);
    if d.abs() < 1e-14 {
        return None;
    }
    let mut x = [0.0; 3];
    for (k, xk) in x.iter_mut().enumerate() {
        let mut m = a;
        for r in 0..3 {
            m[r][k] = b[r];
        }
        *xk = det(m) / d;
    }
    Some(x)
}

/// Acceptance: residuals consistent with sampling noise only, a real radius, and (for open
/// sections) enough bend that a circle is distinguishable from a line.
fn circle_ok(pts: &[P], c: &Circle, closed: bool) -> bool {
    if !(2.5..=1.0e5).contains(&c.r) {
        return false;
    }
    let res: Vec<f64> = pts
        .iter()
        .map(|p| ((p[0] - c.cx).hypot(p[1] - c.cy) - c.r).abs())
        .collect();
    let rms = (res.iter().map(|v| v * v).sum::<f64>() / res.len() as f64).sqrt();
    let max = res.iter().copied().fold(0.0, f64::max);
    if rms > 0.08 || max > 0.3 {
        return false;
    }
    if closed {
        return true;
    }
    // Sagitta of the section must exceed 1 px.
    let (a, b) = (pts[0], pts[pts.len() - 1]);
    let len = dist(a, b);
    let sag = pts
        .iter()
        .map(|q| (cross(sub(b, a), sub(*q, a)) / len.max(1e-9)).abs())
        .fold(0.0, f64::max);
    sag >= 1.0
}

/// Cubic approximation of a circular arc from `a` to `b` (exact endpoints), centre `c`.
fn arc_pieces(c: &Circle, a: P, b: P, sweep: f64, out: &mut Vec<Seg>) {
    let pieces = (sweep.abs() / std::f64::consts::FRAC_PI_2).ceil().max(1.0) as usize;
    let a0 = (a[1] - c.cy).atan2(a[0] - c.cx);
    let step = sweep / pieces as f64;
    let k = 4.0 / 3.0 * (step / 4.0).tan() * c.r;
    let mut prev = a;
    for i in 1..=pieces {
        let (t0, t1) = (a0 + step * (i - 1) as f64, a0 + step * i as f64);
        let end = if i == pieces {
            b
        } else {
            [c.cx + c.r * t1.cos(), c.cy + c.r * t1.sin()]
        };
        let c1 = add(prev, mul([-t0.sin(), t0.cos()], k));
        let c2 = sub(end, mul([-t1.sin(), t1.cos()], k));
        out.push(Seg::Cubic([c1[0], c1[1], c2[0], c2[1], end[0], end[1]]));
        prev = end;
    }
}

fn arc(c: &Circle, pts: &[P], out: &mut Vec<Seg>) {
    let ang = |p: P| (p[1] - c.cy).atan2(p[0] - c.cx);
    let (a, b) = (pts[0], pts[pts.len() - 1]);
    // Unwrapped sweep following the samples.
    let mut sweep = 0.0;
    for w in pts.windows(2) {
        let mut d = ang(w[1]) - ang(w[0]);
        if d > std::f64::consts::PI {
            d -= std::f64::consts::TAU;
        } else if d < -std::f64::consts::PI {
            d += std::f64::consts::TAU;
        }
        sweep += d;
    }
    arc_pieces(c, a, b, sweep, out);
}

fn full_circle(c: &Circle, start: P, positive: bool, out: &mut Vec<Seg>) {
    let sweep = if positive {
        std::f64::consts::TAU
    } else {
        -std::f64::consts::TAU
    };
    arc_pieces(c, start, start, sweep, out);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn disc_image(cx: f64, cy: f64, r: f64, w: usize) -> Vec<u8> {
        let mut px = vec![0u8; w * w * 4];
        for y in 0..w {
            for x in 0..w {
                let mut hits = 0;
                for sy in 0..8 {
                    for sx in 0..8 {
                        let (fx, fy) = (x as f64 + (sx as f64 + 0.5) / 8.0, y as f64 + (sy as f64 + 0.5) / 8.0);
                        hits += usize::from((fx - cx).powi(2) + (fy - cy).powi(2) <= r * r);
                    }
                }
                let v = 255 - (hits * 255 / 64) as u8;
                px[(y * w + x) * 4..(y * w + x) * 4 + 4].copy_from_slice(&[v, v, v, 255]);
            }
        }
        px
    }

    fn mask_of(data: &[u8], w: usize) -> Mask {
        let luma = Luma::new();
        Mask {
            x0: 0,
            y0: 0,
            w,
            h: w,
            bits: data
                .chunks_exact(4)
                .map(|p| luma.luma(p[0], p[1], p[2]) < 128)
                .collect(),
        }
    }

    #[test]
    fn refined_disc_contour_is_within_a_tenth_of_a_pixel() {
        let (w, cx, cy, r) = (64, 31.3, 32.6, 20.0);
        let data = disc_image(cx, cy, r, w);
        let img = RgbaImage::new(&data, w as u32, w as u32, 1 << 20).unwrap();
        let luma = Luma::new();
        let policy = EdgePolicy::Luma {
            threshold: 128,
            invert: false,
            alpha_threshold: 128,
        };
        let field = Field::new(img, &luma, policy, Subpixel::Area, std::iter::once(mask_of(&data, w)));
        let cs = contours(&field, &mask_of(&data, w));
        assert_eq!(cs.len(), 1);
        let max = cs[0]
            .points
            .iter()
            .map(|p| ((p[0] - cx).hypot(p[1] - cy) - r).abs())
            .fold(0.0, f64::max);
        assert!(max < 0.1, "max radial deviation {max}");
        let fitted = fit_contour(&cs[0], &Options::production(60)).unwrap();
        assert!(fitted.segs.len() <= 8, "{} segments", fitted.segs.len());
    }

    #[test]
    fn hole_and_saddle_topology() {
        // A ring (one hole) and two pixels touching diagonally (two components).
        let w = 12;
        let mut bits = vec![false; w * w];
        for y in 2..9 {
            for x in 2..9 {
                bits[y * w + x] = !(4..7).contains(&x) || !(4..7).contains(&y);
            }
        }
        bits[10 * w + 10] = true;
        bits[11 * w + 11] = true;
        let m = Mask {
            x0: 0,
            y0: 0,
            w,
            h: w,
            bits,
        };
        let data = vec![0u8; w * w * 4];
        let img = RgbaImage::new(&data, w as u32, w as u32, 1 << 20).unwrap();
        let luma = Luma::new();
        let policy = EdgePolicy::Color { alpha_threshold: 128 };
        let field = Field::new(img, &luma, policy, Subpixel::Off, std::iter::once(m.clone()));
        let cs = contours(&field, &m);
        assert_eq!(cs.len(), 4, "outer ring, hole, two diagonal pixels");
        let areas: Vec<f64> = cs.iter().map(|c| signed_area(&c.points)).collect();
        assert_eq!(areas.iter().filter(|a| **a > 0.0).count(), 3);
    }

    #[test]
    fn circle_recognition_rejects_wobbly_outline() {
        let wobbly: Vec<P> = (0..200)
            .map(|k| {
                let t = k as f64 * std::f64::consts::TAU / 200.0;
                let r = 30.0 * (1.0 + 0.03 * (5.0 * t).sin());
                [50.0 + r * t.cos(), 50.0 + r * t.sin()]
            })
            .collect();
        let c = fit_circle(&wobbly).unwrap();
        assert!(!circle_ok(&wobbly, &c, true));
        let round: Vec<P> = (0..200)
            .map(|k| {
                let t = k as f64 * std::f64::consts::TAU / 200.0;
                [50.0 + 30.0 * t.cos(), 50.0 + 30.0 * t.sin()]
            })
            .collect();
        let c = fit_circle(&round).unwrap();
        assert!(circle_ok(&round, &c, true) && (c.r - 30.0).abs() < 1e-6);
    }
}
