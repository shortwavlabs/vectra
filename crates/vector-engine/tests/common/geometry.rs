//! Analytic ground truth and geometric-fidelity metrics (P0-R-GEO).
//!
//! A fixture is a painted stack of analytic shapes. Its *visible* boundary (what a viewer
//! sees after later shapes occlude earlier ones) is sampled densely and is the only ground
//! truth; hidden boundaries are never scored. Traced scenes are sampled the same way, with
//! visibility decided by the later paths. All distances are in source pixels.
#![allow(dead_code)]

use serde::Serialize;
use vector_engine::scene::{FillRule, Scene};

pub type P = [f64; 2];

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
fn norm(a: P) -> f64 {
    a[0].hypot(a[1])
}
fn unit(a: P) -> P {
    let l = norm(a);
    if l < 1e-15 { [0.0, 0.0] } else { mul(a, 1.0 / l) }
}
fn rot(a: P, t: f64) -> P {
    let (s, c) = t.sin_cos();
    [a[0] * c - a[1] * s, a[0] * s + a[1] * c]
}

#[derive(Clone, Debug)]
pub enum Shape {
    Circle {
        c: P,
        r: f64,
    },
    /// Semi-axes `a` (along `rot` radians) and `b`.
    Ellipse {
        c: P,
        a: f64,
        b: f64,
        rot: f64,
    },
    /// Simple polygon (any orientation).
    Polygon(Vec<P>),
    /// Rectangle `w`×`h` centred on `c`, corner radius `r`, rotated by `rot` radians.
    RoundRect {
        c: P,
        w: f64,
        h: f64,
        r: f64,
        rot: f64,
    },
    /// Star-shaped organic outline r(θ) = r·(1 + Σ amp·sin(k·θ + phase)).
    Polar {
        c: P,
        r: f64,
        terms: Vec<(f64, f64, f64)>,
    },
    /// Points of the first shape not in the second.
    Diff(Box<Shape>, Box<Shape>),
}

/// What a boundary sample belongs to, with its analytic parameters for per-primitive metrics.
#[derive(Clone, Debug, Serialize)]
pub enum Prim {
    Circle { c: P, r: f64 },
    Ellipse { c: P, a: f64, b: f64, rot: f64 },
    Line,
    Organic,
}

#[derive(Clone, Copy, Debug)]
pub struct Sample {
    pub p: P,
    /// Unit tangent (boundary traversed with the shape interior on the left in y-down axes
    /// is irrelevant here: only |tangent| direction is used) and outward unit normal.
    pub t: P,
    pub n: P,
    /// Index into `Truth::prims`.
    pub prim: usize,
}

impl Shape {
    pub fn inside(&self, p: P) -> bool {
        match self {
            Shape::Circle { c, r } => norm(sub(p, *c)) <= *r,
            Shape::Ellipse { c, a, b, rot: t } => {
                let q = rot(sub(p, *c), -t);
                (q[0] / a).powi(2) + (q[1] / b).powi(2) <= 1.0
            }
            Shape::Polygon(pts) => {
                let mut inside = false;
                let n = pts.len();
                for i in 0..n {
                    let (a, b) = (pts[i], pts[(i + n - 1) % n]);
                    if (a[1] > p[1]) != (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0] {
                        inside = !inside;
                    }
                }
                inside
            }
            Shape::RoundRect { c, w, h, r, rot: t } => {
                let q = rot(sub(p, *c), -t);
                let (dx, dy) = (
                    (q[0].abs() - (w / 2.0 - r)).max(0.0),
                    (q[1].abs() - (h / 2.0 - r)).max(0.0),
                );
                q[0].abs() <= w / 2.0 && q[1].abs() <= h / 2.0 && dx * dx + dy * dy <= r * r
            }
            Shape::Polar { c, r, terms } => {
                let d = sub(p, *c);
                let th = d[1].atan2(d[0]);
                norm(d) <= polar_r(*r, terms, th)
            }
            Shape::Diff(a, b) => a.inside(p) && !b.inside(p),
        }
    }

    /// Dense boundary samples (spacing ≈ `ds`), each with tangent and outward normal.
    fn boundary(&self, ds: f64, prims: &mut Vec<Prim>, out: &mut Vec<Sample>) {
        match self {
            Shape::Circle { c, r } => {
                let id = push(prims, Prim::Circle { c: *c, r: *r });
                let n = ((std::f64::consts::TAU * r) / ds).ceil().max(16.0) as usize;
                for k in 0..n {
                    let th = k as f64 * std::f64::consts::TAU / n as f64;
                    let u = [th.cos(), th.sin()];
                    out.push(Sample {
                        p: add(*c, mul(u, *r)),
                        t: [-u[1], u[0]],
                        n: u,
                        prim: id,
                    });
                }
            }
            Shape::Ellipse { c, a, b, rot: t } => {
                let id = push(
                    prims,
                    Prim::Ellipse {
                        c: *c,
                        a: *a,
                        b: *b,
                        rot: *t,
                    },
                );
                let per = std::f64::consts::PI * (3.0 * (a + b) - ((3.0 * a + b) * (a + 3.0 * b)).sqrt());
                let n = (per / ds * 2.0).ceil().max(32.0) as usize;
                for k in 0..n {
                    let th = k as f64 * std::f64::consts::TAU / n as f64;
                    let q = [a * th.cos(), b * th.sin()];
                    let tq = unit([-a * th.sin(), b * th.cos()]);
                    let tt = rot(tq, *t);
                    out.push(Sample {
                        p: add(*c, rot(q, *t)),
                        t: tt,
                        n: [tt[1], -tt[0]],
                        prim: id,
                    });
                }
            }
            Shape::Polygon(pts) => {
                let ccw = signed_area(pts) > 0.0;
                let n = pts.len();
                for i in 0..n {
                    let id = push(prims, Prim::Line);
                    let (a, b) = (pts[i], pts[(i + 1) % n]);
                    let len = norm(sub(b, a));
                    let t = unit(sub(b, a));
                    // y-down axes: for positive signed area, the outward normal is (t.y, -t.x).
                    let nn = if ccw { [t[1], -t[0]] } else { [-t[1], t[0]] };
                    let m = (len / ds).ceil().max(2.0) as usize;
                    for k in 0..m {
                        out.push(Sample {
                            p: add(a, mul(sub(b, a), k as f64 / m as f64)),
                            t,
                            n: nn,
                            prim: id,
                        });
                    }
                }
            }
            Shape::RoundRect { c, w, h, r, rot: t } => {
                let (hw, hh) = (w / 2.0 - r, h / 2.0 - r);
                let corners = [[hw, hh], [-hw, hh], [-hw, -hh], [hw, -hh]];
                for (q, cc) in corners.iter().enumerate() {
                    let id = push(
                        prims,
                        Prim::Circle {
                            c: add(*c, rot(*cc, *t)),
                            r: *r,
                        },
                    );
                    let th0 = q as f64 * std::f64::consts::FRAC_PI_2;
                    let m = ((std::f64::consts::FRAC_PI_2 * r) / ds).ceil().max(4.0) as usize;
                    for k in 0..m {
                        let th = th0 + k as f64 * std::f64::consts::FRAC_PI_2 / m as f64;
                        let u = rot([th.cos(), th.sin()], *t);
                        out.push(Sample {
                            p: add(add(*c, rot(*cc, *t)), mul(u, *r)),
                            t: [-u[1], u[0]],
                            n: u,
                            prim: id,
                        });
                    }
                    // Straight side from this corner's arc end to the next corner's arc start.
                    let next = corners[(q + 1) % 4];
                    let th1 = th0 + std::f64::consts::FRAC_PI_2;
                    let u1 = [th1.cos(), th1.sin()];
                    let a = add(*cc, mul(u1, *r));
                    let b = add(next, mul(u1, *r));
                    let len = norm(sub(b, a));
                    if len > 1e-9 {
                        let id = push(prims, Prim::Line);
                        let m = (len / ds).ceil().max(2.0) as usize;
                        let uu = rot(u1, *t);
                        for k in 0..m {
                            let pp = add(a, mul(sub(b, a), k as f64 / m as f64));
                            out.push(Sample {
                                p: add(*c, rot(pp, *t)),
                                t: [-uu[1], uu[0]],
                                n: uu,
                                prim: id,
                            });
                        }
                    }
                }
            }
            Shape::Polar { c, r, terms } => {
                let id = push(prims, Prim::Organic);
                let n = ((std::f64::consts::TAU * r * 1.5) / ds).ceil() as usize;
                let pt = |th: f64| add(*c, mul([th.cos(), th.sin()], polar_r(*r, terms, th)));
                for k in 0..n {
                    let th = k as f64 * std::f64::consts::TAU / n as f64;
                    let t = unit(sub(pt(th + 1e-5), pt(th - 1e-5)));
                    out.push(Sample {
                        p: pt(th),
                        t,
                        n: [t[1], -t[0]],
                        prim: id,
                    });
                }
            }
            Shape::Diff(a, b) => {
                let mut sa = Vec::new();
                a.boundary(ds, prims, &mut sa);
                out.extend(sa.into_iter().filter(|s| !b.inside(s.p)));
                let mut sb = Vec::new();
                b.boundary(ds, prims, &mut sb);
                out.extend(
                    sb.into_iter()
                        .filter(|s| a.inside(s.p))
                        .map(|s| Sample { n: mul(s.n, -1.0), ..s }),
                );
            }
        }
    }
}

fn polar_r(r: f64, terms: &[(f64, f64, f64)], th: f64) -> f64 {
    r * (1.0 + terms.iter().map(|(k, amp, ph)| amp * (k * th + ph).sin()).sum::<f64>())
}

fn push(prims: &mut Vec<Prim>, p: Prim) -> usize {
    prims.push(p);
    prims.len() - 1
}

pub fn signed_area(p: &[P]) -> f64 {
    (0..p.len()).map(|k| cross(p[k], p[(k + 1) % p.len()])).sum::<f64>() / 2.0
}

/// A painted stack of analytic shapes on a background, rasterised with box-filter antialiasing.
#[derive(Clone)]
pub struct GeoFixture {
    pub id: String,
    /// "rejected", "validation", "heldout" or "negative".
    pub set: &'static str,
    pub description: String,
    pub w: usize,
    pub h: usize,
    /// Straight RGBA background ([0,0,0,0] = transparent).
    pub background: [u8; 4],
    /// Paint order, bottom first: shape and straight RGBA colour.
    pub layers: Vec<(Shape, [u8; 4])>,
    /// Trace settings JSON (the `settings` object).
    pub settings: String,
    /// Whether the fixture's shapes are ideal geometry (false for negative controls).
    pub ideal: bool,
    pub rgba: Vec<u8>,
}

impl GeoFixture {
    /// Rasterises with `ss`×`ss` supersampling; every subsample is composited exactly.
    pub fn rasterize(&mut self, ss: usize) {
        let mut rgba = vec![0u8; self.w * self.h * 4];
        let bg = premul(self.background);
        for y in 0..self.h {
            for x in 0..self.w {
                let mut acc = [0.0f64; 4];
                for sy in 0..ss {
                    for sx in 0..ss {
                        let p = [
                            x as f64 + (sx as f64 + 0.5) / ss as f64,
                            y as f64 + (sy as f64 + 0.5) / ss as f64,
                        ];
                        let mut c = bg;
                        for (shape, col) in &self.layers {
                            if shape.inside(p) {
                                let s = premul(*col);
                                let a = s[3];
                                for k in 0..4 {
                                    c[k] = s[k] + c[k] * (1.0 - a);
                                }
                            }
                        }
                        for k in 0..4 {
                            acc[k] += c[k];
                        }
                    }
                }
                let n = (ss * ss) as f64;
                let a = acc[3] / n;
                let px = if a <= 0.0 {
                    [0, 0, 0, 0]
                } else {
                    [
                        (acc[0] / n / a * 255.0).round().clamp(0.0, 255.0) as u8,
                        (acc[1] / n / a * 255.0).round().clamp(0.0, 255.0) as u8,
                        (acc[2] / n / a * 255.0).round().clamp(0.0, 255.0) as u8,
                        (a * 255.0).round() as u8,
                    ]
                };
                rgba[(y * self.w + x) * 4..(y * self.w + x) * 4 + 4].copy_from_slice(&px);
            }
        }
        self.rgba = rgba;
    }

    /// Topmost layer index covering `p` (None = background).
    pub fn label_at(&self, p: P) -> Option<usize> {
        (0..self.layers.len()).rev().find(|&k| self.layers[k].0.inside(p))
    }

    /// Visible ground-truth boundary.
    pub fn truth(&self, ds: f64) -> Truth {
        let mut prims = Vec::new();
        let mut samples = Vec::new();
        let mut corners: Vec<P> = Vec::new();
        for (k, (shape, col)) in self.layers.iter().enumerate() {
            let mut s = Vec::new();
            shape.boundary(ds, &mut prims, &mut s);
            let vis: Vec<bool> = s
                .iter()
                .map(|q| {
                    let later = self.layers[k + 1..].iter().any(|(sh, _)| sh.inside(q.p));
                    // Visible only if the colours on both sides differ (no edge otherwise).
                    let outside = add(q.p, mul(q.n, 0.75));
                    let other = self.label_at(outside).map_or(self.background, |j| self.layers[j].1);
                    !later && other != *col && in_frame(q.p, self.w, self.h, 0.5)
                })
                .collect();
            // Visibility changes mark junction corners.
            for i in 0..s.len() {
                let j = (i + 1) % s.len();
                if vis[i] != vis[j] && norm(sub(s[i].p, s[j].p)) < 3.0 * ds {
                    corners.push(if vis[i] { s[i].p } else { s[j].p });
                }
            }
            samples.extend(s.into_iter().zip(vis).filter(|(_, v)| *v).map(|(q, _)| q));
            // Polygon vertices and round-rect tangent points that stay visible are corners.
            if let Shape::Polygon(pts) = shape {
                for v in pts {
                    if !self.layers[k + 1..].iter().any(|(sh, _)| sh.inside(*v)) && in_frame(*v, self.w, self.h, 0.5) {
                        corners.push(*v);
                    }
                }
            }
        }
        // Merge corners closer than 1 px.
        let mut merged: Vec<P> = Vec::new();
        for c in corners {
            if !merged.iter().any(|m| norm(sub(*m, c)) < 1.0) {
                merged.push(c);
            }
        }
        Truth::new(samples, prims, merged, ds)
    }
}

fn in_frame(p: P, w: usize, h: usize, margin: f64) -> bool {
    p[0] > margin && p[1] > margin && p[0] < w as f64 - margin && p[1] < h as f64 - margin
}

fn premul(c: [u8; 4]) -> [f64; 4] {
    let a = f64::from(c[3]) / 255.0;
    [
        f64::from(c[0]) / 255.0 * a,
        f64::from(c[1]) / 255.0 * a,
        f64::from(c[2]) / 255.0 * a,
        a,
    ]
}

/// Visible boundary samples with a 1-px grid for nearest-sample queries.
pub struct Truth {
    pub ds: f64,
    pub samples: Vec<Sample>,
    pub prims: Vec<Prim>,
    pub corners: Vec<P>,
    grid: std::collections::HashMap<(i64, i64), Vec<usize>>,
}

impl Truth {
    pub fn new(samples: Vec<Sample>, prims: Vec<Prim>, corners: Vec<P>, ds: f64) -> Self {
        let mut grid: std::collections::HashMap<(i64, i64), Vec<usize>> = std::collections::HashMap::new();
        for (i, s) in samples.iter().enumerate() {
            grid.entry((s.p[0].floor() as i64, s.p[1].floor() as i64))
                .or_default()
                .push(i);
        }
        Self {
            ds,
            samples,
            prims,
            corners,
            grid,
        }
    }

    /// Nearest truth sample within `max` px.
    pub fn nearest(&self, p: P, max: f64) -> Option<(usize, f64)> {
        let r = max.ceil() as i64;
        let (gx, gy) = (p[0].floor() as i64, p[1].floor() as i64);
        let mut best: Option<(usize, f64)> = None;
        for dy in -r..=r {
            for dx in -r..=r {
                if let Some(v) = self.grid.get(&(gx + dx, gy + dy)) {
                    for &i in v {
                        let d = norm(sub(self.samples[i].p, p));
                        if d <= max && best.is_none_or(|b| d < b.1) {
                            best = Some((i, d));
                        }
                    }
                }
            }
        }
        best
    }

    /// Sample count of the full, unoccluded circle of radius `r` (same rule as sampling).
    fn full_circle(&self, r: f64) -> f64 {
        ((std::f64::consts::TAU * r) / self.ds).ceil().max(16.0)
    }

    fn near_corner(&self, p: P, r: f64) -> bool {
        self.corners.iter().any(|c| norm(sub(*c, p)) < r)
    }
}

// ---------------------------------------------------------------------------------------------
// Scene sampling

#[derive(Clone, Copy, Debug)]
pub struct OutSample {
    pub p: P,
    pub d1: P,
    /// Signed curvature (1/px); 0 on lines.
    pub kappa: f64,
    pub path: usize,
}

#[derive(Clone, Copy, Debug)]
pub struct Join {
    pub path: usize,
    pub p: P,
    pub t_in: P,
    pub t_out: P,
}

/// One flattened subpath per entry: (path index, polygon).
pub struct Sampled {
    pub samples: Vec<OutSample>,
    pub joins: Vec<Join>,
    pub anchors: Vec<P>,
    pub polys: Vec<(usize, Vec<P>)>,
    pub rules: Vec<FillRule>,
}

fn cubic(p: [P; 4], u: f64) -> (P, P, P) {
    let v = 1.0 - u;
    let pt = add(
        add(mul(p[0], v * v * v), mul(p[1], 3.0 * u * v * v)),
        add(mul(p[2], 3.0 * u * u * v), mul(p[3], u * u * u)),
    );
    let d1 = add(
        add(mul(sub(p[1], p[0]), 3.0 * v * v), mul(sub(p[2], p[1]), 6.0 * u * v)),
        mul(sub(p[3], p[2]), 3.0 * u * u),
    );
    let d2 = add(
        mul(add(sub(p[2], mul(p[1], 2.0)), p[0]), 6.0 * v),
        mul(add(sub(p[3], mul(p[2], 2.0)), p[1]), 6.0 * u),
    );
    (pt, d1, d2)
}

/// Samples every path at ≈ `ds` px and records joins (segment boundaries) with tangents.
pub fn sample_scene(scene: &Scene, ds: f64) -> Sampled {
    let mut s = Sampled {
        samples: Vec::new(),
        joins: Vec::new(),
        anchors: Vec::new(),
        polys: Vec::new(),
        rules: Vec::new(),
    };
    let mut pi = 0usize;
    for g in &scene.groups {
        for path in &g.paths {
            s.rules.push(path.fill_rule);
            let c = &path.coords;
            let mut i = 0;
            let mut cur = [0.0, 0.0];
            let mut start = [0.0, 0.0];
            let mut poly: Vec<P> = Vec::new();
            // Tangents of the segments of the current subpath: (start tangent, end tangent).
            let mut tans: Vec<(P, P, P)> = Vec::new(); // (start point, t_start, t_end)
            let close_sub = |poly: &mut Vec<P>, tans: &mut Vec<(P, P, P)>, s: &mut Sampled| {
                let n = tans.len();
                for k in 0..n {
                    let (_, _, t_end) = tans[k];
                    let (p_next, t_next, _) = tans[(k + 1) % n];
                    s.joins.push(Join {
                        path: pi,
                        p: p_next,
                        t_in: t_end,
                        t_out: t_next,
                    });
                    s.anchors.push(p_next);
                }
                if poly.len() > 2 {
                    s.polys.push((pi, std::mem::take(poly)));
                }
                poly.clear();
                tans.clear();
            };
            for v in path.verbs.bytes() {
                match v {
                    b'M' => {
                        cur = [c[i], c[i + 1]];
                        start = cur;
                        poly.push(cur);
                        i += 2;
                    }
                    b'L' => {
                        let e = [c[i], c[i + 1]];
                        i += 2;
                        line_samples(cur, e, ds, pi, &mut s.samples, &mut poly);
                        let t = unit(sub(e, cur));
                        if norm(sub(e, cur)) > 1e-9 {
                            tans.push((cur, t, t));
                        }
                        cur = e;
                    }
                    b'C' => {
                        let q = [cur, [c[i], c[i + 1]], [c[i + 2], c[i + 3]], [c[i + 4], c[i + 5]]];
                        i += 6;
                        let len = norm(sub(q[1], q[0])) + norm(sub(q[2], q[1])) + norm(sub(q[3], q[2]));
                        let m = ((len / ds).ceil() as usize).clamp(4, 4096);
                        for k in 1..=m {
                            let (p, d1, d2) = cubic(q, k as f64 / m as f64);
                            let sp = norm(d1);
                            let kappa = if sp > 1e-9 { cross(d1, d2) / (sp * sp * sp) } else { 0.0 };
                            s.samples.push(OutSample { p, d1, kappa, path: pi });
                            poly.push(p);
                        }
                        let t0 = unit(if norm(sub(q[1], q[0])) > 1e-9 {
                            sub(q[1], q[0])
                        } else {
                            sub(q[2], q[0])
                        });
                        let t1 = unit(if norm(sub(q[3], q[2])) > 1e-9 {
                            sub(q[3], q[2])
                        } else {
                            sub(q[3], q[1])
                        });
                        if norm(sub(q[3], q[0])) > 1e-9 || len > 1e-9 {
                            tans.push((cur, t0, t1));
                        }
                        cur = q[3];
                    }
                    _ => {
                        if norm(sub(start, cur)) > 1e-9 {
                            line_samples(cur, start, ds, pi, &mut s.samples, &mut poly);
                            let t = unit(sub(start, cur));
                            tans.push((cur, t, t));
                        }
                        cur = start;
                        close_sub(&mut poly, &mut tans, &mut s);
                    }
                }
            }
            pi += 1;
        }
    }
    s
}

fn line_samples(a: P, b: P, ds: f64, pi: usize, out: &mut Vec<OutSample>, poly: &mut Vec<P>) {
    let len = norm(sub(b, a));
    let m = ((len / ds).ceil() as usize).max(1);
    let d1 = sub(b, a);
    for k in 1..=m {
        let p = add(a, mul(d1, k as f64 / m as f64));
        out.push(OutSample {
            p,
            d1,
            kappa: 0.0,
            path: pi,
        });
    }
    poly.push(b);
}

/// Even-odd / nonzero point-in-path over a path's flattened subpaths.
fn inside_path(polys: &[&Vec<P>], rule: FillRule, p: P) -> bool {
    let mut wind = 0i32;
    let mut cross_n = 0u32;
    for poly in polys {
        let n = poly.len();
        for i in 0..n {
            let (a, b) = (poly[i], poly[(i + 1) % n]);
            if (a[1] > p[1]) != (b[1] > p[1]) {
                let x = (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0];
                if p[0] < x {
                    cross_n += 1;
                    wind += if b[1] > a[1] { 1 } else { -1 };
                }
            }
        }
    }
    match rule {
        FillRule::Evenodd => cross_n % 2 == 1,
        FillRule::Nonzero => wind != 0,
    }
}

// ---------------------------------------------------------------------------------------------
// Metrics

#[derive(Clone, Debug, Default, Serialize)]
pub struct Stats {
    pub n: usize,
    pub mean_abs: f64,
    pub rms: f64,
    pub max_abs: f64,
    /// Mean signed deviation; positive = output outside the true shape (outward).
    pub bias: f64,
}

impl Stats {
    pub fn of(v: &[f64]) -> Self {
        if v.is_empty() {
            return Self::default();
        }
        let n = v.len() as f64;
        Self {
            n: v.len(),
            mean_abs: v.iter().map(|x| x.abs()).sum::<f64>() / n,
            rms: (v.iter().map(|x| x * x).sum::<f64>() / n).sqrt(),
            max_abs: v.iter().map(|x| x.abs()).fold(0.0, f64::max),
            bias: v.iter().sum::<f64>() / n,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct CircleReport {
    pub prim: usize,
    pub true_center: P,
    pub true_radius: f64,
    /// Fraction of the true circumference that is visible.
    pub visible_fraction: f64,
    pub center_error: f64,
    pub radius_error: f64,
    /// |p - c_true| - r_true over output samples attributed to this circle (corners excluded).
    pub radial: Stats,
    /// Max |radial deviation| per 10° sector (NaN-free: -1 where no samples).
    pub radial_by_angle: Vec<f64>,
    /// κ·r - 1 over the same samples.
    pub curvature: Stats,
}

#[derive(Clone, Debug, Serialize)]
pub struct LoopShape {
    /// Output loop matched to a fully visible circle or ellipse primitive.
    pub prim: usize,
    pub center_error: f64,
    pub major_error: f64,
    pub minor_error: f64,
    pub eccentricity_error: f64,
    pub orientation_error_deg: Option<f64>,
    pub area_error_rel: f64,
    pub bbox_error: f64,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct Report {
    /// Output visible boundary → nearest truth (signed by the truth's outward normal).
    pub contour: Stats,
    /// Truth visible boundary → nearest visible output sample.
    pub missing: Stats,
    /// Symmetric contour (Hausdorff) distance.
    pub hausdorff: f64,
    pub circles: Vec<CircleReport>,
    pub loops: Vec<LoopShape>,
    pub joins: usize,
    /// Joins on smooth truth (≥ 2 px from any true corner) whose tangents differ by > 2°.
    pub smooth_join_breaks: usize,
    pub smooth_joins: usize,
    pub max_smooth_join_angle_deg: f64,
    pub true_corners: usize,
    /// True corners with an output anchor within 1 px.
    pub corners_found: usize,
    pub corner_position: Stats,
    /// Straight truth: max |κ|·px over output samples on line primitives (0 for perfect lines).
    pub line_max_curvature: f64,
    pub line_deviation: Stats,
    /// Organic (negative-control) truth deviation.
    pub organic: Stats,
}

/// Compares a traced scene with the visible truth.
pub fn evaluate(truth: &Truth, scene: &Scene, w: usize, h: usize) -> Report {
    let s = sample_scene(scene, 0.1);
    // Visibility of each output sample: not inside any later path, not on the frame border.
    let mut by_path: Vec<Vec<&Vec<P>>> = vec![Vec::new(); s.rules.len()];
    let mut bbox: Vec<[f64; 4]> = vec![[f64::MAX, f64::MAX, f64::MIN, f64::MIN]; s.rules.len()];
    for (pi, poly) in &s.polys {
        by_path[*pi].push(poly);
        for q in poly {
            let b = &mut bbox[*pi];
            b[0] = b[0].min(q[0]);
            b[1] = b[1].min(q[1]);
            b[2] = b[2].max(q[0]);
            b[3] = b[3].max(q[1]);
        }
    }
    let visible = |p: P, path: usize| -> bool {
        if !in_frame(p, w, h, 0.5) {
            return false;
        }
        !(path + 1..s.rules.len()).any(|j| {
            let b = bbox[j];
            p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3] && inside_path(&by_path[j], s.rules[j], p)
        })
    };
    let vis: Vec<&OutSample> = s.samples.iter().filter(|o| visible(o.p, o.path)).collect();

    let mut r = Report::default();
    let mut dev = Vec::new();
    let mut per_prim: Vec<Vec<(P, f64, f64)>> = vec![Vec::new(); truth.prims.len()]; // (point, signed dev, kappa)
    for o in &vis {
        if let Some((i, d)) = truth.nearest(o.p, 4.0) {
            let t = truth.samples[i];
            let sd = dot(sub(o.p, t.p), t.n).signum() * d;
            dev.push(sd);
            if !truth.near_corner(o.p, 2.0) {
                per_prim[t.prim].push((o.p, sd, o.kappa));
            }
        } else {
            dev.push(4.0); // stray output boundary (far from any truth)
        }
    }
    r.contour = Stats::of(&dev);

    // Missing: truth samples without visible output within 4 px count as 4 px.
    let mut out_grid: std::collections::HashMap<(i64, i64), Vec<P>> = std::collections::HashMap::new();
    for o in &vis {
        out_grid
            .entry((o.p[0].floor() as i64, o.p[1].floor() as i64))
            .or_default()
            .push(o.p);
    }
    let miss: Vec<f64> = truth
        .samples
        .iter()
        .map(|t| {
            let (gx, gy) = (t.p[0].floor() as i64, t.p[1].floor() as i64);
            let mut best: f64 = 4.0;
            for dy in -4..=4 {
                for dx in -4..=4 {
                    if let Some(v) = out_grid.get(&(gx + dx, gy + dy)) {
                        for q in v {
                            best = best.min(norm(sub(*q, t.p)));
                        }
                    }
                }
            }
            best
        })
        .collect();
    r.missing = Stats::of(&miss);
    r.hausdorff = r.contour.max_abs.max(r.missing.max_abs);

    // Per-primitive reports.
    let mut line_dev = Vec::new();
    let mut organic = Vec::new();
    for (pid, prim) in truth.prims.iter().enumerate() {
        let pts = &per_prim[pid];
        match prim {
            Prim::Circle { c, r: rad } => {
                let total = truth.samples.iter().filter(|q| q.prim == pid).count();
                if pts.len() < 8 {
                    continue;
                }
                let radial: Vec<f64> = pts.iter().map(|(p, _, _)| norm(sub(*p, *c)) - rad).collect();
                let curv: Vec<f64> = pts.iter().map(|(_, _, k)| k.abs() * rad - 1.0).collect();
                let mut bins = vec![-1.0f64; 36];
                for ((p, _, _), d) in pts.iter().zip(&radial) {
                    let a = (p[1] - c[1]).atan2(p[0] - c[0]).to_degrees().rem_euclid(360.0);
                    let b = ((a / 10.0) as usize).min(35);
                    bins[b] = bins[b].max(d.abs());
                }
                let fit = fit_circle(&pts.iter().map(|q| q.0).collect::<Vec<_>>());
                let (ce, re) = fit.map_or((f64::NAN, f64::NAN), |(fc, fr)| (norm(sub(fc, *c)), fr - rad));
                r.circles.push(CircleReport {
                    prim: pid,
                    true_center: *c,
                    true_radius: *rad,
                    visible_fraction: (total as f64 / truth.full_circle(*rad)).min(1.0),
                    center_error: ce,
                    radius_error: re,
                    radial: Stats::of(&radial),
                    radial_by_angle: bins,
                    curvature: Stats::of(&curv),
                });
            }
            Prim::Line => {
                line_dev.extend(pts.iter().map(|q| q.1));
                for q in pts {
                    r.line_max_curvature = r.line_max_curvature.max(q.2.abs());
                }
            }
            Prim::Organic => organic.extend(pts.iter().map(|q| q.1)),
            Prim::Ellipse { .. } => {}
        }
    }
    r.line_deviation = Stats::of(&line_dev);
    r.organic = Stats::of(&organic);

    // Closed loops matched to fully visible circles/ellipses: moment-based shape parameters.
    for (_, poly) in &s.polys {
        let m = moments(poly);
        if m.area.abs() < 4.0 {
            continue;
        }
        for (pid, prim) in truth.prims.iter().enumerate() {
            let (c, a, b, rot) = match prim {
                Prim::Circle { c, r } => (*c, *r, *r, None),
                Prim::Ellipse { c, a, b, rot } => (*c, a.max(*b), a.min(*b), Some(*rot)),
                _ => continue,
            };
            let full = truth.samples.iter().filter(|q| q.prim == pid).count() as f64;
            let expect = match prim {
                Prim::Circle { r, .. } => truth.full_circle(*r),
                _ => full,
            };
            if full < 0.98 * expect || norm(sub(m.c, c)) > 2.0 || (m.major - a).abs() > 3.0 {
                continue;
            }
            let ecc = |a: f64, b: f64| (1.0 - (b / a).powi(2)).max(0.0).sqrt();
            let bb = poly_bbox(poly);
            let tb = match prim {
                Prim::Circle { c, r } => [c[0] - r, c[1] - r, c[0] + r, c[1] + r],
                Prim::Ellipse { c, a, b, rot } => {
                    let (s, co) = rot.sin_cos();
                    let ex = ((a * co).powi(2) + (b * s).powi(2)).sqrt();
                    let ey = ((a * s).powi(2) + (b * co).powi(2)).sqrt();
                    [c[0] - ex, c[1] - ey, c[0] + ex, c[1] + ey]
                }
                _ => unreachable!(),
            };
            r.loops.push(LoopShape {
                prim: pid,
                center_error: norm(sub(m.c, c)),
                major_error: m.major - a,
                minor_error: m.minor - b,
                eccentricity_error: ecc(m.major, m.minor) - ecc(a, b),
                orientation_error_deg: rot.filter(|_| a / b > 1.05).map(|t| {
                    let d = (m.angle - t).rem_euclid(std::f64::consts::PI);
                    d.min(std::f64::consts::PI - d).to_degrees()
                }),
                area_error_rel: m.area.abs() / (std::f64::consts::PI * a * b) - 1.0,
                bbox_error: (0..4).map(|k| (bb[k] - tb[k]).abs()).fold(0.0, f64::max),
            });
        }
    }

    // Joins and corners.
    r.joins = s.joins.len();
    for j in &s.joins {
        if !visible(j.p, j.path) || truth.nearest(j.p, 1.5).is_none() || truth.near_corner(j.p, 2.0) {
            continue;
        }
        r.smooth_joins += 1;
        let ang = cross(j.t_in, j.t_out).atan2(dot(j.t_in, j.t_out)).abs().to_degrees();
        r.max_smooth_join_angle_deg = r.max_smooth_join_angle_deg.max(ang);
        if ang > 2.0 {
            r.smooth_join_breaks += 1;
        }
    }
    r.true_corners = truth.corners.len();
    let mut cpos = Vec::new();
    for c in &truth.corners {
        let d = s.anchors.iter().map(|a| norm(sub(*a, *c))).fold(f64::MAX, f64::min);
        if d <= 1.0 {
            r.corners_found += 1;
        }
        cpos.push(d.min(4.0));
    }
    r.corner_position = Stats::of(&cpos);
    r
}

struct Moments {
    area: f64,
    c: P,
    major: f64,
    minor: f64,
    angle: f64,
}

/// Area moments of a simple polygon → equivalent ellipse (exact for ellipses).
fn moments(p: &[P]) -> Moments {
    let n = p.len();
    let (mut a, mut cx, mut cy) = (0.0, 0.0, 0.0);
    let (mut sxx, mut syy, mut sxy) = (0.0, 0.0, 0.0);
    for i in 0..n {
        let (q0, q1) = (p[i], p[(i + 1) % n]);
        let cr = cross(q0, q1);
        a += cr;
        cx += (q0[0] + q1[0]) * cr;
        cy += (q0[1] + q1[1]) * cr;
        sxx += (q0[0] * q0[0] + q0[0] * q1[0] + q1[0] * q1[0]) * cr;
        syy += (q0[1] * q0[1] + q0[1] * q1[1] + q1[1] * q1[1]) * cr;
        sxy += (q0[0] * q1[1] + 2.0 * q0[0] * q0[1] + 2.0 * q1[0] * q1[1] + q1[0] * q0[1]) * cr;
    }
    a /= 2.0;
    if a.abs() < 1e-12 {
        return Moments {
            area: 0.0,
            c: [0.0, 0.0],
            major: 0.0,
            minor: 0.0,
            angle: 0.0,
        };
    }
    cx /= 6.0 * a;
    cy /= 6.0 * a;
    let mxx = sxx / 12.0 / a - cx * cx;
    let myy = syy / 12.0 / a - cy * cy;
    let mxy = sxy / 24.0 / a - cx * cy;
    let tr = mxx + myy;
    let disc = ((mxx - myy).powi(2) / 4.0 + mxy * mxy).sqrt();
    let (l1, l2) = (tr / 2.0 + disc, tr / 2.0 - disc);
    Moments {
        area: a,
        c: [cx, cy],
        major: 2.0 * l1.max(0.0).sqrt(),
        minor: 2.0 * l2.max(0.0).sqrt(),
        angle: 0.5 * (2.0 * mxy).atan2(mxx - myy),
    }
}

fn poly_bbox(p: &[P]) -> [f64; 4] {
    let mut b = [f64::MAX, f64::MAX, f64::MIN, f64::MIN];
    for q in p {
        b[0] = b[0].min(q[0]);
        b[1] = b[1].min(q[1]);
        b[2] = b[2].max(q[0]);
        b[3] = b[3].max(q[1]);
    }
    b
}

/// Least-squares circle (Kåsa, then Gauss–Newton on geometric distance).
pub fn fit_circle(pts: &[P]) -> Option<(P, f64)> {
    if pts.len() < 3 {
        return None;
    }
    let n = pts.len() as f64;
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
    if det.abs() < 1e-12 {
        return None;
    }
    let (bu, bv) = (0.5 * (suuu + suvv), 0.5 * (svvv + svuu));
    let (uc, vc) = ((bu * svv - bv * suv) / det, (suu * bv - suv * bu) / det);
    let (mut c, mut r) = ([uc + mx, vc + my], (uc * uc + vc * vc + (suu + svv) / n).sqrt());
    for _ in 0..30 {
        let (mut a, mut g) = ([[0.0f64; 3]; 3], [0.0f64; 3]);
        for p in pts {
            let d = sub(*p, c);
            let l = norm(d);
            if l < 1e-12 {
                return None;
            }
            let j = [-d[0] / l, -d[1] / l, -1.0];
            let res = l - r;
            for x in 0..3 {
                g[x] -= j[x] * res;
                for y in 0..3 {
                    a[x][y] += j[x] * j[y];
                }
            }
        }
        let det3 = |m: [[f64; 3]; 3]| {
            m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
                + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
        };
        let d = det3(a);
        if d.abs() < 1e-14 {
            break;
        }
        let mut step = [0.0; 3];
        for (k, sk) in step.iter_mut().enumerate() {
            let mut m = a;
            for row in 0..3 {
                m[row][k] = g[row];
            }
            *sk = det3(m) / d;
        }
        c = [c[0] + step[0], c[1] + step[1]];
        r += step[2];
        if step.iter().map(|v| v.abs()).fold(0.0, f64::max) < 1e-12 {
            break;
        }
    }
    Some((c, r))
}

// ---------------------------------------------------------------------------------------------
// Raster comparison: per-label IoU and topology at `scale`× (resvg renders the SVG).

#[derive(Clone, Debug, Default, Serialize)]
pub struct Topology {
    /// Connected components per visible colour label (truth, output), at 4× sampling.
    pub components: Vec<(String, usize, usize)>,
    /// Holes (enclosed non-label regions) per label (truth, output).
    pub holes: Vec<(String, usize, usize)>,
    pub iou: f64,
    pub preserved: bool,
}

/// Classifies each supersample of the rendered output to the nearest fixture colour and
/// compares with the analytic topmost label. Components smaller than 1 source px² are ignored.
pub fn topology(f: &GeoFixture, svg: &str, scale: usize) -> Topology {
    let (w, h) = (f.w * scale, f.h * scale);
    let tree = resvg::usvg::Tree::from_str(svg, &resvg::usvg::Options::default()).unwrap();
    let mut pm = resvg::tiny_skia::Pixmap::new(w as u32, h as u32).unwrap();
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(scale as f32, scale as f32),
        &mut pm.as_mut(),
    );
    let mut palette: Vec<[u8; 4]> = vec![f.background];
    for (_, c) in &f.layers {
        if !palette.contains(c) {
            palette.push(*c);
        }
    }
    let label_of_color = |c: [u8; 4]| -> usize {
        palette
            .iter()
            .enumerate()
            .min_by_key(|(_, p)| {
                let pa = f64::from(p[3]) / 255.0;
                let ca = f64::from(c[3]) / 255.0;
                (0..3)
                    .map(|k| {
                        let d = f64::from(p[k]) * pa - f64::from(c[k]) * ca;
                        (d * d) as i64
                    })
                    .sum::<i64>()
                    + ((pa - ca) * 255.0).powi(2) as i64
            })
            .map(|(i, _)| i)
            .unwrap()
    };
    let mut out = vec![0usize; w * h];
    let mut tru = vec![0usize; w * h];
    for y in 0..h {
        for x in 0..w {
            let p = pm.pixel(x as u32, y as u32).unwrap();
            let a = p.alpha();
            let c = if a == 0 {
                [0, 0, 0, 0]
            } else {
                let un = |v: u8| ((f64::from(v) * 255.0 / f64::from(a)).round().min(255.0)) as u8;
                [un(p.red()), un(p.green()), un(p.blue()), a]
            };
            out[y * w + x] = label_of_color(c);
            let q = [(x as f64 + 0.5) / scale as f64, (y as f64 + 0.5) / scale as f64];
            let col = f.label_at(q).map_or(f.background, |k| f.layers[k].1);
            tru[y * w + x] = palette.iter().position(|c| *c == col).unwrap();
        }
    }
    let (mut inter, mut uni) = (0usize, 0usize);
    for i in 0..w * h {
        if tru[i] != 0 || out[i] != 0 {
            uni += 1;
            if tru[i] == out[i] {
                inter += 1;
            }
        }
    }
    let min = scale * scale;
    let mut t = Topology {
        iou: inter as f64 / uni.max(1) as f64,
        ..Default::default()
    };
    let mut ok = true;
    for (li, c) in palette.iter().enumerate().skip(1) {
        let name = format!("#{:02x}{:02x}{:02x}{:02x}", c[0], c[1], c[2], c[3]);
        let (tc, th) = count(&tru, w, h, li, min);
        let (oc, oh) = count(&out, w, h, li, min);
        ok &= tc == oc && th == oh;
        t.components.push((name.clone(), tc, oc));
        t.holes.push((name, th, oh));
    }
    t.preserved = ok;
    t
}

/// (components of `label`, enclosed holes in it), both 4-connected, ignoring regions < `min`.
fn count(lab: &[usize], w: usize, h: usize, label: usize, min: usize) -> (usize, usize) {
    let comps = flood(lab, w, h, |v| v == label, min, false);
    let holes = flood(lab, w, h, |v| v != label, min, true);
    (comps, holes)
}

fn flood(lab: &[usize], w: usize, h: usize, pred: impl Fn(usize) -> bool, min: usize, enclosed_only: bool) -> usize {
    let mut seen = vec![false; w * h];
    let mut n = 0;
    let mut stack = Vec::new();
    for s in 0..w * h {
        if seen[s] || !pred(lab[s]) {
            continue;
        }
        let (mut size, mut border) = (0usize, false);
        seen[s] = true;
        stack.push(s);
        while let Some(i) = stack.pop() {
            size += 1;
            let (x, y) = (i % w, i / w);
            if x == 0 || y == 0 || x == w - 1 || y == h - 1 {
                border = true;
            }
            let nb = [
                (x > 0).then(|| i - 1),
                (x + 1 < w).then(|| i + 1),
                (y > 0).then(|| i - w),
                (y + 1 < h).then(|| i + w),
            ];
            for j in nb.into_iter().flatten() {
                if !seen[j] && pred(lab[j]) {
                    seen[j] = true;
                    stack.push(j);
                }
            }
        }
        if size >= min && !(enclosed_only && border) {
            n += 1;
        }
    }
    n
}
