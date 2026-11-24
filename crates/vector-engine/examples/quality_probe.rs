//! P0-R-G1 geometry quality probe. For the synthetic shapes it reports:
//! - `iou_px`: the P0 metric — render at 1×, compare with the pixel mask (coverage ≥ 0.5);
//! - `iou_4x`: render at 4× and compare with the *analytic* shape sampled at 4×;
//! - `max_dev_px`: largest distance (source px) from a mismatched 4× sample to the true edge;
//! - for the diagonal-stroke and transparency fixtures, whether the feature survives and how
//!   far leaked pixels lie from the true boundary.
//!
//! Usage: cargo run --release -p vector-engine --example quality_probe
#[path = "../tests/common/fixtures.rs"]
mod fixtures;

use vector_engine::params::TraceRequest;
use vector_engine::svg::to_svg;

fn trace(f: &fixtures::Fixture, settings: &str) -> vector_engine::Output {
    let req = TraceRequest::from_json(&format!(r#"{{"presetVersion":1,"settings":{settings}}}"#)).unwrap();
    vector_engine::vectorize(&f.rgba, f.width as u32, f.height as u32, &req, &|| 0.0).unwrap()
}

/// Renders an SVG at `scale` and returns per-pixel alpha (0..255) and luminance-darkness.
fn render(svg: &str, w: usize, h: usize, scale: usize) -> Vec<(u8, u8)> {
    let tree = resvg::usvg::Tree::from_str(svg, &resvg::usvg::Options::default()).unwrap();
    let mut pm = resvg::tiny_skia::Pixmap::new((w * scale) as u32, (h * scale) as u32).unwrap();
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(scale as f32, scale as f32),
        &mut pm.as_mut(),
    );
    pm.data().chunks_exact(4).map(|p| (p[3], p[0])).collect()
}

fn ink(p: (u8, u8)) -> bool {
    p.0 >= 128 && u32::from(p.1) * 2 < u32::from(p.0)
}

/// Distance from (x, y) to the nearest point where `inside` changes, by sampling a disc of radius ≤ 4 px.
fn edge_distance(x: f64, y: f64, inside: &dyn Fn(f64, f64) -> bool) -> f64 {
    let here = inside(x, y);
    let mut best = f64::INFINITY;
    for r in 1..=64 {
        let rad = r as f64 / 16.0;
        for k in 0..32 {
            let a = k as f64 * std::f64::consts::TAU / 32.0;
            if inside(x + rad * a.cos(), y + rad * a.sin()) != here {
                best = best.min(rad);
            }
        }
        if best.is_finite() {
            break;
        }
    }
    best
}

fn shape_metrics(name: &str, f: &fixtures::Fixture, inside: &dyn Fn(f64, f64) -> bool, settings: &str) {
    let out = trace(f, settings);
    let svg = to_svg(&out.scene).unwrap();
    let px = render(&svg, f.width, f.height, 1);
    let (mut i1, mut u1) = (0, 0);
    for (p, t) in px.iter().zip(&f.truth) {
        i1 += usize::from(ink(*p) && *t);
        u1 += usize::from(ink(*p) || *t);
    }
    let s = 4;
    let hi = render(&svg, f.width, f.height, s);
    let (mut i4, mut u4, mut max_dev, mut over, mut under) = (0usize, 0usize, 0.0f64, 0usize, 0usize);
    for y in 0..f.height * s {
        for x in 0..f.width * s {
            let (sx, sy) = ((x as f64 + 0.5) / s as f64, (y as f64 + 0.5) / s as f64);
            let t = inside(sx, sy);
            let v = ink(hi[y * f.width * s + x]);
            i4 += usize::from(v && t);
            u4 += usize::from(v || t);
            if v != t {
                max_dev = max_dev.max(edge_distance(sx, sy, inside));
                if v { over += 1 } else { under += 1 }
            }
        }
    }
    println!(
        "{name:<14} {settings:<58} iou_px={:.4} iou_4x={:.4} max_dev_px={:.2} over/under={:.2} anchors={}",
        i1 as f64 / u1 as f64,
        i4 as f64 / u4 as f64,
        max_dev,
        over as f64 / under.max(1) as f64,
        out.metrics.stats.anchors
    );
}

fn main() {
    let c = 128.0;
    let star_pts: Vec<(f64, f64)> = (0..10)
        .map(|i| {
            let r = if i % 2 == 0 { 110.0 } else { 40.0 };
            let a = std::f64::consts::PI * (i as f64) / 5.0 - std::f64::consts::FRAC_PI_2;
            (c + r * a.cos(), c + r * a.sin())
        })
        .collect();
    let star = fixtures::polygon(star_pts);
    let rings = {
        let (a, b, d) = (
            fixtures::ring(c, c, 90.0, 110.0),
            fixtures::ring(c, c, 50.0, 70.0),
            fixtures::disc(c, c, 30.0),
        );
        move |x: f64, y: f64| a(x, y) || b(x, y) || d(x, y)
    };
    let circle = fixtures::disc(c, c, 80.0);
    println!("# Shape accuracy: P0 pixel-mask IoU vs analytic 4x IoU");
    for settings in [
        r#"{"mode":"bw"}"#,
        r#"{"mode":"bw","fit":{"cornerThreshold":30}}"#,
        r#"{"mode":"bw","fit":{"lengthThreshold":2}}"#,
        r#"{"mode":"bw","fit":{"mode":"polygon"}}"#,
        r#"{"mode":"bw","fit":{"mode":"pixel"}}"#,
    ] {
        shape_metrics("circle", &fixtures::circle(), &circle, settings);
        shape_metrics("sharp_corners", &fixtures::sharp_corners(), &star, settings);
        shape_metrics("nested_rings", &fixtures::nested_rings(), &rings, settings);
    }

    println!("\n# Thin strokes: which of the 9 strokes produce geometry");
    let f = fixtures::thin_strokes();
    for settings in [
        r#"{"mode":"bw"}"#,
        r#"{"mode":"bw","speckle":0}"#,
        r#"{"mode":"bw","speckle":0,"fit":{"mode":"pixel"}}"#,
    ] {
        let out = trace(&f, settings);
        let svg = to_svg(&out.scene).unwrap();
        let px = render(&svg, f.width, f.height, 1);
        // The diagonal occupies x in 180..236 along y = x + 10.
        let diag_truth = (180..236).filter(|&x| f.truth[(x + 10) * f.width + x]).count();
        let diag_hit = (180..236).filter(|&x| ink(px[(x + 10) * f.width + x])).count();
        println!(
            "{settings:<52} paths={} diagonal_truth_px={diag_truth} diagonal_rendered_px={diag_hit}",
            out.metrics.stats.paths
        );
    }
    let diag: Vec<usize> = (180..236).filter(|&x| f.truth[(x + 10) * f.width + x]).collect();
    let four_connected = diag.windows(2).all(|w| {
        let (x0, x1) = (w[0], w[1]);
        // consecutive diagonal pixels (x, x+10) and (x+1, x+11) share only a corner
        !(f.truth[(x0 + 10) * f.width + x1] || f.truth[(x1 + 10) * f.width + x0])
    });
    println!("diagonal truth pixels touch only at corners (8-connected only): {four_connected}");

    println!("\n# Transparency: distance of leaked pixels from the true alpha edge");
    for (f, inside) in [
        (
            fixtures::transparent_ring(),
            Box::new(fixtures::ring(c, c, 60.0, 100.0)) as Box<dyn Fn(f64, f64) -> bool>,
        ),
        (
            fixtures::logo_transparent_hole(),
            Box::new({
                let hole = fixtures::disc(128.0, 100.0, 20.0);
                move |x: f64, y: f64| !hole(x, y)
            }),
        ),
    ] {
        for settings in [r#"{"mode":"color"}"#, r#"{"mode":"color","compositing":"mosaic"}"#] {
            let out = trace(&f, settings);
            let svg = to_svg(&out.scene).unwrap();
            let px = render(&svg, f.width, f.height, 1);
            let (mut leaked, mut transparent, mut max_d) = (0usize, 0usize, 0.0f64);
            for y in 0..f.height {
                for x in 0..f.width {
                    let i = y * f.width + x;
                    if !f.truth[i] {
                        transparent += 1;
                        if px[i].0 >= 128 {
                            leaked += 1;
                            max_d = max_d.max(edge_distance(x as f64 + 0.5, y as f64 + 0.5, &*inside));
                        }
                    }
                }
            }
            println!(
                "{:<22} {settings:<42} leak={:.4} ({leaked}/{transparent} px) max_leak_distance_px={max_d:.2}",
                f.id,
                leaked as f64 / transparent as f64
            );
        }
    }
}
