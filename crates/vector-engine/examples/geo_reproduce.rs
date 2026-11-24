//! P0-R-GEO Stage A: reproduces DEF-GEO-001 (`05-color-transparent-hole`) and DEF-GEO-002
//! (`04-color-discs`) with the exact owner-bundle settings, and localises the distortion.
//!
//! - Replays VTracer's stacked spline stages per layer with visioncortex's public API:
//!   lattice walk → staircase-removed polygon → 4-point subdivision (outset 8) → splice
//!   points → per-splice cubic fit. Asserts the replay equals the engine's scene.
//! - Measures each stage against the analytic circles (visible boundaries only).
//! - Checks that SVG path data and PDF content-stream operands equal the scene coordinates.
//! - Writes annotated overlays (PNG).
//!
//! Usage: cargo run --release -p vector-engine --example geo_reproduce -- <out-dir>
#[path = "../tests/common/exports.rs"]
mod exports;
#[path = "../tests/common/fixtures.rs"]
mod fixtures;
#[path = "../tests/common/geometry.rs"]
mod geometry;

use geometry::{GeoFixture, P, Shape, Stats, Truth};
use resvg::tiny_skia as sk;
use serde::Serialize;
use vector_engine::params::TraceRequest;
use vector_engine::pdf::{PdfOptions, Unit, to_pdf};
use vector_engine::scene::Scene;
use vector_engine::svg::to_svg;
use visioncortex::{BinaryImage, PathI32, PathSimplifyMode, PointF64, Spline, SubdivideSmooth};

const MANIFEST: &str = include_str!("../../../docs/research/p0-r/owner-acceptance-bundle/MANIFEST.json");

fn bundle_request(file: &str) -> (TraceRequest, String) {
    let m: serde_json::Value = serde_json::from_str(MANIFEST).unwrap();
    let e = m.as_array().unwrap().iter().find(|e| e["file"] == file).unwrap();
    let json = e["settings"].to_string();
    (TraceRequest::from_json(&json).unwrap(), json)
}

fn case(id: &str) -> GeoFixture {
    match id {
        "05-color-transparent-hole" => {
            let frame = Shape::Polygon(vec![[0.0, 0.0], [256.0, 0.0], [256.0, 256.0], [0.0, 256.0]]);
            GeoFixture {
                id: id.into(),
                set: "rejected",
                description: "Opaque blue field (30,60,200) with a transparent circular hole c=(128,100) r=20".into(),
                w: 256,
                h: 256,
                background: [0, 0, 0, 0],
                layers: vec![(
                    Shape::Diff(
                        Box::new(frame),
                        Box::new(Shape::Circle {
                            c: [128.0, 100.0],
                            r: 20.0,
                        }),
                    ),
                    [30, 60, 200, 255],
                )],
                settings: String::new(),
                ideal: true,
                rgba: fixtures::logo_transparent_hole().rgba,
            }
        }
        _ => GeoFixture {
            id: id.into(),
            set: "rejected",
            description: "Discs r=60 at (96,110) red, (160,110) blue, (128,165) yellow, painted in that order on white"
                .into(),
            w: 256,
            h: 256,
            background: [255, 255, 255, 255],
            layers: vec![
                (
                    Shape::Circle {
                        c: [96.0, 110.0],
                        r: 60.0,
                    },
                    [230, 60, 50, 255],
                ),
                (
                    Shape::Circle {
                        c: [160.0, 110.0],
                        r: 60.0,
                    },
                    [40, 120, 220, 255],
                ),
                (
                    Shape::Circle {
                        c: [128.0, 165.0],
                        r: 60.0,
                    },
                    [250, 190, 30, 255],
                ),
            ],
            settings: String::new(),
            ideal: true,
            rgba: fixtures::antialiased_discs().rgba,
        },
    }
}

/// One VTracer stage's geometry for one contour, in absolute coordinates.
#[derive(Default, Clone)]
struct Stages {
    lattice: Vec<P>,
    polygon: Vec<P>,
    smooth: Vec<P>,
    splice: Vec<P>,
    /// Cubic chain [p0, c1, c2, p3].
    beziers: Vec<[P; 4]>,
    /// Polygon vertices VTracer classifies as corners (angle ≥ corner threshold).
    corners: usize,
}

fn pf(p: PointF64) -> P {
    [p.x, p.y]
}

/// Replays `vtracer::fitter::trace_region` + `Cluster::image_to_splines` for one layer mask.
fn replay(mask: &vector_engine::region::Mask, req: &TraceRequest) -> Vec<Stages> {
    let fit = match &req.settings {
        vector_engine::params::Settings::Color(s) => s.fit.clone(),
        vector_engine::params::Settings::Bw(s) => s.fit.clone(),
        _ => unreachable!(),
    };
    let (ct, lt, st) = (
        (fit.corner_threshold as f64).to_radians(),
        fit.length_threshold,
        (fit.splice_threshold as f64).to_radians(),
    );
    let mut img = BinaryImage::new_w_h(mask.w, mask.h);
    for y in 0..mask.h {
        for x in 0..mask.w {
            img.set_pixel(x, y, mask.bits[y * mask.w + x]);
        }
    }
    let mut out = Vec::new();
    for sub in img.to_clusters(false).iter() {
        let (ox, oy) = (mask.x0 as i32 + sub.rect.left, mask.y0 as i32 + sub.rect.top);
        let image = sub.to_binary_image();
        let mut boundaries = vec![(image.clone(), (0, 0))];
        for hole in image.negative().to_clusters(false).iter() {
            if hole.rect.left == 0
                || hole.rect.top == 0
                || hole.rect.right as usize == image.width
                || hole.rect.bottom as usize == image.height
            {
                continue;
            }
            for p in &hole.points {
                boundaries[0].0.set_pixel(p.x as usize, p.y as usize, true);
            }
            boundaries.push((hole.to_binary_image(), (hole.rect.left, hole.rect.top)));
        }
        for (i, (b, (bx, by))) in boundaries.iter().enumerate() {
            let off = [f64::from(ox + bx), f64::from(oy + by)];
            let shift = |v: Vec<P>| -> Vec<P> { v.into_iter().map(|p| [p[0] + off[0], p[1] + off[1]]).collect() };
            let lattice = PathI32::image_to_path(b, i == 0, PathSimplifyMode::None);
            let polygon = PathI32::image_to_path(b, i == 0, PathSimplifyMode::Polygon);
            let corners = SubdivideSmooth::find_corners(&polygon, ct, true)
                .iter()
                .filter(|c| **c)
                .count();
            let smooth = polygon.smooth(ct, 8.0, lt, 10);
            let flags = SubdivideSmooth::find_splice_points(&smooth, st, true);
            let spline = Spline::from_path_f64(&smooth, st);
            let sp: Vec<P> = spline.points.iter().map(|p| pf(*p)).collect();
            let mut beziers = Vec::new();
            let mut k = 1;
            while k + 2 < sp.len() {
                beziers.push([sp[k - 1], sp[k], sp[k + 1], sp[k + 2]]);
                k += 3;
            }
            let sm: Vec<P> = smooth.path.iter().map(|p| pf(*p)).collect();
            out.push(Stages {
                lattice: shift(lattice.path.iter().map(|p| [f64::from(p.x), f64::from(p.y)]).collect()),
                polygon: shift(polygon.path.iter().map(|p| [f64::from(p.x), f64::from(p.y)]).collect()),
                splice: shift(sm.iter().zip(&flags).filter(|(_, f)| **f).map(|(p, _)| *p).collect()),
                smooth: shift(sm),
                beziers: beziers
                    .into_iter()
                    .map(|b| b.map(|p| [p[0] + off[0], p[1] + off[1]]))
                    .collect(),
                corners,
            });
        }
    }
    out
}

fn cubic_at(b: &[P; 4], u: f64) -> P {
    let v = 1.0 - u;
    let w = [v * v * v, 3.0 * u * v * v, 3.0 * u * u * v, u * u * u];
    [
        (0..4).map(|k| w[k] * b[k][0]).sum(),
        (0..4).map(|k| w[k] * b[k][1]).sum(),
    ]
}

fn dense_poly(p: &[P]) -> Vec<P> {
    let mut out = Vec::new();
    for k in 0..p.len() {
        let (a, b) = (p[k], p[(k + 1) % p.len()]);
        let n = ((b[0] - a[0]).hypot(b[1] - a[1]) / 0.1).ceil().max(1.0) as usize;
        for i in 0..n {
            let t = i as f64 / n as f64;
            out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
    }
    out
}

fn dense_bez(bs: &[[P; 4]]) -> Vec<P> {
    bs.iter()
        .flat_map(|b| (0..64).map(move |i| cubic_at(b, i as f64 / 64.0)))
        .collect()
}

/// Signed deviation of stage points from the visible truth. `hidden` filters points that are
/// covered by later layers (pixel-based, from the label map).
fn stage_stats(pts: &[P], truth: &Truth, hidden: &dyn Fn(P) -> bool) -> Stats {
    let v: Vec<f64> = pts
        .iter()
        .filter(|p| !hidden(**p))
        .filter_map(|p| {
            truth.nearest(*p, 3.0).map(|(i, d)| {
                let t = truth.samples[i];
                ((p[0] - t.p[0]) * t.n[0] + (p[1] - t.p[1]) * t.n[1]).signum() * d
            })
        })
        .collect();
    Stats::of(&v)
}

#[derive(Serialize)]
struct LayerInfo {
    index: usize,
    color: String,
    area: usize,
    bbox: [usize; 4],
}

#[derive(Serialize)]
struct StageRow {
    stage: &'static str,
    stats: Stats,
}

#[derive(Serialize)]
struct CaseReport {
    id: String,
    settings: serde_json::Value,
    svg_identical_to_bundle: bool,
    pdf_identical_to_bundle: bool,
    layers: Vec<LayerInfo>,
    partial_pixels: usize,
    /// Antialiased pixels assigned to the layer whose pure colour is farther than the other side's.
    misassigned_blend_pixels: usize,
    replay_matches_scene: bool,
    replay_max_coord_diff: f64,
    stages: Vec<StageRow>,
    anchors: usize,
    anchors_on_integer_lattice: usize,
    splice_joins: usize,
    /// Joins between consecutive cubics whose tangents differ by more than 2°.
    tangent_breaks: usize,
    max_tangent_break_deg: f64,
    /// Cubics whose first control point coincides with the start (degenerate handle).
    degenerate_handles: usize,
    /// Polygon-stage vertices classified as corners on visible boundaries (all circles here,
    /// so any corner away from a true junction is spurious).
    polygon_corners: usize,
    /// Arc length of visible cubic segments: min, max (px).
    segment_length_min: f64,
    segment_length_max: f64,
    /// Largest coordinate change from the 0.01 px quantisation pass.
    quantisation_max: f64,
    report: geometry::Report,
    svg_matches_scene: bool,
    pdf_matches_scene: bool,
}

fn main() {
    let dir = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "docs/research/p0-r-geo/artifacts/reproduction".into());
    std::fs::create_dir_all(&dir).unwrap();
    let bundle = "docs/research/p0-r/owner-acceptance-bundle";
    let mut reports = Vec::new();
    for (id, file) in [
        ("05-color-transparent-hole", "05-color-transparent-hole.svg"),
        ("04-color-discs", "04-color-discs.svg"),
    ] {
        let mut f = case(id);
        let (req, settings_json) = bundle_request(file);
        let bundle_svg = std::fs::read_to_string(format!("{bundle}/{file}")).unwrap();
        // The bundle was traced from the browser's decode: canvas storage is premultiplied, so
        // getImageData returns RGB = round(round(c·a/255)·255/a) for partially transparent pixels.
        let browser: Vec<u8> = f
            .rgba
            .chunks_exact(4)
            .flat_map(|p| {
                let a = u32::from(p[3]);
                let rt = |c: u8| {
                    if a == 0 || a == 255 {
                        return if a == 0 { 0 } else { c };
                    }
                    let pm = (u32::from(c) * a + 127) / 255;
                    ((pm * 255 + a / 2) / a).min(255) as u8
                };
                [rt(p[0]), rt(p[1]), rt(p[2]), p[3]]
            })
            .collect();
        let decoded_as_browser = {
            let o = vector_engine::vectorize(&browser, 256, 256, &req, &|| 0.0).unwrap();
            to_svg(&o.scene).unwrap() == bundle_svg
        };
        println!("{id}: browser-decode model reproduces the bundle SVG: {decoded_as_browser}");
        if decoded_as_browser && browser != f.rgba {
            f.rgba = browser;
        }
        let out = vector_engine::vectorize(&f.rgba, 256, 256, &req, &|| 0.0).unwrap();
        let svg = to_svg(&out.scene).unwrap();
        let pdf = to_pdf(
            &out.scene,
            &PdfOptions {
                width: 200.0,
                unit: Unit::Mm,
                dpi: None,
            },
        )
        .unwrap();
        std::fs::write(format!("{dir}/{id}.svg"), &svg).unwrap();
        std::fs::write(format!("{dir}/{id}.pdf"), &pdf).unwrap();
        std::fs::write(format!("{dir}/{id}.scene.json"), out.scene.to_json()).unwrap();
        let bundle_pdf = std::fs::read(format!("{bundle}/{}", file.replace(".svg", ".pdf"))).unwrap();

        // Segmentation.
        let layers = vector_engine::segment_layers(&f.rgba, 256, 256, &req).unwrap();
        let mut label = vec![usize::MAX; 256 * 256];
        for (k, (_, m)) in layers.iter().enumerate() {
            for y in 0..m.h {
                for x in 0..m.w {
                    if m.bits[y * m.w + x] {
                        label[(m.y0 + y) * 256 + m.x0 + x] = k;
                    }
                }
            }
        }
        let infos: Vec<LayerInfo> = layers
            .iter()
            .enumerate()
            .map(|(k, (c, m))| LayerInfo {
                index: k,
                color: c.hex_rgb(),
                area: m.area(),
                bbox: [m.x0, m.y0, m.x0 + m.w, m.y0 + m.h],
            })
            .collect();
        // Antialiased pixels: inside colour of their topmost layer vs. the analytic colours around.
        let mut partial = 0;
        let mut misassigned = 0;
        for y in 0..256 {
            for x in 0..256 {
                let i = y * 256 + x;
                let px = &f.rgba[i * 4..i * 4 + 4];
                let centre = [x as f64 + 0.5, y as f64 + 0.5];
                let pure = |p: P| f.label_at(p).map_or(f.background, |k| f.layers[k].1);
                let corners: Vec<[u8; 4]> = [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [1.0, 1.0]]
                    .iter()
                    .map(|d| pure([x as f64 + d[0], y as f64 + d[1]]))
                    .collect();
                if corners.iter().all(|c| *c == corners[0]) {
                    continue;
                }
                partial += 1;
                let Some(&(lc, _)) = layers.get(label[i]) else { continue };
                let truth_here = pure(centre);
                // Mis-assigned if the layer colour is closer to a different analytic colour than
                // the one at the pixel centre.
                let d =
                    |a: [u8; 4], b: [u8; 3]| (0..3).map(|k| (i32::from(a[k]) - i32::from(b[k])).pow(2)).sum::<i32>();
                let lcol = [lc.r, lc.g, lc.b];
                let best = corners.iter().min_by_key(|c| d(**c, lcol)).unwrap();
                if *best != truth_here && px[3] > 0 {
                    misassigned += 1;
                }
            }
        }

        // VTracer replay per layer.
        let truth = f.truth(0.05);
        let mut stages: Vec<Vec<Stages>> = Vec::new();
        for (_, m) in &layers {
            stages.push(replay(m, &req));
        }
        // Compare the replayed cubics (rounded to 0.01) with the scene.
        let scene_coords: Vec<f64> = out.scene.groups[0]
            .paths
            .iter()
            .flat_map(|p| p.coords.clone())
            .collect();
        let mut replay_coords = Vec::new();
        for st in &stages {
            for s in st {
                if let Some(b0) = s.beziers.first() {
                    replay_coords.extend_from_slice(&b0[0]);
                }
                for b in &s.beziers {
                    for p in &b[1..] {
                        replay_coords.extend_from_slice(p);
                    }
                }
            }
        }
        let r2 = |v: f64| (v * 100.0).round() / 100.0;
        let mut max_diff: f64 = 0.0;
        let same_len = replay_coords.len() == scene_coords.len();
        if same_len {
            for (a, b) in replay_coords.iter().zip(&scene_coords) {
                max_diff = max_diff.max((r2(*a) - b).abs());
            }
        }

        let hidden_for = |k: usize| {
            let label = &label;
            move |p: P| -> bool {
                let (x, y) = (p[0].floor() as i64, p[1].floor() as i64);
                (-1..=1).all(|dy| {
                    (-1..=1).all(|dx| {
                        let (xx, yy) = (x + dx, y + dy);
                        (0..256).contains(&xx) && (0..256).contains(&yy) && {
                            let l = label[yy as usize * 256 + xx as usize];
                            l != usize::MAX && l > k
                        }
                    })
                })
            }
        };
        let mut rows: Vec<(&'static str, Vec<f64>)> = vec![
            ("1 lattice (pixel crack walk)", vec![]),
            ("2 polygon (staircase removed)", vec![]),
            ("3 smoothed (subdivision, outset 8)", vec![]),
            ("4 fitted cubics (splice ≤45°, tol 10 px)", vec![]),
        ];
        let mut anchors = 0;
        let mut on_lattice = 0;
        let mut joins = 0;
        let mut breaks = 0;
        let mut max_break: f64 = 0.0;
        let mut degenerate = 0;
        let mut poly_corners = 0;
        let (mut seg_min, mut seg_max) = (f64::MAX, 0.0f64);
        let mut quant: f64 = 0.0;
        for (k, st) in stages.iter().enumerate() {
            let hidden = hidden_for(k);
            for s in st {
                for (row, pts) in rows.iter_mut().zip([
                    dense_poly(&s.lattice),
                    dense_poly(&s.polygon),
                    dense_poly(&s.smooth),
                    dense_bez(&s.beziers),
                ]) {
                    let st = stage_stats(&pts, &truth, &hidden);
                    // Re-expand to per-point values for pooling across layers.
                    row.1.extend(pts.iter().filter(|p| !hidden(**p)).filter_map(|p| {
                        truth.nearest(*p, 3.0).map(|(i, d)| {
                            let t = truth.samples[i];
                            ((p[0] - t.p[0]) * t.n[0] + (p[1] - t.p[1]) * t.n[1]).signum() * d
                        })
                    }));
                    let _ = st;
                }
                if s.beziers
                    .iter()
                    .any(|b| !hidden(b[3]) && truth.nearest(b[3], 3.0).is_some())
                {
                    poly_corners += s.corners;
                }
                let n = s.beziers.len();
                for (i, b) in s.beziers.iter().enumerate() {
                    for p in b {
                        quant = quant.max((p[0] - r2(p[0])).abs()).max((p[1] - r2(p[1])).abs());
                    }
                    if hidden(b[3]) || truth.nearest(b[3], 3.0).is_none() {
                        continue;
                    }
                    let len: f64 = (0..32)
                        .map(|j| {
                            let (a, c) = (cubic_at(b, j as f64 / 32.0), cubic_at(b, (j + 1) as f64 / 32.0));
                            (c[0] - a[0]).hypot(c[1] - a[1])
                        })
                        .sum();
                    seg_min = seg_min.min(len);
                    seg_max = seg_max.max(len);
                    anchors += 1;
                    if b[3][0].fract() == 0.0 && b[3][1].fract() == 0.0 {
                        on_lattice += 1;
                    }
                    if (b[1][0] - b[0][0]).hypot(b[1][1] - b[0][1]) < 1e-6 {
                        degenerate += 1;
                    }
                    let nb = &s.beziers[(i + 1) % n];
                    let tin = [b[3][0] - b[2][0], b[3][1] - b[2][1]];
                    let tout = [nb[1][0] - nb[0][0], nb[1][1] - nb[0][1]];
                    if tin[0].hypot(tin[1]) < 1e-9 || tout[0].hypot(tout[1]) < 1e-9 {
                        continue;
                    }
                    joins += 1;
                    let ang = (tin[0] * tout[1] - tin[1] * tout[0])
                        .atan2(tin[0] * tout[0] + tin[1] * tout[1])
                        .abs()
                        .to_degrees();
                    // Only joins away from true corners count as unintended.
                    if truth
                        .corners
                        .iter()
                        .all(|c| (c.0[0] - b[3][0]).hypot(c.0[1] - b[3][1]) > 2.0)
                    {
                        max_break = max_break.max(ang);
                        if ang > 2.0 {
                            breaks += 1;
                        }
                    }
                }
            }
        }
        let stage_rows: Vec<StageRow> = rows
            .into_iter()
            .map(|(stage, v)| StageRow {
                stage,
                stats: Stats::of(&v),
            })
            .collect();

        let report = geometry::evaluate(&truth, &out.scene, 256, 256);
        let svg_ok = exports::svg_coords(&svg)
            == out.scene.groups[0]
                .paths
                .iter()
                .flat_map(|p| p.coords.clone())
                .collect::<Vec<_>>();
        let pdf_ok = exports::pdf_matches(&pdf, &out.scene);

        overlays(&dir, id, &f, &truth, &stages, &out.scene);

        reports.push(CaseReport {
            id: id.into(),
            settings: serde_json::from_str(&settings_json).unwrap(),
            svg_identical_to_bundle: svg == bundle_svg,
            pdf_identical_to_bundle: pdf == bundle_pdf,
            layers: infos,
            partial_pixels: partial,
            misassigned_blend_pixels: misassigned,
            replay_matches_scene: same_len && max_diff < 0.006,
            replay_max_coord_diff: max_diff,
            stages: stage_rows,
            anchors,
            anchors_on_integer_lattice: on_lattice,
            splice_joins: joins,
            tangent_breaks: breaks,
            max_tangent_break_deg: max_break,
            degenerate_handles: degenerate,
            polygon_corners: poly_corners,
            segment_length_min: seg_min,
            segment_length_max: seg_max,
            quantisation_max: quant,
            report,
            svg_matches_scene: svg_ok,
            pdf_matches_scene: pdf_ok,
        });
    }
    let json = serde_json::to_string_pretty(&reports).unwrap();
    std::fs::write(format!("{dir}/reproduction.json"), &json).unwrap();
    for r in &reports {
        println!("\n## {}", r.id);
        println!(
            "bundle SVG identical: {} · bundle PDF identical: {} · replay == scene: {} (max diff {:.4}) · SVG coords == scene: {} · PDF coords == scene: {}",
            r.svg_identical_to_bundle,
            r.pdf_identical_to_bundle,
            r.replay_matches_scene,
            r.replay_max_coord_diff,
            r.svg_matches_scene,
            r.pdf_matches_scene
        );
        println!(
            "layers: {}",
            r.layers
                .iter()
                .map(|l| format!("{}({} px)", l.color, l.area))
                .collect::<Vec<_>>()
                .join(", ")
        );
        println!(
            "partial pixels {} · misassigned {}",
            r.partial_pixels, r.misassigned_blend_pixels
        );
        println!("| Stage | n | mean | RMS | max | bias |\n|---|---|---|---|---|---|");
        for s in &r.stages {
            println!(
                "| {} | {} | {:.3} | {:.3} | {:.3} | {:+.3} |",
                s.stage, s.stats.n, s.stats.mean_abs, s.stats.rms, s.stats.max_abs, s.stats.bias
            );
        }
        println!(
            "anchors {} (on integer lattice {}), joins {}, tangent breaks >2° {} (max {:.1}°), degenerate handles {}",
            r.anchors,
            r.anchors_on_integer_lattice,
            r.splice_joins,
            r.tangent_breaks,
            r.max_tangent_break_deg,
            r.degenerate_handles
        );
        println!(
            "polygon-stage corners on visible contours {} · visible segment length {:.1}–{:.1} px · quantisation max {:.4} px",
            r.polygon_corners, r.segment_length_min, r.segment_length_max, r.quantisation_max
        );
        for c in &r.report.circles {
            println!(
                "circle c=({:.0},{:.0}) r={:.0} visible {:.2}: centre err {:.3}, radius err {:+.3}, radial RMS {:.3} max {:.3} bias {:+.3}, κr-1 RMS {:.3} max {:.3}",
                c.true_center[0],
                c.true_center[1],
                c.true_radius,
                c.visible_fraction,
                c.center_error,
                c.radius_error,
                c.radial.rms,
                c.radial.max_abs,
                c.radial.bias,
                c.curvature.rms,
                c.curvature.max_abs
            );
        }
        println!(
            "contour: mean {:.3} RMS {:.3} max {:.3} bias {:+.3}; missing max {:.3}; smooth joins {} breaks {} max {:.1}°; corners {}/{} found, pos mean {:.2} max {:.2}",
            r.report.contour.mean_abs,
            r.report.contour.rms,
            r.report.contour.max_abs,
            r.report.contour.bias,
            r.report.missing.max_abs,
            r.report.smooth_joins,
            r.report.smooth_join_breaks,
            r.report.max_smooth_join_angle_deg,
            r.report.corners_found,
            r.report.true_corners,
            r.report.corner_position.mean_abs,
            r.report.corner_position.max_abs
        );
    }
}

// ---------------------------------------------------------------------------------------------
// Overlays

fn write_png(path: &str, pm: &sk::Pixmap) {
    let file = std::fs::File::create(path).unwrap();
    let mut enc = png::Encoder::new(std::io::BufWriter::new(file), pm.width(), pm.height());
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    let data: Vec<u8> = pm
        .pixels()
        .iter()
        .flat_map(|p| {
            let c = p.demultiply();
            [c.red(), c.green(), c.blue(), c.alpha()]
        })
        .collect();
    enc.write_header().unwrap().write_image_data(&data).unwrap();
}

fn paint(r: u8, g: u8, b: u8, a: u8) -> sk::Paint<'static> {
    let mut p = sk::Paint::default();
    p.set_color_rgba8(r, g, b, a);
    p.anti_alias = true;
    p
}

fn polyline(pm: &mut sk::Pixmap, pts: &[P], closed: bool, t: sk::Transform, col: sk::Paint, width: f32) {
    if pts.len() < 2 {
        return;
    }
    let mut pb = sk::PathBuilder::new();
    pb.move_to(pts[0][0] as f32, pts[0][1] as f32);
    for p in &pts[1..] {
        pb.line_to(p[0] as f32, p[1] as f32);
    }
    if closed {
        pb.close();
    }
    if let Some(path) = pb.finish() {
        let stroke = sk::Stroke {
            width: width / t.sx,
            ..Default::default()
        };
        pm.stroke_path(&path, &col, &stroke, t, None);
    }
}

fn dot_at(pm: &mut sk::Pixmap, p: P, t: sk::Transform, col: sk::Paint, size: f32, square: bool) {
    let s = size / t.sx;
    let path = if square {
        sk::PathBuilder::from_rect(sk::Rect::from_xywh(p[0] as f32 - s / 2.0, p[1] as f32 - s / 2.0, s, s).unwrap())
    } else {
        sk::PathBuilder::from_circle(p[0] as f32, p[1] as f32, s / 2.0).unwrap()
    };
    pm.fill_path(&path, &col, sk::FillRule::Winding, t, None);
}

/// Crop [x0, y0, size] at `zoom`: source pixels (on a checkerboard), true boundary (green),
/// lattice (grey), smoothed polygon (cyan), splice points (magenta), fitted path (red),
/// anchors (blue squares) and handles (orange).
fn overlay(path: &str, f: &GeoFixture, truth: &Truth, stages: &[Vec<Stages>], crop: [f64; 3], zoom: f32) {
    let px = (crop[2] * zoom as f64) as u32;
    let mut pm = sk::Pixmap::new(px, px).unwrap();
    let t = sk::Transform::from_scale(zoom, zoom).pre_translate(-crop[0] as f32, -crop[1] as f32);
    for y in crop[1] as usize..(crop[1] + crop[2]) as usize {
        for x in crop[0] as usize..(crop[0] + crop[2]) as usize {
            if x >= f.w || y >= f.h {
                continue;
            }
            let c = &f.rgba[(y * f.w + x) * 4..(y * f.w + x) * 4 + 4];
            let checker = if (x + y) % 2 == 0 { 235u8 } else { 205 };
            let a = u32::from(c[3]);
            let mix = |v: u8| ((u32::from(v) * a + u32::from(checker) * (255 - a)) / 255) as u8;
            let rect = sk::Rect::from_xywh(x as f32, y as f32, 1.0, 1.0).unwrap();
            pm.fill_rect(rect, &paint(mix(c[0]), mix(c[1]), mix(c[2]), 255), t, None);
        }
    }
    // Pixel grid.
    let mut grid = sk::PathBuilder::new();
    for k in 0..=crop[2] as i32 {
        let v = (crop[0] as i32 + k) as f32;
        grid.move_to(v, crop[1] as f32);
        grid.line_to(v, (crop[1] + crop[2]) as f32);
        let v = (crop[1] as i32 + k) as f32;
        grid.move_to(crop[0] as f32, v);
        grid.line_to((crop[0] + crop[2]) as f32, v);
    }
    if let Some(g) = grid.finish() {
        let s = sk::Stroke {
            width: 0.5 / zoom,
            ..Default::default()
        };
        pm.stroke_path(&g, &paint(0, 0, 0, 40), &s, t, None);
    }
    for s in &truth.samples {
        dot_at(&mut pm, s.p, t, paint(0, 170, 0, 255), 2.0, false);
    }
    for st in stages {
        for s in st {
            polyline(&mut pm, &s.lattice, true, t, paint(90, 90, 90, 200), 1.0);
            polyline(&mut pm, &s.smooth, true, t, paint(0, 190, 200, 230), 1.5);
            let bez: Vec<P> = s
                .beziers
                .iter()
                .flat_map(|b| (0..32).map(move |i| cubic_at(b, i as f64 / 32.0)))
                .collect();
            polyline(&mut pm, &bez, true, t, paint(220, 20, 20, 255), 2.5);
            for b in &s.beziers {
                polyline(&mut pm, &[b[0], b[1]], false, t, paint(255, 140, 0, 255), 1.5);
                polyline(&mut pm, &[b[3], b[2]], false, t, paint(255, 140, 0, 255), 1.5);
                dot_at(&mut pm, b[1], t, paint(255, 140, 0, 255), 6.0, false);
                dot_at(&mut pm, b[2], t, paint(255, 140, 0, 255), 6.0, false);
                dot_at(&mut pm, b[3], t, paint(20, 60, 230, 255), 9.0, true);
            }
            for p in &s.splice {
                dot_at(&mut pm, *p, t, paint(200, 0, 200, 255), 5.0, false);
            }
        }
    }
    write_png(path, &pm);
}

fn overlays(dir: &str, id: &str, f: &GeoFixture, truth: &Truth, stages: &[Vec<Stages>], _scene: &Scene) {
    if id.starts_with("05") {
        overlay(
            &format!("{dir}/{id}-hole-16x.png"),
            f,
            truth,
            stages,
            [104.0, 76.0, 48.0],
            16.0,
        );
    } else {
        overlay(
            &format!("{dir}/{id}-full-4x.png"),
            f,
            truth,
            stages,
            [0.0, 0.0, 256.0],
            4.0,
        );
        // Top intersection of red/blue, red's left edge, and the yellow/blue junction.
        overlay(
            &format!("{dir}/{id}-junction-top-16x.png"),
            f,
            truth,
            stages,
            [108.0, 44.0, 40.0],
            16.0,
        );
        overlay(
            &format!("{dir}/{id}-red-left-16x.png"),
            f,
            truth,
            stages,
            [30.0, 90.0, 40.0],
            16.0,
        );
        overlay(
            &format!("{dir}/{id}-lower-junctions-16x.png"),
            f,
            truth,
            stages,
            [150.0, 140.0, 48.0],
            16.0,
        );
    }
}
