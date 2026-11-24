//! P0-R-GEO inspection helpers for the selected configuration.
//! - `arcs`: counts recognised circle/arc substitutions per fixture (negative controls must
//!   have none).
//! - `curvature <fixture> <out-dir>`: classifies every output sample that breaks the curvature
//!   uniformity target (|κ|·r − 1 > 0.5, away from corners): its path, whether a higher path's
//!   outline lies within 0.5 px, and the saturated-crossing run at the nearest refined point;
//!   renders the filled output at 24× around the three worst samples.
//! - `small`: 1 px blob, 2×2 blob and 1 px hole with speckle 0 (B&W and colour): loops in vs
//!   loops out.
//!
//! Usage: cargo run --release -p vector-engine --example geo_inspect -- <mode> [args]
#[path = "../tests/common/corpus.rs"]
mod corpus;
#[path = "../tests/common/fixtures.rs"]
mod fixtures;
#[path = "../tests/common/geometry.rs"]
mod geometry;
#[path = "../tests/common/render.rs"]
mod render;

use vector_engine::color::Luma;
use vector_engine::image::RgbaImage;
use vector_engine::params::TraceRequest;
use vector_engine::precision::{self, EdgePolicy, Field, Options};

fn request(f: &geometry::GeoFixture) -> TraceRequest {
    TraceRequest::from_json(&format!(r#"{{"presetVersion":1,"seed":1,"settings":{}}}"#, f.settings)).unwrap()
}

fn policy(f: &geometry::GeoFixture) -> EdgePolicy {
    if f.settings.contains("\"bw\"") {
        EdgePolicy::Luma {
            threshold: 128,
            invert: false,
            alpha_threshold: 128,
        }
    } else {
        EdgePolicy::Color { alpha_threshold: 128 }
    }
}

fn selected(arcs: bool) -> Options {
    Options {
        arcs,
        ..Options::production(60)
    }
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    match a.get(1).map(String::as_str) {
        Some("arcs") => {
            let luma = Luma::new();
            println!("| Fixture | Set | Loops | Recognised sections |\n|---|---|---|---|");
            for f in corpus::all().into_iter().chain(corpus::rejected()) {
                let layers = vector_engine::segment_layers(&f.rgba, f.w as u32, f.h as u32, &request(&f)).unwrap();
                let img = RgbaImage::new(&f.rgba, f.w as u32, f.h as u32, 1 << 26).unwrap();
                let o = selected(true);
                let field = Field::new(img, &luma, policy(&f), o.subpixel, layers.iter().map(|l| l.1.clone()));
                let (mut loops, mut rec) = (0, 0);
                for (_, m) in &layers {
                    for c in precision::contours(&field, m) {
                        if let Some(l) = precision::fit_contour(&c, &o) {
                            loops += 1;
                            rec += l.recognised;
                        }
                    }
                }
                println!("| {} | {} | {loops} | {rec} |", f.id, f.set);
            }
        }
        Some("curvature") => {
            let f = corpus::all()
                .into_iter()
                .chain(corpus::rejected())
                .find(|f| f.id == a[2])
                .unwrap();
            let dir = &a[3];
            std::fs::create_dir_all(dir).unwrap();
            let arcs = a.get(4).is_some_and(|v| v == "arcs");
            let out = vector_engine::vectorize_with_precision_options(
                &f.rgba,
                f.w as u32,
                f.h as u32,
                &request(&f),
                &|| 0.0,
                selected(arcs),
            )
            .unwrap();
            let truth = f.truth(0.05);
            let s = geometry::sample_scene(&out.scene, 0.1);
            // Saturated-run length per refined point, by layer (paths map 1:1 to layers here).
            let luma = Luma::new();
            let layers = vector_engine::segment_layers(&f.rgba, f.w as u32, f.h as u32, &request(&f)).unwrap();
            let img = RgbaImage::new(&f.rgba, f.w as u32, f.h as u32, 1 << 26).unwrap();
            let field = Field::new(
                img,
                &luma,
                policy(&f),
                selected(arcs).subpixel,
                layers.iter().map(|l| l.1.clone()),
            );
            let mut refined: Vec<Vec<([f64; 2], usize)>> = Vec::new();
            for (_, m) in &layers {
                let mut v = Vec::new();
                for c in precision::contours(&field, m) {
                    let n = c.points.len();
                    for i in 0..n {
                        let mut run = 0;
                        if c.saturated[i] {
                            let (mut lo, mut hi) = (i, i);
                            while c.saturated[(lo + n - 1) % n] && run < n {
                                lo = (lo + n - 1) % n;
                                run += 1;
                            }
                            run += 1;
                            while c.saturated[(hi + 1) % n] && run < n {
                                hi = (hi + 1) % n;
                                run += 1;
                            }
                        }
                        v.push((c.points[i], run));
                    }
                }
                refined.push(v);
            }
            let paths = s.polys.iter().map(|p| p.0).max().map_or(0, |m| m + 1);
            println!("{} paths, {} layers", paths, layers.len());
            let mut flagged = Vec::new();
            for o in &s.samples {
                let Some((i, _)) = truth.nearest(o.p, 3.0) else {
                    continue;
                };
                let geometry::Prim::Circle { r, .. } = truth.prims[truth.samples[i].prim] else {
                    continue;
                };
                if truth
                    .corners
                    .iter()
                    .any(|c| (c.0[0] - o.p[0]).hypot(c.0[1] - o.p[1]) < 2.0)
                {
                    continue;
                }
                let dev = o.kappa.abs() * r - 1.0;
                if dev.abs() <= 0.5 {
                    continue;
                }
                let higher_near = s
                    .polys
                    .iter()
                    .filter(|(pi, _)| *pi > o.path)
                    .any(|(_, poly)| poly.iter().any(|q| (q[0] - o.p[0]).hypot(q[1] - o.p[1]) < 0.5));
                let run = refined
                    .get(o.path)
                    .and_then(|v| {
                        v.iter().min_by(|x, y| {
                            let dx = (x.0[0] - o.p[0]).hypot(x.0[1] - o.p[1]);
                            let dy = (y.0[0] - o.p[0]).hypot(y.0[1] - o.p[1]);
                            dx.total_cmp(&dy)
                        })
                    })
                    .map_or(0, |x| x.1);
                flagged.push((dev, o.p, o.path, higher_near, run));
            }
            let total = flagged.len();
            let lower_dup = flagged.iter().filter(|x| x.3).count();
            let long_runs = flagged.iter().filter(|x| !x.3 && x.4 > 3).count();
            let short_runs = flagged.iter().filter(|x| !x.3 && (1..=3).contains(&x.4)).count();
            let other = total - lower_dup - long_runs - short_runs;
            println!(
                "{} flagged samples: under a higher outline (lower-layer duplicate) {lower_dup}; top path at saturated run > 3: {long_runs}; top path at run 1–3: {short_runs}; top path, no saturation: {other}",
                total
            );
            flagged.sort_by(|x, y| y.0.abs().total_cmp(&x.0.abs()));
            let svg = vector_engine::svg::to_svg(&out.scene).unwrap();
            let mut shown: Vec<[f64; 2]> = Vec::new();
            for (dev, p, path, hn, run) in &flagged {
                if shown.iter().any(|q| (q[0] - p[0]).hypot(q[1] - p[1]) < 6.0) || shown.len() == 3 {
                    continue;
                }
                println!(
                    "worst: |κ|r-1={dev:+.2} at ({:.2},{:.2}) path {path} under-higher {hn} saturated-run {run}",
                    p[0], p[1]
                );
                let crop = [p[0] - 6.0, p[1] - 6.0, 12.0, 12.0];
                let mut fill = render::rendered(&svg, &f, crop, 24.0);
                let t =
                    resvg::tiny_skia::Transform::from_scale(24.0, 24.0).pre_translate(-crop[0] as f32, -crop[1] as f32);
                render::truth_overlay(&mut fill, t, &truth);
                render::scene_overlay(&mut fill, t, &out.scene, true);
                render::write_png(&format!("{dir}/{}-curvature-{}.png", f.id, shown.len() + 1), &fill);
                shown.push(*p);
            }
        }
        Some("small") => {
            let w = 16usize;
            let mut cases: Vec<(&str, Vec<bool>)> = Vec::new();
            let mut blob1 = vec![false; w * w];
            blob1[8 * w + 8] = true;
            cases.push(("1 px blob", blob1));
            let mut blob2 = vec![false; w * w];
            for (x, y) in [(7, 7), (8, 7), (7, 8), (8, 8)] {
                blob2[y * w + x] = true;
            }
            cases.push(("2x2 blob", blob2));
            let mut hole = vec![false; w * w];
            for y in 4..12 {
                for x in 4..12 {
                    hole[y * w + x] = !(x == 8 && y == 8);
                }
            }
            cases.push(("1 px hole in 8x8", hole));
            for (name, ink) in cases {
                for mode in ["bw", "color"] {
                    let rgba: Vec<u8> = ink
                        .iter()
                        .flat_map(|&b| if b { [0, 0, 0, 255] } else { [255, 255, 255, 255] })
                        .collect();
                    let req = TraceRequest::from_json(&format!(
                        r#"{{"presetVersion":1,"settings":{{"mode":"{mode}","speckle":0}}}}"#
                    ))
                    .unwrap();
                    let spline = vector_engine::vectorize(&rgba, w as u32, w as u32, &req, &|| 0.0).unwrap();
                    let prec = vector_engine::vectorize_with_precision_options(
                        &rgba,
                        w as u32,
                        w as u32,
                        &req,
                        &|| 0.0,
                        selected(true),
                    )
                    .unwrap();
                    let loops = |sc: &vector_engine::scene::Scene| {
                        sc.groups[0]
                            .paths
                            .iter()
                            .map(|p| p.verbs.matches('M').count())
                            .sum::<usize>()
                    };
                    println!(
                        "{name:<18} {mode:<5} spline loops {} · precision loops {} · precision anchors {}",
                        loops(&spline.scene),
                        loops(&prec.scene),
                        prec.metrics.stats.anchors
                    );
                }
            }
        }
        Some("leak") => {
            // P0-R residual-leak definition: transparent truth pixels (coverage < 0.5) rendered
            // with alpha ≥ 128 at 1×, and their distance from the true alpha edge.
            for (fx, inside) in [
                (
                    fixtures::transparent_ring(),
                    Box::new(fixtures::ring(128.0, 128.0, 60.0, 100.0)) as Box<dyn Fn(f64, f64) -> bool>,
                ),
                (
                    fixtures::logo_transparent_hole(),
                    Box::new({
                        let hole = fixtures::disc(128.0, 100.0, 20.0);
                        move |x: f64, y: f64| !hole(x, y)
                    }),
                ),
            ] {
                for (name, settings) in [
                    ("spline", r#"{"mode":"color"}"#),
                    ("precision", r#"{"mode":"color","fit":{"mode":"precision"}}"#),
                ] {
                    let req =
                        TraceRequest::from_json(&format!(r#"{{"presetVersion":1,"settings":{settings}}}"#)).unwrap();
                    let out = vector_engine::vectorize(&fx.rgba, 256, 256, &req, &|| 0.0).unwrap();
                    let svg = vector_engine::svg::to_svg(&out.scene).unwrap();
                    let tree = resvg::usvg::Tree::from_str(&svg, &resvg::usvg::Options::default()).unwrap();
                    let mut pm = resvg::tiny_skia::Pixmap::new(256, 256).unwrap();
                    resvg::render(&tree, resvg::tiny_skia::Transform::identity(), &mut pm.as_mut());
                    let (mut leaked, mut transparent, mut max_d) = (0usize, 0usize, 0.0f64);
                    for y in 0..256 {
                        for x in 0..256 {
                            let i = y * 256 + x;
                            if !fx.truth[i] {
                                transparent += 1;
                                if pm.data()[i * 4 + 3] >= 128 {
                                    leaked += 1;
                                    let (cx, cy) = (x as f64 + 0.5, y as f64 + 0.5);
                                    let here = inside(cx, cy);
                                    let mut best = f64::INFINITY;
                                    for r in 1..=64 {
                                        let rad = r as f64 / 16.0;
                                        for k in 0..64 {
                                            let a = k as f64 * std::f64::consts::TAU / 64.0;
                                            if inside(cx + rad * a.cos(), cy + rad * a.sin()) != here {
                                                best = best.min(rad);
                                            }
                                        }
                                        if best.is_finite() {
                                            break;
                                        }
                                    }
                                    max_d = max_d.max(best);
                                }
                            }
                        }
                    }
                    println!(
                        "{:<22} {name:<9} leak={:.4} ({leaked}/{transparent} px) max_leak_distance_px={max_d:.2}",
                        fx.id,
                        leaked as f64 / transparent as f64
                    );
                }
            }
        }
        Some("specks") => {
            // Every output component that is not its colour's largest (truth: one per colour),
            // rendered over the source background at `scale`×.
            let f = corpus::all()
                .into_iter()
                .chain(corpus::rejected())
                .find(|f| f.id == a[2])
                .unwrap();
            let scale: usize = a[3].parse().unwrap();
            let mut settings: serde_json::Value = serde_json::from_str(&f.settings).unwrap();
            settings["fit"] = serde_json::json!({"mode": "precision"});
            let req = TraceRequest::from_json(
                &serde_json::json!({"presetVersion": 1, "seed": 1, "settings": settings}).to_string(),
            )
            .unwrap();
            let out = vector_engine::vectorize(&f.rgba, f.w as u32, f.h as u32, &req, &|| 0.0).unwrap();
            let svg = vector_engine::svg::to_svg(&out.scene).unwrap();
            let pm = render::rendered(&svg, &f, [0.0, 0.0, f.w as f64, f.h as f64], scale as f32);
            let (w, h) = (pm.width() as usize, pm.height() as usize);
            let mut palette: Vec<[u8; 4]> = vec![f.background];
            for (_, c) in &f.layers {
                palette.push(*c);
            }
            let lab: Vec<usize> = pm
                .pixels()
                .iter()
                .map(|p| {
                    let c = p.demultiply();
                    (0..palette.len())
                        .min_by_key(|&k| {
                            (0..3)
                                .map(|j| {
                                    (i32::from([c.red(), c.green(), c.blue()][j]) - i32::from(palette[k][j])).pow(2)
                                })
                                .sum::<i32>()
                        })
                        .unwrap()
                })
                .collect();
            let mut seen = vec![false; w * h];
            let mut comps: Vec<(usize, usize, [usize; 4])> = Vec::new();
            for s0 in 0..w * h {
                if seen[s0] {
                    continue;
                }
                let l = lab[s0];
                let (mut n, mut bb) = (0, [usize::MAX, usize::MAX, 0, 0]);
                let mut stack = vec![s0];
                seen[s0] = true;
                while let Some(i) = stack.pop() {
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
                        if !seen[j] && lab[j] == l {
                            seen[j] = true;
                            stack.push(j);
                        }
                    }
                }
                comps.push((l, n, bb));
            }
            for (k, c) in palette.iter().enumerate() {
                let mut mine: Vec<_> = comps.iter().filter(|x| x.0 == k).collect();
                mine.sort_by_key(|x| std::cmp::Reverse(x.1));
                for x in mine.iter().skip(1) {
                    let b = x.2;
                    println!(
                        "{} {scale}x: extra component of #{:02x}{:02x}{:02x}: {} samples = {:.2} source px², bbox ({:.1},{:.1})–({:.1},{:.1}) source px",
                        f.id,
                        c[0],
                        c[1],
                        c[2],
                        x.1,
                        x.1 as f64 / (scale * scale) as f64,
                        b[0] as f64 / scale as f64,
                        b[1] as f64 / scale as f64,
                        (b[2] + 1) as f64 / scale as f64,
                        (b[3] + 1) as f64 / scale as f64
                    );
                }
            }
        }
        Some("diagonals") => {
            // P0-R thin-stroke probe: pixels of the 1-px diagonal (x, x+10), x in 180..236, rendered as ink.
            let f = fixtures::thin_strokes();
            let diag_truth = (180..236).filter(|&x| f.truth[(x + 10) * f.width + x]).count();
            for settings in [
                r#"{"mode":"bw"}"#,
                r#"{"mode":"bw","speckle":0}"#,
                r#"{"mode":"bw","speckle":0,"fit":{"mode":"pixel"}}"#,
                r#"{"mode":"bw","fit":{"mode":"precision"}}"#,
                r#"{"mode":"bw","speckle":0,"fit":{"mode":"precision"}}"#,
            ] {
                let req = TraceRequest::from_json(&format!(r#"{{"presetVersion":1,"settings":{settings}}}"#)).unwrap();
                let out = vector_engine::vectorize(&f.rgba, f.width as u32, f.height as u32, &req, &|| 0.0).unwrap();
                let svg = vector_engine::svg::to_svg(&out.scene).unwrap();
                let tree = resvg::usvg::Tree::from_str(&svg, &resvg::usvg::Options::default()).unwrap();
                let mut pm = resvg::tiny_skia::Pixmap::new(f.width as u32, f.height as u32).unwrap();
                resvg::render(&tree, resvg::tiny_skia::Transform::identity(), &mut pm.as_mut());
                let hit = (180..236)
                    .filter(|&x| {
                        let p = &pm.data()[((x + 10) * f.width + x) * 4..((x + 10) * f.width + x) * 4 + 4];
                        p[3] >= 128 && u32::from(p[0]) * 2 < u32::from(p[3])
                    })
                    .count();
                println!(
                    "{settings:<56} paths={} diagonal_truth_px={diag_truth} diagonal_rendered_px={hit}",
                    out.metrics.stats.paths
                );
            }
        }
        _ => eprintln!(
            "usage: geo_inspect arcs | curvature <fixture> <dir> [arcs] | small | leak | specks <fixture> <scale> | diagonals"
        ),
    }
}
