//! RFC-002 review gate R04 spike: TD-GEO-001 / TD-GEO-009 shared colour boundaries.
//!
//! Factorial on the P0 disc/overlap fixtures, everything else held at the frozen precision
//! configuration (`Options::production(60)`, engine segmentation, engine sub-pixel crossings):
//! - labels: engine segmentation | oracle (analytic truth at pixel centres);
//! - crossings: engine `Field` estimate | analytic (exact edge between the two pixel centres);
//! - assembly: A = independent per-layer fits (P0 stacked) | B = trace-local shared boundary
//!   graph (crack edges between faces, junction vertices, every edge fitted once, faces and
//!   stacked unions assembled from forward/reversed edges).
//!
//! Prototype only: no production topology engine, no new tracer. Open-chain fitting reuses the
//! engine's public closed-loop `fit_contour` through a WORKAROUND (chain closed by a chord with
//! the junction ends pinned; the chord is dropped after fitting, asserted exact).
//!
//! Usage: cargo run --release -- <out-dir>
#[path = "../../../../crates/vector-engine/tests/common/corpus.rs"]
mod corpus;
#[path = "../../../../crates/vector-engine/tests/common/fixtures.rs"]
mod fixtures;
#[path = "../../../../crates/vector-engine/tests/common/geometry.rs"]
mod geometry;
#[path = "../../../../crates/vector-engine/tests/common/render.rs"]
mod render;

use std::alloc::{GlobalAlloc, Layout, System};
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering::Relaxed};
use std::time::Instant;

use geometry::GeoFixture;
use resvg::tiny_skia as sk;
use serde_json::{Value, json};
use vector_engine::color::{Luma, Rgba};
use vector_engine::image::RgbaImage;
use vector_engine::params::TraceRequest;
use vector_engine::pdf::{PdfOptions, Unit, to_pdf};
use vector_engine::precision::{self, Contour, EdgePolicy, Field, Mask, Options, Seg};
use vector_engine::scene::{Fill, FillRule, PathBuilder, Scene};

type P = [f64; 2];
const NONE: u32 = u32::MAX;
const OUT: u32 = u32::MAX - 1;
/// Crossings closer than this to a lattice junction vertex are not used by B (three-colour blend
/// pixels); the junction point replaces them.
const TRIM: f64 = 1.5;

struct Counting;
static CUR: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        PEAK.fetch_max(CUR.fetch_add(l.size(), Relaxed) + l.size(), Relaxed);
        unsafe { System.alloc(l) }
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        CUR.fetch_sub(l.size(), Relaxed);
        unsafe { System.dealloc(p, l) }
    }
}
#[global_allocator]
static ALLOC: Counting = Counting;

fn dist(a: P, b: P) -> f64 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}
fn lerp(a: P, b: P, t: f64) -> P {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}
fn q(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}
fn end(s: &Seg) -> P {
    match *s {
        Seg::Line(e) => e,
        Seg::Cubic(c) => [c[4], c[5]],
    }
}
fn reversed(start: P, segs: &[Seg]) -> (P, Vec<Seg>) {
    let mut pts = vec![start];
    pts.extend(segs.iter().map(end));
    let out = (0..segs.len())
        .rev()
        .map(|k| match segs[k] {
            Seg::Line(_) => Seg::Line(pts[k]),
            Seg::Cubic(c) => Seg::Cubic([c[2], c[3], c[0], c[1], pts[k][0], pts[k][1]]),
        })
        .collect();
    (*pts.last().unwrap(), out)
}
fn push(b: &mut PathBuilder, s: &Seg) {
    match *s {
        Seg::Line(e) => b.line_to(q(e[0]), q(e[1])),
        Seg::Cubic(c) => b.cubic_to(c.map(q)),
    }
}

// ---------------------------------------------------------------------------------------------
// Labels

fn tl(f: &GeoFixture, p: P) -> usize {
    f.label_at(p).map_or(0, |k| k + 1)
}
fn centre(i: usize, w: usize) -> P {
    [(i % w) as f64 + 0.5, (i / w) as f64 + 0.5]
}
fn visible(layers: &[Mask], w: usize, h: usize) -> Vec<u32> {
    let mut v = vec![NONE; w * h];
    for (k, m) in layers.iter().enumerate() {
        for y in 0..m.h {
            for x in 0..m.w {
                if m.bits[y * m.w + x] {
                    v[(m.y0 + y) * w + m.x0 + x] = k as u32;
                }
            }
        }
    }
    v
}
fn in_mask(m: &Mask, x: usize, y: usize) -> bool {
    m.at(x as i64 - m.x0 as i64, y as i64 - m.y0 as i64)
}

/// Truth label → engine layer by majority over pixels lying wholly inside one truth region.
fn truth_map(f: &GeoFixture, vis: &[u32]) -> Vec<u32> {
    let mut votes: Vec<HashMap<u32, usize>> = vec![HashMap::new(); f.layers.len() + 1];
    for y in 0..f.h {
        for x in 0..f.w {
            let t = tl(f, [x as f64 + 0.5, y as f64 + 0.5]);
            let pure = [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [1.0, 1.0]]
                .iter()
                .all(|d| tl(f, [x as f64 + d[0], y as f64 + d[1]]) == t);
            if pure {
                *votes[t].entry(vis[y * f.w + x]).or_default() += 1;
            }
        }
    }
    let map: Vec<u32> = votes
        .iter()
        .map(|v| {
            v.iter()
                .max_by_key(|e| (*e.1, std::cmp::Reverse(*e.0)))
                .map_or(NONE, |e| *e.0)
        })
        .collect();
    let mut s = map.clone();
    s.sort();
    s.dedup();
    assert_eq!(s.len(), map.len(), "{}: truth→layer map not injective {map:?}", f.id);
    map
}

/// `s[l][k]`: layer k nests in layer l (≥ 90 % of k's visible pixels lie in l's mask).
fn nesting(layers: &[Mask], vis: &[u32], w: usize) -> Vec<Vec<bool>> {
    let n = layers.len();
    let mut count = vec![0usize; n];
    let mut inside = vec![vec![0usize; n]; n];
    for (i, &k) in vis.iter().enumerate() {
        if k == NONE {
            continue;
        }
        count[k as usize] += 1;
        for (l, m) in layers.iter().enumerate() {
            if in_mask(m, i % w, i / w) {
                inside[l][k as usize] += 1;
            }
        }
    }
    (0..n)
        .map(|l| {
            (0..n)
                .map(|k| k >= l && inside[l][k] as f64 >= 0.9 * count[k] as f64)
                .collect()
        })
        .collect()
}

/// Unordered pixel pair of the crack a refined (non-pinned) contour point lies on.
fn crack_of(p: P, w: usize) -> (usize, usize) {
    let (fx, fy) = (p[0] - p[0].floor(), p[1] - p[1].floor());
    if (fy - 0.5).abs() < 1e-6 && (fx - 0.5).abs() > 1e-6 {
        let (x, row) = (p[0].round() as usize, p[1].floor() as usize);
        (row * w + x - 1, row * w + x)
    } else {
        let (col, y) = (p[0].floor() as usize, p[1].round() as usize);
        ((y - 1) * w + col, y * w + col)
    }
}

/// Exact edge position between two pixel centres with different oracle labels (bisection on
/// the analytic shapes), clamped like the engine's crossings.
fn analytic_point(f: &GeoFixture, map: &[u32], i: usize, o: usize) -> Option<P> {
    let (ci, co) = (centre(i, f.w), centre(o, f.w));
    let li = map[tl(f, ci)];
    if li == map[tl(f, co)] {
        return None;
    }
    let (mut a, mut b) = (0.0, 1.0);
    for _ in 0..40 {
        let m = 0.5 * (a + b);
        if map[tl(f, lerp(ci, co, m))] == li {
            a = m
        } else {
            b = m
        }
    }
    Some(lerp(ci, co, (0.5 * (a + b)).clamp(0.02, 0.98)))
}

// ---------------------------------------------------------------------------------------------
// Option A: independent per-layer fits (replica of trace.rs `precision_compose`)

fn independent(
    field: &Field,
    masks: &[Mask],
    cols: &[Rgba],
    ana: Option<(&GeoFixture, &[u32])>,
) -> Vec<(Rgba, PathBuilder)> {
    let o = Options::production(60);
    let mut out = Vec::new();
    for (m, c) in masks.iter().zip(cols) {
        let mut b = PathBuilder::default();
        for mut ct in precision::contours(field, m) {
            if let Some((f, map)) = ana {
                for k in 0..ct.points.len() {
                    if ct.pinned[k] {
                        continue;
                    }
                    let (i, o2) = crack_of(ct.points[k], f.w);
                    if let Some(p) = analytic_point(f, map, i, o2) {
                        // Keep the point on the same crack; orientation-independent.
                        ct.points[k] = p;
                        ct.saturated[k] = false;
                    }
                }
            }
            if let Some(l) = precision::fit_contour(&ct, &o) {
                b.move_to(q(l.start[0]), q(l.start[1]));
                l.segs.iter().for_each(|s| push(&mut b, s));
                b.close();
            }
        }
        if !b.is_empty() {
            out.push((*c, b));
        }
    }
    out
}

// ---------------------------------------------------------------------------------------------
// Option B: trace-local shared boundary graph

type Crack = (i64, i64, usize); // start vertex, direction (0 E, 1 S, 2 W, 3 N), inside on the right
const DX: [i64; 4] = [1, 0, -1, 0];
const DY: [i64; 4] = [0, 1, 0, -1];

fn crack_pixels((vx, vy, d): Crack) -> ((i64, i64), (i64, i64)) {
    match d {
        0 => ((vx, vy), (vx, vy - 1)),
        1 => ((vx - 1, vy), (vx, vy)),
        2 => ((vx - 1, vy - 1), (vx - 1, vy)),
        _ => ((vx, vy - 1), (vx - 1, vy - 1)),
    }
}

struct Chain {
    cracks: Vec<Crack>,
    closed: bool,
    start: P,
    segs: Vec<Seg>,
    /// Sections the engine fitter replaced by a recognised circular arc.
    recognised: usize,
}

struct Graph {
    w: usize,
    h: usize,
    face: Vec<u32>,
    face_label: Vec<u32>,
    /// Unordered pixel pair → (crossing, saturated).
    cross: HashMap<(usize, usize), (P, bool)>,
    /// Largest disagreement between the two sides' crossing of one crack.
    cross_asym: f64,
    chains: Vec<Chain>,
    /// Directed crack (from vertex, to vertex) → (chain, index).
    dir: HashMap<(usize, usize), (usize, usize)>,
    junctions: HashMap<usize, P>,
}

#[derive(Clone, Copy, PartialEq)]
enum Junctions {
    Estimated,
    Analytic,
}

impl Graph {
    fn fid(&self, x: i64, y: i64) -> u32 {
        if x < 0 || y < 0 || x >= self.w as i64 || y >= self.h as i64 {
            OUT
        } else {
            self.face[y as usize * self.w + x as usize]
        }
    }
    fn vid(&self, x: i64, y: i64) -> usize {
        y as usize * (self.w + 1) + x as usize
    }
    fn vpos(&self, v: usize) -> P {
        [(v % (self.w + 1)) as f64, (v / (self.w + 1)) as f64]
    }
    fn degree(&self, x: i64, y: i64) -> usize {
        let (a, b, c, d) = (
            self.fid(x - 1, y - 1),
            self.fid(x, y - 1),
            self.fid(x - 1, y),
            self.fid(x, y),
        );
        [a != b, b != d, c != d, a != c].iter().filter(|e| **e).count()
    }
    fn ends(&self, c: Crack) -> (usize, usize) {
        (self.vid(c.0, c.1), self.vid(c.0 + DX[c.2], c.1 + DY[c.2]))
    }

    /// Boundary loops of a set of faces (inside 4-connected, right turn first, as the engine).
    fn walk(&self, inside: &dyn Fn(u32) -> bool) -> Vec<Vec<Crack>> {
        let (w, h, vw) = (self.w as i64, self.h as i64, self.w + 1);
        let ins = |x: i64, y: i64| inside(self.fid(x, y));
        let mut out = vec![0u8; vw * (self.h + 1)];
        let v = |x: i64, y: i64| y as usize * vw + x as usize;
        for y in 0..h {
            for x in 0..w {
                if !ins(x, y) {
                    continue;
                }
                if !ins(x, y - 1) {
                    out[v(x, y)] |= 1;
                }
                if !ins(x + 1, y) {
                    out[v(x + 1, y)] |= 2;
                }
                if !ins(x, y + 1) {
                    out[v(x + 1, y + 1)] |= 4;
                }
                if !ins(x - 1, y) {
                    out[v(x, y + 1)] |= 8;
                }
            }
        }
        let mut loops = Vec::new();
        for sv in 0..out.len() {
            while out[sv] != 0 {
                let sd = out[sv].trailing_zeros() as usize;
                let (mut x, mut y, mut d) = ((sv % vw) as i64, (sv / vw) as i64, sd);
                let mut lp = Vec::new();
                loop {
                    out[v(x, y)] &= !(1 << d);
                    lp.push((x, y, d));
                    x += DX[d];
                    y += DY[d];
                    let vi = v(x, y);
                    let next = [(d + 1) % 4, d, (d + 3) % 4]
                        .into_iter()
                        .take_while(|&c| !(vi == sv && c == sd))
                        .find(|&c| out[vi] & (1 << c) != 0);
                    match next {
                        Some(c) => d = c,
                        None => break,
                    }
                }
                loops.push(lp);
            }
        }
        loops
    }

    /// A loop split at junction vertices (one piece if it has none).
    fn pieces(&self, lp: &[Crack]) -> Vec<Vec<Crack>> {
        let n = lp.len();
        let starts: Vec<usize> = (0..n).filter(|&k| self.degree(lp[k].0, lp[k].1) >= 3).collect();
        if starts.is_empty() {
            return vec![lp.to_vec()];
        }
        (0..starts.len())
            .map(|i| {
                let (s, e) = (starts[i], starts[(i + 1) % starts.len()]);
                let len = if e > s { e - s } else { e + n - s };
                (0..len).map(|k| lp[(s + k) % n]).collect()
            })
            .collect()
    }

    /// (chain, reversed) of a piece.
    fn lookup(&self, pc: &[Crack]) -> Option<(usize, bool)> {
        let (a, b) = self.ends(pc[0]);
        if let Some(&(c, i)) = self.dir.get(&(a, b)) {
            assert!(self.chains[c].closed || i == 0, "piece starts mid-chain");
            return Some((c, false));
        }
        let (c, i) = *self.dir.get(&(b, a))?;
        assert!(
            self.chains[c].closed || i + 1 == self.chains[c].cracks.len(),
            "reversed piece mid-chain"
        );
        Some((c, true))
    }

    fn build(labels: &[u32], w: usize, h: usize, field: &Field) -> Self {
        // Faces: 4-connected components of the label map.
        let mut face = vec![NONE; w * h];
        let mut face_label = Vec::new();
        let mut bbox: Vec<[usize; 4]> = Vec::new();
        for s in 0..w * h {
            if face[s] != NONE {
                continue;
            }
            let id = face_label.len() as u32;
            face_label.push(labels[s]);
            let mut bb = [usize::MAX, usize::MAX, 0, 0];
            face[s] = id;
            let mut stack = vec![s];
            while let Some(i) = stack.pop() {
                let (x, y) = (i % w, i / w);
                bb = [bb[0].min(x), bb[1].min(y), bb[2].max(x), bb[3].max(y)];
                let nb = [
                    (x > 0).then(|| i - 1),
                    (x + 1 < w).then(|| i + 1),
                    (y > 0).then(|| i - w),
                    (y + 1 < h).then(|| i + w),
                ];
                for j in nb.into_iter().flatten() {
                    if face[j] == NONE && labels[j] == labels[i] {
                        face[j] = id;
                        stack.push(j);
                    }
                }
            }
            bbox.push(bb);
        }
        let mut g = Graph {
            w,
            h,
            face,
            face_label,
            cross: HashMap::new(),
            cross_asym: 0.0,
            chains: Vec::new(),
            dir: HashMap::new(),
            junctions: HashMap::new(),
        };
        // Crossings from the engine's own refined contours of every face (same Field as
        // production), keyed by crack; both sides must agree.
        for (fi, bb) in bbox.iter().enumerate() {
            let (mw, mh) = (bb[2] - bb[0] + 1, bb[3] - bb[1] + 1);
            let mut bits = vec![false; mw * mh];
            for y in 0..mh {
                for x in 0..mw {
                    bits[y * mw + x] = g.face[(bb[1] + y) * w + bb[0] + x] == fi as u32;
                }
            }
            let m = Mask {
                x0: bb[0],
                y0: bb[1],
                w: mw,
                h: mh,
                bits,
            };
            for c in precision::contours(field, &m) {
                for k in 0..c.points.len() {
                    if c.pinned[k] {
                        continue;
                    }
                    let (a, b) = crack_of(c.points[k], w);
                    match g.cross.get(&(a, b)) {
                        Some(&(p, _)) => g.cross_asym = g.cross_asym.max(dist(p, c.points[k])),
                        None => {
                            g.cross.insert((a, b), (c.points[k], c.saturated[k]));
                        }
                    }
                }
            }
        }
        // Chains: every face's loops split at junctions; each crack sequence registered once.
        for fi in 0..g.face_label.len() as u32 {
            for lp in g.walk(&|x| x == fi) {
                for pc in g.pieces(&lp) {
                    if g.lookup(&pc).is_some() {
                        continue;
                    }
                    let closed = g.degree(pc[0].0, pc[0].1) < 3;
                    let id = g.chains.len();
                    for (i, c) in pc.iter().enumerate() {
                        let e = g.ends(*c);
                        g.dir.insert(e, (id, i));
                    }
                    g.chains.push(Chain {
                        cracks: pc,
                        closed,
                        start: [0.0; 2],
                        segs: Vec::new(),
                        recognised: 0,
                    });
                }
            }
        }
        g
    }

    /// Interior crossings of a chain, in chain order.
    fn points(&self, c: &Chain) -> Vec<(P, bool)> {
        c.cracks
            .iter()
            .filter_map(|&k| {
                let ((ix, iy), (ox, oy)) = crack_pixels(k);
                if self.fid(ox, oy) == OUT || self.fid(ix, iy) == OUT {
                    return None;
                }
                let (i, o) = (iy as usize * self.w + ix as usize, oy as usize * self.w + ox as usize);
                Some(self.cross[&(i.min(o), i.max(o))])
            })
            .collect()
    }

    fn place_junctions(&mut self, mode: Junctions, truth_junctions: &[P]) {
        let mut ends: HashMap<usize, Vec<Vec<P>>> = HashMap::new();
        for c in &self.chains {
            if c.closed {
                continue;
            }
            let pts: Vec<P> = self.points(c).into_iter().map(|x| x.0).collect();
            let (va, vb) = (self.ends(c.cracks[0]).0, self.ends(*c.cracks.last().unwrap()).1);
            ends.entry(va).or_default().push(pts.clone());
            ends.entry(vb).or_default().push(pts.into_iter().rev().collect());
        }
        for (v, lists) in ends {
            let vp = self.vpos(v);
            let analytic = truth_junctions
                .iter()
                .filter(|t| dist(**t, vp) < 2.5)
                .min_by(|a, b| dist(**a, vp).total_cmp(&dist(**b, vp)));
            if let (Junctions::Analytic, Some(t)) = (mode, analytic) {
                self.junctions.insert(v, *t);
                continue;
            }
            // End tangent line of every incident chain (points 1.5–4 px from the vertex), then
            // the least-squares point closest to all lines.
            let (mut a, mut bx, mut firsts) = ([0.0f64; 3], [0.0f64; 2], Vec::new());
            for pts in &lists {
                let kept: Vec<P> = pts.iter().copied().filter(|p| dist(*p, vp) > TRIM).collect();
                let win: Vec<P> = kept.iter().copied().take_while(|p| dist(*p, vp) <= 4.0).collect();
                let win = if win.len() >= 2 {
                    win
                } else {
                    kept.iter().copied().take(2).collect()
                };
                if win.len() < 2 {
                    continue;
                }
                let (p0, p1) = (win[0], *win.last().unwrap());
                let l = dist(p0, p1);
                let n = [-(p1[1] - p0[1]) / l, (p1[0] - p0[0]) / l];
                a[0] += n[0] * n[0];
                a[1] += n[0] * n[1];
                a[2] += n[1] * n[1];
                let d = n[0] * p0[0] + n[1] * p0[1];
                bx[0] += n[0] * d;
                bx[1] += n[1] * d;
                firsts.push(p0);
            }
            let det = a[0] * a[2] - a[1] * a[1];
            let mean = if firsts.is_empty() {
                vp
            } else {
                let s = firsts.iter().fold([0.0, 0.0], |s, p| [s[0] + p[0], s[1] + p[1]]);
                [s[0] / firsts.len() as f64, s[1] / firsts.len() as f64]
            };
            let ls = [(bx[0] * a[2] - bx[1] * a[1]) / det, (a[0] * bx[1] - a[1] * bx[0]) / det];
            let p = if det.abs() > 1e-3 && dist(ls, vp) < 2.0 {
                ls
            } else {
                mean
            };
            self.junctions.insert(v, p);
        }
    }

    /// Fits every edge once.
    fn fit(&mut self) {
        let o = Options::production(60);
        for ci in 0..self.chains.len() {
            let c = &self.chains[ci];
            let border = {
                let ((ix, iy), (ox, oy)) = crack_pixels(c.cracks[0]);
                self.fid(ix, iy) == OUT || self.fid(ox, oy) == OUT
            };
            let (start, segs, rec) = if border {
                // Image border: lattice polyline (the engine pins border runs the same way).
                let mut v: Vec<P> = c.cracks.iter().map(|&k| self.vpos(self.ends(k).0)).collect();
                v.push(self.vpos(self.ends(*c.cracks.last().unwrap()).1));
                let mut segs: Vec<Seg> = Vec::new();
                for k in 1..v.len() {
                    let turn = k + 1 == v.len() || {
                        let (a, b) = (
                            [v[k][0] - v[k - 1][0], v[k][1] - v[k - 1][1]],
                            [v[k + 1][0] - v[k][0], v[k + 1][1] - v[k][1]],
                        );
                        a[0] * b[1] - a[1] * b[0] != 0.0
                    };
                    if turn {
                        segs.push(Seg::Line(v[k]));
                    }
                }
                (v[0], segs, 0)
            } else if c.closed {
                let pts = self.points(c);
                let n = pts.len();
                let ct = Contour {
                    points: pts.iter().map(|x| x.0).collect(),
                    pinned: vec![false; n],
                    hidden: vec![false; n],
                    saturated: pts.iter().map(|x| x.1).collect(),
                };
                let l = precision::fit_contour(&ct, &o).expect("closed chain fits");
                (l.start, l.segs, l.recognised)
            } else {
                let (va, vb) = (self.ends(c.cracks[0]).0, self.ends(*c.cracks.last().unwrap()).1);
                let (ja, jb) = (self.junctions[&va], self.junctions[&vb]);
                let (pa, pb) = (self.vpos(va), self.vpos(vb));
                let kept: Vec<(P, bool)> = self
                    .points(c)
                    .into_iter()
                    .filter(|(p, _)| dist(*p, pa) > TRIM && dist(*p, pb) > TRIM)
                    .collect();
                if kept.len() < 2 {
                    (ja, if ja == jb { Vec::new() } else { vec![Seg::Line(jb)] }, 0)
                } else {
                    // WORKAROUND: open chain → closed loop [ja, kept.., jb] whose closing chord is
                    // dropped; ja/jb pinned so they are forced corners and never move or trim.
                    let mut points = vec![ja];
                    points.extend(kept.iter().map(|x| x.0));
                    let mut pinned = vec![true];
                    pinned.extend(kept.iter().map(|_| false));
                    let mut sat = vec![false];
                    sat.extend(kept.iter().map(|x| x.1));
                    if ja != jb {
                        points.push(jb);
                        pinned.push(true);
                        sat.push(false);
                    }
                    let n = points.len();
                    let ct = Contour {
                        points,
                        pinned,
                        hidden: vec![false; n],
                        saturated: sat,
                    };
                    let l = precision::fit_contour(&ct, &o).expect("open chain fits");
                    assert_eq!(l.start, ja, "chain fit must start at its junction");
                    let cut = l
                        .segs
                        .iter()
                        .position(|s| end(s) == jb)
                        .expect("chain fit reaches its end junction");
                    let segs = l.segs[..=cut].to_vec();
                    if ja != jb {
                        assert_eq!(l.segs.len(), cut + 2, "only the closing chord is dropped");
                    }
                    (ja, segs, l.recognised)
                }
            };
            self.chains[ci].start = start;
            self.chains[ci].segs = segs;
            self.chains[ci].recognised = rec;
        }
    }

    /// Compound path of a set of faces from the shared edges; returns the pieces used.
    fn assemble(&self, inside: &dyn Fn(u32) -> bool, b: &mut PathBuilder) -> Vec<(usize, bool)> {
        let mut used = Vec::new();
        for lp in self.walk(inside) {
            let mut first = true;
            for pc in self.pieces(&lp) {
                let (ci, rev) = self.lookup(&pc).expect("every boundary piece is a graph edge");
                used.push((ci, rev));
                let c = &self.chains[ci];
                let (s, segs) = if rev {
                    reversed(c.start, &c.segs)
                } else {
                    (c.start, c.segs.clone())
                };
                if first {
                    b.move_to(q(s[0]), q(s[1]));
                    first = false;
                }
                segs.iter().for_each(|x| push(b, x));
            }
            b.close();
        }
        used
    }
}

// ---------------------------------------------------------------------------------------------
// Scene helpers and metrics

fn scene_with(template: &Scene, paths: Vec<(Rgba, PathBuilder)>) -> Scene {
    let mut s = template.clone();
    s.groups[0].paths = paths
        .into_iter()
        .map(|(c, b)| {
            let pid = template.palette.iter().find(|e| e.color == c).map(|e| e.id.clone());
            b.finish(
                Some(Fill {
                    color: c,
                    palette_id: pid,
                }),
                FillRule::Evenodd,
            )
        })
        .collect();
    s
}

/// Subpaths as (start, segments) from a scene path.
fn subpaths(p: &vector_engine::scene::Path) -> Vec<(P, Vec<Seg>)> {
    let (mut out, mut k) = (Vec::new(), 0);
    for v in p.verbs.chars() {
        match v {
            'M' => {
                out.push(([p.coords[k], p.coords[k + 1]], Vec::new()));
                k += 2;
            }
            'L' => {
                out.last_mut()
                    .unwrap()
                    .1
                    .push(Seg::Line([p.coords[k], p.coords[k + 1]]));
                k += 2;
            }
            'C' => {
                let c = &p.coords[k..k + 6];
                out.last_mut()
                    .unwrap()
                    .1
                    .push(Seg::Cubic([c[0], c[1], c[2], c[3], c[4], c[5]]));
                k += 6;
            }
            _ => {}
        }
    }
    out
}

fn anchors(p: &vector_engine::scene::Path) -> Vec<P> {
    subpaths(p)
        .into_iter()
        .flat_map(|(s, segs)| std::iter::once(s).chain(segs.iter().map(end)).collect::<Vec<_>>())
        .collect()
}

fn d_attr(p: &vector_engine::scene::Path) -> String {
    let mut d = String::new();
    for (s, segs) in subpaths(p) {
        d += &format!("M{} {}", s[0], s[1]);
        for x in segs {
            d += &match x {
                Seg::Line(e) => format!("L{} {}", e[0], e[1]),
                Seg::Cubic(c) => format!("C{} {} {} {} {} {}", c[0], c[1], c[2], c[3], c[4], c[5]),
            };
        }
        d += "Z";
    }
    d
}

/// Crisp (non-antialiased) coverage of each path at `s`× via resvg.
fn crisp_masks(scene: &Scene, w: usize, h: usize, s: usize) -> Vec<Vec<bool>> {
    scene.groups[0]
        .paths
        .iter()
        .map(|p| {
            let svg = format!(
                r##"<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><path d="{}" fill="#000" fill-rule="evenodd" shape-rendering="crispEdges"/></svg>"##,
                d_attr(p)
            );
            let tree = resvg::usvg::Tree::from_str(&svg, &resvg::usvg::Options::default()).unwrap();
            let mut pm = sk::Pixmap::new((w * s) as u32, (h * s) as u32).unwrap();
            resvg::render(&tree, sk::Transform::from_scale(s as f32, s as f32), &mut pm.as_mut());
            pm.pixels().iter().map(|px| px.alpha() > 127).collect()
        })
        .collect()
}

fn nearest(pal: &[[u8; 4]], c: [u8; 3]) -> usize {
    (0..pal.len())
        .min_by_key(|&k| {
            (0..3)
                .map(|j| (i32::from(c[j]) - i32::from(pal[k][j])).pow(2))
                .sum::<i32>()
        })
        .unwrap()
}

/// 4-connected components: (colour, samples, bbox).
fn components(g: &[usize], w: usize, h: usize) -> Vec<(usize, usize, [usize; 4])> {
    let mut seen = vec![false; w * h];
    let mut out = Vec::new();
    for s in 0..w * h {
        if seen[s] {
            continue;
        }
        let (l, mut n, mut bb) = (g[s], 0, [usize::MAX, usize::MAX, 0, 0]);
        seen[s] = true;
        let mut st = vec![s];
        while let Some(i) = st.pop() {
            n += 1;
            let (x, y) = (i % w, i / w);
            bb = [bb[0].min(x), bb[1].min(y), bb[2].max(x), bb[3].max(y)];
            for j in [
                (x > 0).then(|| i - 1),
                (x + 1 < w).then(|| i + 1),
                (y > 0).then(|| i - w),
                (y + 1 < h).then(|| i + w),
            ]
            .into_iter()
            .flatten()
            {
                if !seen[j] && g[j] == l {
                    seen[j] = true;
                    st.push(j);
                }
            }
        }
        out.push((l, n, bb));
    }
    out
}

/// Output components of a colour beyond the truth's count for that colour, ≥ 0.25 source px².
fn specks(grid: &[usize], truth: &[usize], w: usize, h: usize, s: usize, pal: &[[u8; 4]]) -> Vec<String> {
    let min = s * s / 4;
    let tc = components(truth, w, h);
    let oc = components(grid, w, h);
    let mut out = Vec::new();
    for k in 0..pal.len() {
        let expect = tc.iter().filter(|c| c.0 == k && c.1 >= min).count();
        let mut mine: Vec<_> = oc.iter().filter(|c| c.0 == k).collect();
        mine.sort_by_key(|c| std::cmp::Reverse(c.1));
        for c in mine.iter().skip(expect).filter(|c| c.1 >= min) {
            let sf = s as f64;
            out.push(format!(
                "#{:02x}{:02x}{:02x} {:.2} px² bbox ({:.2},{:.2})–({:.2},{:.2})",
                pal[k][0],
                pal[k][1],
                pal[k][2],
                c.1 as f64 / (sf * sf),
                c.2[0] as f64 / sf,
                c.2[1] as f64 / sf,
                (c.2[2] + 1) as f64 / sf,
                (c.2[3] + 1) as f64 / sf
            ));
        }
    }
    out
}

struct Ctx<'a> {
    f: &'a GeoFixture,
    truth: geometry::Truth,
    tjunctions: Vec<P>,
    pal: Vec<[u8; 4]>,
    truth_grid: Vec<usize>,
    spline_anchors: u64,
}
const S: usize = 4;

/// Tier A thresholds exactly as `examples/geo_eval.rs::misses` applies them to ideal fixtures,
/// minus its topology and P0-IoU checks (topology is reported here as specks).
fn tier_a_misses(r: &geometry::Report, anchors: u64, spline_anchors: u64) -> Vec<String> {
    let mut fail = Vec::new();
    let mut check = |ok: bool, what: String| {
        if !ok {
            fail.push(what);
        }
    };
    check(
        r.contour_smooth.rms <= 0.25,
        format!("contour RMS {:.3}", r.contour_smooth.rms),
    );
    check(
        r.contour_smooth.max_abs <= 0.75,
        format!("contour max {:.3}", r.contour_smooth.max_abs),
    );
    check(
        r.smooth_join_breaks == 0,
        format!(
            "{} tangent breaks (max {:.1}°)",
            r.smooth_join_breaks, r.max_smooth_join_angle_deg
        ),
    );
    for c in &r.circles {
        if c.visible_fraction < 0.1 || c.radial.n < 20 {
            continue;
        }
        let tag = format!("circle r={}", c.true_radius);
        check(c.center_error <= 0.5, format!("{tag} centre {:.3}", c.center_error));
        check(
            c.radius_error.abs() <= 0.5,
            format!("{tag} radius {:+.3}", c.radius_error),
        );
        check(c.radial.rms <= 0.25, format!("{tag} radial RMS {:.3}", c.radial.rms));
        check(
            c.radial.max_abs <= 0.75,
            format!("{tag} radial max {:.3}", c.radial.max_abs),
        );
        check(
            c.curvature.rms <= 0.15,
            format!("{tag} curvature RMS {:.3}", c.curvature.rms),
        );
        check(
            c.curvature.max_abs <= 0.5,
            format!("{tag} curvature max {:.3}", c.curvature.max_abs),
        );
    }
    for l in &r.loops {
        check(
            l.center_error <= 0.5 && l.major_error.abs() <= 0.5 && l.minor_error.abs() <= 0.5,
            format!(
                "loop axes/centre {:.3}/{:+.3}/{:+.3}",
                l.center_error, l.major_error, l.minor_error
            ),
        );
        check(
            l.area_error_rel.abs() <= 0.01,
            format!("loop area {:+.4}", l.area_error_rel),
        );
        if let Some(o) = l.orientation_error_deg {
            check(o <= 1.0, format!("orientation {o:.2}°"));
        }
    }
    if r.line_deviation.n > 0 {
        check(
            r.line_deviation.rms <= 0.15,
            format!("line RMS {:.3}", r.line_deviation.rms),
        );
        check(
            r.line_deviation.max_abs <= 0.5,
            format!("line max {:.3}", r.line_deviation.max_abs),
        );
        check(
            r.line_max_curvature <= 0.005,
            format!("line curvature {:.4}", r.line_max_curvature),
        );
    }
    check(
        r.other_corner_position_max <= 1.0,
        format!("corner {:.2} px", r.other_corner_position_max),
    );
    check(
        r.acute_corner_position_max <= 1.5,
        format!("acute corner {:.2} px", r.acute_corner_position_max),
    );
    let cap = (spline_anchors as f64 * 1.5).max(spline_anchors as f64 + 8.0);
    check(anchors as f64 <= cap, format!("anchors {anchors} > {cap:.0}"));
    fail
}

fn metrics(cx: &Ctx, scene: &Scene, mosaic: bool) -> Value {
    let (f, w, h) = (cx.f, cx.f.w, cx.f.h);
    let (sw, sh) = (w * S, h * S);
    let stats = scene.validate(1_000_000).map_err(|e| e.to_string());
    let svg = vector_engine::svg::to_svg(scene).unwrap();
    let pdf_ok = to_pdf(
        scene,
        &PdfOptions {
            width: 200.0,
            unit: Unit::Mm,
            dpi: None,
        },
    )
    .is_ok();
    // Registered metric: antialiased render, nearest truth colour.
    let pm = render::rendered(&svg, f, [0.0, 0.0, w as f64, h as f64], S as f32);
    let aa: Vec<usize> = pm
        .pixels()
        .iter()
        .map(|p| {
            let c = p.demultiply();
            nearest(&cx.pal, [c.red(), c.green(), c.blue()])
        })
        .collect();
    let aa_specks = specks(&aa, &cx.truth_grid, sw, sh, S, &cx.pal);
    // Geometric metric (defined in this spike): crisp samples, colour of the topmost path.
    let masks = crisp_masks(scene, w, h, S);
    let bg = nearest(&cx.pal, [f.background[0], f.background[1], f.background[2]]);
    let cols: Vec<usize> = scene.groups[0]
        .paths
        .iter()
        .map(|p| {
            let c = p.fill.as_ref().unwrap().color;
            nearest(&cx.pal, [c.r, c.g, c.b])
        })
        .collect();
    let mut crisp = vec![bg; sw * sh];
    let mut mult = vec![0u8; sw * sh];
    for (m, c) in masks.iter().zip(&cols) {
        for i in 0..sw * sh {
            if m[i] {
                crisp[i] = *c;
                mult[i] += 1;
            }
        }
    }
    let geo_specks = specks(&crisp, &cx.truth_grid, sw, sh, S, &cx.pal);
    let (gaps, overlaps) = (
        mult.iter().filter(|m| **m == 0).count(),
        mult.iter().filter(|m| **m > 1).count(),
    );
    // Shape metrics (P0 harness).
    let r = geometry::evaluate(&cx.truth, scene, w, h);
    let worst = |g: fn(&geometry::CircleReport) -> f64| r.circles.iter().map(g).fold(0.0, f64::max);
    // Junction coincidence (defined in this spike): at each true junction, the nearest anchor of
    // every path whose outline passes within 1.5 px; spread = largest pairwise distance.
    let samp = geometry::sample_scene(scene, 0.1);
    let anc: Vec<Vec<P>> = scene.groups[0].paths.iter().map(anchors).collect();
    let (mut spread_max, mut over, mut err_max) = (0.0f64, 0, 0.0f64);
    for j in &cx.tjunctions {
        let mut near: Vec<P> = Vec::new();
        for (pi, a) in anc.iter().enumerate() {
            if samp
                .polys
                .iter()
                .any(|(k, poly)| *k == pi && poly.iter().any(|p| dist(*p, *j) < 1.5))
            {
                near.push(*a.iter().min_by(|x, y| dist(**x, *j).total_cmp(&dist(**y, *j))).unwrap());
            }
        }
        let sp = near
            .iter()
            .flat_map(|a| near.iter().map(move |b| dist(*a, *b)))
            .fold(0.0, f64::max);
        spread_max = spread_max.max(sp);
        over += usize::from(sp > 0.1);
        err_max = err_max.max(near.iter().map(|a| dist(*a, *j)).fold(0.0, f64::max));
    }
    json!({
        "valid": stats.as_ref().map(|_| true).unwrap_or(false),
        "validateError": stats.as_ref().err(),
        "anchors": stats.as_ref().map(|s| s.anchors).unwrap_or(0),
        "paths": scene.groups[0].paths.len(),
        "pdfOk": pdf_ok,
        "specksAA4x": aa_specks.len(),
        "specksAA4xMaxPx2": aa_specks.iter().map(|s| s.split(' ').nth(1).unwrap().parse::<f64>().unwrap()).fold(0.0, f64::max),
        "specksGeo4x": geo_specks.len(),
        "specksGeo4xMaxPx2": geo_specks.iter().map(|s| s.split(' ').nth(1).unwrap().parse::<f64>().unwrap()).fold(0.0, f64::max),
        "specksAAList": aa_specks,
        "specksGeoList": geo_specks,
        "crispGapSamples": if mosaic { json!(gaps) } else { Value::Null },
        "crispOverlapSamples": if mosaic { json!(overlaps) } else { Value::Null },
        "contourRms": r.contour.rms,
        "contourMax": r.contour.max_abs,
        "curvRmsWorst": worst(|c| c.curvature.rms),
        "curvMaxWorst": worst(|c| c.curvature.max_abs),
        "radialMaxWorst": worst(|c| c.radial.max_abs),
        "centreErrWorst": worst(|c| c.center_error),
        "tangentBreaks": r.smooth_join_breaks,
        "contourSmoothRms": r.contour_smooth.rms,
        "contourSmoothMax": r.contour_smooth.max_abs,
        "radialRmsWorst": worst(|c| c.radial.rms),
        "radiusErrWorst": r.circles.iter().map(|c| c.radius_error.abs()).fold(0.0, f64::max),
        "cornerPosMax": r.other_corner_position_max,
        "acuteCornerPosMax": r.acute_corner_position_max,
        "lineRms": r.line_deviation.rms,
        "lineMax": r.line_deviation.max_abs,
        "lineMaxCurvature": r.line_max_curvature,
        "tierAMisses": tier_a_misses(&r, stats.as_ref().map(|s| s.anchors).unwrap_or(0), cx.spline_anchors),
        "junctions": cx.tjunctions.len(),
        "junctionSpreadMax": spread_max,
        "junctionsSpreadOver0.1": over,
        "junctionAnchorErrMax": err_max,
    })
}

/// Re-derived from the emitted (quantised) scene: closed subpaths, interior segments used
/// exactly twice with opposite orientation, frame segments once.
fn edge_usage(scene: &Scene, w: usize, h: usize) -> Value {
    let key = |a: P, c: &[f64], b: P| -> Vec<i64> {
        let mut v = vec![a[0], a[1]];
        v.extend_from_slice(c);
        v.extend_from_slice(&b);
        v.iter().map(|x| (x * 100.0).round() as i64).collect()
    };
    let mut uses: HashMap<Vec<i64>, (usize, usize)> = HashMap::new();
    let (mut open, mut border) = (0, 0);
    for p in &scene.groups[0].paths {
        for (s, segs) in subpaths(p) {
            if segs.last().map(end) != Some(s) {
                open += 1;
            }
            let mut prev = s;
            for x in &segs {
                let e = end(x);
                let (fwd, rev) = match *x {
                    Seg::Line(_) => (key(prev, &[], e), key(e, &[], prev)),
                    Seg::Cubic(c) => (key(prev, &c[..4], e), key(e, &[c[2], c[3], c[0], c[1]], prev)),
                };
                let on_frame = |p: P| p[0] == 0.0 || p[1] == 0.0 || p[0] == w as f64 || p[1] == h as f64;
                if matches!(x, Seg::Line(_)) && on_frame(prev) && on_frame(e) && (prev[0] == e[0] || prev[1] == e[1]) {
                    border += 1;
                } else if fwd <= rev {
                    uses.entry(fwd).or_default().0 += 1;
                } else {
                    uses.entry(rev).or_default().1 += 1;
                }
                prev = e;
            }
        }
    }
    let paired = uses.values().filter(|u| **u == (1, 1)).count();
    let same_dir = uses.values().filter(|u| u.0 > 1 || u.1 > 1).count();
    json!({"openSubpaths": open, "frameSegments": border, "segmentKeys": uses.len(), "pairedOpposite": paired, "unpaired": uses.len() - paired, "reusedSameDirection": same_dir})
}

// ---------------------------------------------------------------------------------------------

/// Negative control for the metrics: the fixture's own analytic shapes in source paint order
/// (circles as 8 cubic arcs, error < 1e-5·r; polygons exact).
fn truth_scene(f: &GeoFixture, template: &Scene) -> Scene {
    let mut paths = vec![(Rgba::rgb(f.background[0], f.background[1], f.background[2]), {
        let mut b = PathBuilder::default();
        let (w, h) = (f.w as f64, f.h as f64);
        b.move_to(0.0, 0.0);
        b.line_to(w, 0.0);
        b.line_to(w, h);
        b.line_to(0.0, h);
        b.close();
        b
    })];
    for (shape, c) in &f.layers {
        let mut b = PathBuilder::default();
        match shape {
            geometry::Shape::Circle { c, r } => {
                let (t, k) = (
                    std::f64::consts::FRAC_PI_4,
                    4.0 / 3.0 * (std::f64::consts::FRAC_PI_4 / 4.0).tan() * r,
                );
                let at = |a: f64| [c[0] + r * a.cos(), c[1] + r * a.sin()];
                b.move_to(at(0.0)[0], at(0.0)[1]);
                for i in 0..8 {
                    let (a0, a1) = (t * i as f64, t * (i + 1) as f64);
                    let (p0, p1) = (at(a0), at(a1));
                    b.cubic_to([
                        p0[0] - k * a0.sin(),
                        p0[1] + k * a0.cos(),
                        p1[0] + k * a1.sin(),
                        p1[1] - k * a1.cos(),
                        p1[0],
                        p1[1],
                    ]);
                }
                b.close();
            }
            geometry::Shape::Polygon(pts) => {
                b.move_to(pts[0][0], pts[0][1]);
                pts[1..].iter().for_each(|p| b.line_to(p[0], p[1]));
                b.close();
            }
            _ => panic!("truth_scene: unsupported shape"),
        }
        paths.push((Rgba::rgb(c[0], c[1], c[2]), b));
    }
    scene_with(template, paths)
}

fn request(f: &GeoFixture) -> TraceRequest {
    let mut s: Value = serde_json::from_str(&f.settings).unwrap();
    s["fit"] = json!({"mode": "precision"});
    TraceRequest::from_json(&json!({"presetVersion": 1, "seed": 1, "settings": s}).to_string()).unwrap()
}

const REPO: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../..");

fn main() {
    let dir = std::env::args()
        .nth(1)
        .unwrap_or_else(|| format!("{REPO}/tests/output/rfc002-r04/shared-boundary"));
    std::fs::create_dir_all(&dir).unwrap();
    let ids = [
        "04-color-discs",
        "discs-two-deep",
        "discs-x2",
        "h-discs-three",
        "adjacent-overlap",
        "concentric",
    ];
    let fixtures: Vec<GeoFixture> = corpus::rejected()
        .into_iter()
        .chain(corpus::all())
        .filter(|f| ids.contains(&f.id.as_str()))
        .collect();
    let luma = Luma::new();
    let mut rows = Vec::new();
    let mut extra = serde_json::Map::new();
    let mut crops: Vec<(String, Scene, &GeoFixture)> = Vec::new();
    for f in &fixtures {
        let (w, h) = (f.w, f.h);
        let req = request(f);
        let prod = vector_engine::vectorize(&f.rgba, w as u32, h as u32, &req, &|| 0.0).unwrap();
        let layers = vector_engine::segment_layers(&f.rgba, w as u32, h as u32, &req).unwrap();
        let cols: Vec<Rgba> = layers.iter().map(|l| l.0).collect();
        let masks: Vec<Mask> = layers.into_iter().map(|l| l.1).collect();
        let vis = visible(&masks, w, h);
        let map = truth_map(f, &vis);
        let oracle: Vec<u32> = (0..w * h).map(|i| map[tl(f, centre(i, w))]).collect();
        let nest = nesting(&masks, &vis, w);
        let omasks: Vec<Mask> = (0..masks.len())
            .map(|l| Mask {
                x0: 0,
                y0: 0,
                w,
                h,
                bits: oracle.iter().map(|&t| t != NONE && nest[l][t as usize]).collect(),
            })
            .collect();
        let relabelled = vis.iter().zip(&oracle).filter(|(a, b)| a != b).count();
        let mask_delta: Vec<usize> = (0..masks.len())
            .map(|l| {
                (0..w * h)
                    .filter(|&i| in_mask(&masks[l], i % w, i / w) != omasks[l].bits[i])
                    .count()
            })
            .collect();
        let mut pal: Vec<[u8; 4]> = vec![f.background];
        for (_, c) in &f.layers {
            if !pal.contains(c) {
                pal.push(*c);
            }
        }
        let truth_grid: Vec<usize> = (0..w * S * h * S)
            .map(|i| {
                let p = [
                    ((i % (w * S)) as f64 + 0.5) / S as f64,
                    ((i / (w * S)) as f64 + 0.5) / S as f64,
                ];
                let c = f.label_at(p).map_or(f.background, |k| f.layers[k].1);
                pal.iter().position(|x| *x == c).unwrap()
            })
            .collect();
        let truth = f.truth(0.05);
        let tjunctions: Vec<P> = truth.corners.iter().filter(|c| c.1.is_none()).map(|c| c.0).collect();
        let spline_req = TraceRequest::from_json(
            &json!({"presetVersion": 1, "seed": 1, "settings": serde_json::from_str::<Value>(&f.settings).unwrap()})
                .to_string(),
        )
        .unwrap();
        let spline_anchors = vector_engine::vectorize(&f.rgba, w as u32, h as u32, &spline_req, &|| 0.0)
            .unwrap()
            .metrics
            .stats
            .anchors;
        let cx = Ctx {
            f,
            truth,
            tjunctions: tjunctions.clone(),
            pal,
            truth_grid,
            spline_anchors,
        };
        let img = RgbaImage::new(&f.rgba, w as u32, h as u32, 1 << 26).unwrap();
        let pol = EdgePolicy::Color { alpha_threshold: 128 };
        let sub = Options::production(60).subpixel;
        let field_e = Field::new(img, &luma, pol, sub, masks.iter().cloned());
        let field_o = Field::new(img, &luma, pol, sub, omasks.iter().cloned());
        // Oracle labels only within 3 px of a true junction: bound for a junction-local blend correction.
        let local: Vec<u32> = (0..w * h)
            .map(|i| {
                if tjunctions.iter().any(|t| dist(*t, centre(i, w)) <= 3.0) {
                    oracle[i]
                } else {
                    vis[i]
                }
            })
            .collect();
        let lmasks: Vec<Mask> = (0..masks.len())
            .map(|l| Mask {
                x0: 0,
                y0: 0,
                w,
                h,
                bits: local.iter().map(|&t| t != NONE && nest[l][t as usize]).collect(),
            })
            .collect();
        let field_l = Field::new(img, &luma, pol, sub, lmasks.iter().cloned());
        let prod_svg = vector_engine::svg::to_svg(&prod.scene).unwrap();
        let mut row = |variant: &str, scene: &Scene, mosaic: bool, more: Value| {
            let mut m = metrics(&cx, scene, mosaic);
            m["fixture"] = json!(f.id);
            m["variant"] = json!(variant);
            for (k, v) in more.as_object().unwrap() {
                m[k] = v.clone();
            }
            eprintln!(
                "{} {variant}: AA {} geo {} curv {:.3}/{:.2} spread {:.3}",
                f.id,
                m["specksAA4x"],
                m["specksGeo4x"],
                m["curvRmsWorst"].as_f64().unwrap(),
                m["curvMaxWorst"].as_f64().unwrap(),
                m["junctionSpreadMax"].as_f64().unwrap()
            );
            rows.push(m);
        };
        let bundle_case = match f.id.as_str() {
            "04-color-discs" => Some("04-color-discs"),
            "discs-two-deep" => Some("22-discs-deep"),
            "h-discs-three" => Some("21-discs-three"),
            "adjacent-overlap" => Some("20-overlap-rect-disc-square"),
            _ => None,
        };
        let same = bundle_case.map(|c| {
            let p = format!("{REPO}/docs/research/p0-r-geo/owner-acceptance-bundle-v2/{c}-corrected-precision.svg");
            std::fs::read_to_string(p).unwrap() == prod_svg
        });
        row(
            "T analytic truth shapes (negative control)",
            &truth_scene(f, &prod.scene),
            false,
            json!({}),
        );
        row(
            "P0 production precision",
            &prod.scene,
            false,
            json!({"bundleCase": bundle_case, "svgByteIdenticalToBundleV2": same}),
        );
        // A: independent stacked fits.
        let a0 = scene_with(&prod.scene, independent(&field_e, &masks, &cols, None));
        let a0_diff = prod.scene.groups[0]
            .paths
            .iter()
            .zip(&a0.groups[0].paths)
            .map(|(p, r)| {
                if p.verbs == r.verbs {
                    p.coords
                        .iter()
                        .zip(&r.coords)
                        .map(|(a, b)| (a - b).abs())
                        .fold(0.0, f64::max)
                } else {
                    f64::INFINITY
                }
            })
            .fold(0.0, f64::max);
        row(
            "A0 replica, engine labels",
            &a0,
            false,
            json!({"maxCoordDiffVsProduction": if a0_diff.is_finite() { json!(a0_diff) } else { json!("verbs differ") }}),
        );
        let a1 = scene_with(&prod.scene, independent(&field_o, &omasks, &cols, None));
        row("A1 oracle labels", &a1, false, json!({}));
        let a2 = scene_with(&prod.scene, independent(&field_o, &omasks, &cols, Some((f, &map))));
        row("A2 oracle labels + analytic crossings", &a2, false, json!({}));
        if f.id == "04-color-discs" {
            crops.push(("P0".into(), prod.scene.clone(), f));
            crops.push(("A2".into(), a2.clone(), f));
        }
        // B: shared boundary graph.
        let configs = [
            ("B engine labels, est. junctions", 0, false, Junctions::Estimated),
            ("B engine labels, analytic junctions", 0, false, Junctions::Analytic),
            (
                "B junction-local (3 px) oracle labels, est. junctions",
                2,
                false,
                Junctions::Estimated,
            ),
            ("B oracle labels, est. junctions", 1, false, Junctions::Estimated),
            (
                "B oracle labels + analytic crossings + junctions",
                1,
                true,
                Junctions::Analytic,
            ),
        ];
        for (name, src, ana, jmode) in configs {
            let (labels, field) = match src {
                0 => (&vis, &field_e),
                1 => (&oracle, &field_o),
                _ => (&local, &field_l),
            };
            let mem0 = CUR.load(Relaxed);
            PEAK.store(mem0, Relaxed);
            let t0 = Instant::now();
            let mut g = Graph::build(labels, w, h, field);
            if ana {
                let keys: Vec<(usize, usize)> = g.cross.keys().copied().collect();
                for k in keys {
                    if let Some(p) = analytic_point(f, &map, k.0, k.1) {
                        g.cross.insert(k, (p, false));
                    }
                }
            }
            let t1 = Instant::now();
            g.place_junctions(jmode, &tjunctions);
            g.fit();
            let t2 = Instant::now();
            let mut mosaic = Vec::new();
            let mut stacked = Vec::new();
            let mut uses = vec![(0usize, 0usize); g.chains.len()];
            for l in 0..cols.len() as u32 {
                let mut b = PathBuilder::default();
                for (ci, rev) in g.assemble(&|x| x != OUT && g.face_label[x as usize] == l, &mut b) {
                    if rev { uses[ci].1 += 1 } else { uses[ci].0 += 1 }
                }
                if !b.is_empty() {
                    mosaic.push((cols[l as usize], b));
                }
                let mut b = PathBuilder::default();
                g.assemble(
                    &|x| {
                        x != OUT
                            && g.face_label[x as usize] != NONE
                            && nest[l as usize][g.face_label[x as usize] as usize]
                    },
                    &mut b,
                );
                if !b.is_empty() {
                    stacked.push((cols[l as usize], b));
                }
            }
            let t3 = Instant::now();
            let peak = PEAK.load(Relaxed).saturating_sub(mem0);
            let border_chain = |c: &Chain| {
                let ((ix, iy), (ox, oy)) = crack_pixels(c.cracks[0]);
                g.fid(ix, iy) == OUT || g.fid(ox, oy) == OUT
            };
            let interior: Vec<usize> = (0..g.chains.len()).filter(|&c| !border_chain(&g.chains[c])).collect();
            let bad_use = interior.iter().filter(|&&c| uses[c] != (1, 1)).count();
            let ms = scene_with(&prod.scene, mosaic);
            let ss = scene_with(&prod.scene, stacked);
            // Junction coincidence from the emitted mosaic: every face path incident to a graph
            // junction carries exactly that (quantised) anchor.
            let mut jfail = 0;
            for (v, p) in &g.junctions {
                let (x, y) = ((v % (w + 1)) as i64, (v / (w + 1)) as i64);
                let jp = [q(p[0]), q(p[1])];
                for fi in [g.fid(x - 1, y - 1), g.fid(x, y - 1), g.fid(x - 1, y), g.fid(x, y)] {
                    if fi == OUT {
                        continue;
                    }
                    let l = g.face_label[fi as usize];
                    let pi = ms.groups[0]
                        .paths
                        .iter()
                        .position(|pp| pp.fill.as_ref().unwrap().color == cols[l as usize])
                        .unwrap();
                    if !anchors(&ms.groups[0].paths[pi]).contains(&jp) {
                        jfail += 1;
                    }
                }
            }
            let short_edges = interior.iter().filter(|&&c| g.chains[c].cracks.len() <= 3).count();
            let jerr = g
                .junctions
                .values()
                .map(|p| tjunctions.iter().map(|t| dist(*t, *p)).fold(f64::INFINITY, f64::min))
                .fold(0.0, f64::max);
            // Where the mosaic's boundary is furthest from the truth (diagnostic).
            let worst_at = geometry::sample_scene(&ms, 0.1)
                .samples
                .iter()
                .filter_map(|o| cx.truth.nearest(o.p, 4.0).map(|(_, d)| (d, o.p)))
                .max_by(|a, b| a.0.total_cmp(&b.0))
                .map(|(d, p)| json!({"d": d, "at": p}));
            let graph = json!({
                "faces": g.face_label.len(),
                "faceLabels": g.face_label.len(),
                "junctions": g.junctions.len(),
                "edges": g.chains.len(),
                "interiorEdges": interior.len(),
                "edgesOf3CracksOrFewer": short_edges,
                "closedEdges": g.chains.iter().filter(|c| c.closed).count(),
                "interiorEdgesWithRecognisedArc": interior.iter().filter(|&&c| g.chains[c].recognised > 0).count(),
                "interiorEdgesWithCubicSegments": interior.iter().filter(|&&c| g.chains[c].recognised == 0 && g.chains[c].segs.iter().any(|x| matches!(x, Seg::Cubic(_)))).count(),
                "cracks": g.dir.len(),
                "crossingSideDisagreementMax": g.cross_asym,
                "interiorEdgesNotUsedOnceEachWay": bad_use,
                "junctionAnchorMissingInMosaic": jfail,
                "junctionErrVsTruthMax": jerr,
                "mosaicWorstBoundaryDeviation": worst_at,
                "msBuildFacesCracksChains": (t1 - t0).as_secs_f64() * 1e3,
                "msJunctionsAndFit": (t2 - t1).as_secs_f64() * 1e3,
                "msAssembleMosaicAndStacked": (t3 - t2).as_secs_f64() * 1e3,
                "peakHeapBytes": peak,
            });
            eprintln!("{} {name}: {graph}", f.id);
            row(
                &format!("{name} → mosaic"),
                &ms,
                true,
                json!({"graph": graph.clone(), "edgeUsage": edge_usage(&ms, w, h)}),
            );
            row(
                &format!("{name} → stacked"),
                &ss,
                false,
                json!({"edgeUsage": edge_usage(&ss, w, h)}),
            );
            if f.id == "04-color-discs" && name.starts_with("B engine labels, est") {
                crops.push(("B stacked".into(), ss.clone(), f));
                crops.push(("B mosaic".into(), ms.clone(), f));
                // Editor contract demo on materialised paths.
                let red = ms.groups[0]
                    .paths
                    .iter()
                    .position(|p| p.fill.as_ref().unwrap().color.r > 200 && p.fill.as_ref().unwrap().color.g < 100)
                    .unwrap();
                let mut moved = ms.clone();
                let p = &mut moved.groups[0].paths[red];
                for c in p.coords.chunks_mut(2) {
                    c[0] += 2.0;
                }
                let others_identical = (0..ms.groups[0].paths.len()).filter(|&k| k != red).all(|k| {
                    serde_json::to_string(&ms.groups[0].paths[k]).unwrap()
                        == serde_json::to_string(&moved.groups[0].paths[k]).unwrap()
                });
                let mm = metrics(&cx, &moved, true);
                let mut nudged = ms.clone();
                let p = &mut nudged.groups[0].paths[red];
                let ci = p
                    .verbs
                    .chars()
                    .take_while(|v| *v != 'C')
                    .map(|v| if v == 'M' || v == 'L' { 2 } else { 0 })
                    .sum::<usize>();
                p.coords[ci] += 0.5; // first control point of the red path's first cubic
                extra.insert(
                    "editorDemo04".into(),
                    json!({
                        "translateRedFaceBy": [2.0, 0.0],
                        "otherPathsByteIdentical": others_identical,
                        "afterMove": {"crispGapSamples": mm["crispGapSamples"], "crispOverlapSamples": mm["crispOverlapSamples"], "specksGeo4x": mm["specksGeo4x"]},
                        "beforeMove": {"edgeUsage": edge_usage(&ms, w, h)},
                        "afterNudgingOneSharedControlPointInRedOnly": {"edgeUsage": edge_usage(&nudged, w, h)},
                    }),
                );
            }
        }
        if f.id == "04-color-discs" {
            // Metric calibration: an exact copy of the red path, filled yellow, directly beneath it.
            let mut cal = prod.scene.clone();
            let paths = &mut cal.groups[0].paths;
            let red = paths
                .iter()
                .position(|p| p.fill.as_ref().unwrap().color.r > 200 && p.fill.as_ref().unwrap().color.g < 100)
                .unwrap();
            let yellow = paths
                .iter()
                .position(|p| p.fill.as_ref().unwrap().color.g > 150 && p.fill.as_ref().unwrap().color.b < 100)
                .unwrap();
            let mut copy = paths[red].clone();
            copy.fill = paths[yellow].fill.clone();
            *paths = vec![paths[0].clone(), copy, paths[red].clone()];
            row(
                "calibration: white frame, yellow = exact copy of red, red",
                &cal,
                false,
                json!({}),
            );
        }
        extra.insert(
            f.id.clone(),
            json!({"engineLayers": cols.len(), "pixelsRelabelledByOracle": relabelled, "maskPixelsChangedPerLayer": mask_delta, "nesting": nest, "truthToLayer": map, "trueJunctions": tjunctions}),
        );
    }
    // One composite render of 04 at 32×: red disc's left extreme (P0 sliver site, x≈36) and the red/yellow/white junction (68.0, 163.1).
    let mut sheet = sk::Pixmap::new((crops.len() * 160) as u32, 320).unwrap();
    for (k, (_, sc, f)) in crops.iter().enumerate() {
        for (row, crop) in [[34.0, 100.5, 5.0, 5.0], [65.5, 160.5, 5.0, 5.0]].iter().enumerate() {
            let svg = vector_engine::svg::to_svg(sc).unwrap();
            let mut pm = render::rendered(&svg, f, *crop, 32.0);
            let t = sk::Transform::from_scale(32.0, 32.0).pre_translate(-crop[0] as f32, -crop[1] as f32);
            render::scene_overlay(&mut pm, t, sc, false);
            sheet.draw_pixmap(
                (k * 160) as i32,
                (row * 160) as i32,
                pm.as_ref(),
                &sk::PixmapPaint::default(),
                sk::Transform::identity(),
                None,
            );
        }
    }
    render::write_png(&format!("{dir}/04-crops-32x.png"), &sheet);
    let labels: Vec<&String> = crops.iter().map(|c| &c.0).collect();
    extra.insert("cropColumns".into(), json!(labels));
    std::fs::write(
        format!("{dir}/results.json"),
        serde_json::to_string_pretty(&json!({"rows": rows, "extra": extra})).unwrap(),
    )
    .unwrap();
    // Compact table.
    let mut md = String::from(
        "| Fixture | Variant | AA specks ≥0.25 (max) | Geo specks ≥0.25 (max) | Gap/overlap samples | Curv RMS / max (worst circle) | Contour RMS / max | Breaks | Junction spread max (>0.1) | Anchors |\n|---|---|---|---|---|---|---|---|---|---|\n",
    );
    for r in &rows {
        md += &format!(
            "| {} | {} | {} ({:.2}) | {} ({:.2}) | {} | {:.3} / {:.2} | {:.3} / {:.3} | {} | {:.3} ({}/{}) | {} |\n",
            r["fixture"].as_str().unwrap(),
            r["variant"].as_str().unwrap(),
            r["specksAA4x"],
            r["specksAA4xMaxPx2"].as_f64().unwrap(),
            r["specksGeo4x"],
            r["specksGeo4xMaxPx2"].as_f64().unwrap(),
            if r["crispGapSamples"].is_null() {
                "—".to_string()
            } else {
                format!("{}/{}", r["crispGapSamples"], r["crispOverlapSamples"])
            },
            r["curvRmsWorst"].as_f64().unwrap(),
            r["curvMaxWorst"].as_f64().unwrap(),
            r["contourRms"].as_f64().unwrap(),
            r["contourMax"].as_f64().unwrap(),
            r["tangentBreaks"],
            r["junctionSpreadMax"].as_f64().unwrap(),
            r["junctionsSpreadOver0.1"],
            r["junctions"],
            r["anchors"],
        );
    }
    std::fs::write(format!("{dir}/summary.md"), &md).unwrap();
    println!("{md}");
}
