//! VTracer candidate comparison for P0-G1.
//!
//! Runs VTracer 0.6.5 and 1.0.0-alpha.4 on identical procedural fixtures,
//! renders each candidate's own SVG output with resvg (independent renderer)
//! and scores it against the fixture's ground-truth mask.
//!
//! Usage: cargo run --release --locked -- [runs]
//! Output: one TSV row per (fixture, candidate) on stdout.

use std::hash::{DefaultHasher, Hasher};
use std::time::Instant;

const N: usize = 256;

struct Fixture {
    name: &'static str,
    /// true = trace with binary/bw mode, false = colour mode
    binary: bool,
    rgba: Vec<u8>,
    /// ground truth: pixel belongs to "ink" (binary) or is opaque (colour)
    truth: Vec<bool>,
}

/// Supersampled coverage of `inside` over the pixel (4x4).
fn coverage(x: usize, y: usize, inside: &dyn Fn(f64, f64) -> bool) -> f64 {
    let mut hits = 0;
    for sy in 0..4 {
        for sx in 0..4 {
            let px = x as f64 + (sx as f64 + 0.5) / 4.0;
            let py = y as f64 + (sy as f64 + 0.5) / 4.0;
            if inside(px, py) {
                hits += 1;
            }
        }
    }
    hits as f64 / 16.0
}

fn gray_fixture(name: &'static str, inside: &dyn Fn(f64, f64) -> bool) -> Fixture {
    let mut rgba = vec![0u8; N * N * 4];
    let mut truth = vec![false; N * N];
    for y in 0..N {
        for x in 0..N {
            let c = coverage(x, y, inside);
            let v = (255.0 * (1.0 - c)).round() as u8;
            let i = (y * N + x) * 4;
            rgba[i..i + 4].copy_from_slice(&[v, v, v, 255]);
            truth[y * N + x] = c >= 0.5;
        }
    }
    Fixture { name, binary: true, rgba, truth }
}

fn ring(cx: f64, cy: f64, r0: f64, r1: f64) -> impl Fn(f64, f64) -> bool {
    move |x, y| {
        let d = ((x - cx).powi(2) + (y - cy).powi(2)).sqrt();
        d >= r0 && d <= r1
    }
}

fn fixtures() -> Vec<Fixture> {
    let c = N as f64 / 2.0;
    let mut out = vec![
        gray_fixture("circle", &ring(c, c, 0.0, 80.0)),
        gray_fixture("nested_rings", &|x, y| {
            ring(c, c, 90.0, 110.0)(x, y) || ring(c, c, 50.0, 70.0)(x, y) || ring(c, c, 0.0, 30.0)(x, y)
        }),
        gray_fixture("thin_strokes", &|x, y| {
            (y >= 40.0 && y < 41.0 && x > 20.0 && x < 236.0)
                || (x >= 60.0 && x < 62.0 && y > 60.0 && y < 236.0)
                || ((x - y).abs() < 0.75 && x > 80.0 && x < 230.0)
        }),
    ];

    // Transparent ring: red ring with antialiased alpha on a fully transparent background.
    {
        let inside = ring(c, c, 60.0, 100.0);
        let mut rgba = vec![0u8; N * N * 4];
        let mut truth = vec![false; N * N];
        for y in 0..N {
            for x in 0..N {
                let a = (coverage(x, y, &inside) * 255.0).round() as u8;
                let i = (y * N + x) * 4;
                rgba[i..i + 4].copy_from_slice(&[if a > 0 { 220 } else { 0 }, 30, 30, a]);
                truth[y * N + x] = a >= 128;
            }
        }
        out.push(Fixture { name: "transparent_ring", binary: false, rgba, truth });
    }

    // Opaque logo with one small transparent hole that avoids VTracer's sampled keying rows.
    {
        let hole = ring(128.0, 100.0, 0.0, 20.0);
        let mut rgba = vec![0u8; N * N * 4];
        let mut truth = vec![false; N * N];
        for y in 0..N {
            for x in 0..N {
                let a = ((1.0 - coverage(x, y, &hole)) * 255.0).round() as u8;
                let i = (y * N + x) * 4;
                rgba[i..i + 4].copy_from_slice(&[if a > 0 { 30 } else { 0 }, if a > 0 { 60 } else { 0 }, if a > 0 { 200 } else { 0 }, a]);
                truth[y * N + x] = a >= 128;
            }
        }
        out.push(Fixture { name: "logo_with_transparent_hole", binary: false, rgba, truth });
    }

    // Four adjacent opaque colour blocks.
    {
        let colors = [[220u8, 40, 40], [40, 160, 60], [40, 70, 210], [240, 200, 40]];
        let mut rgba = vec![0u8; N * N * 4];
        for y in 0..N {
            for x in 0..N {
                let q = (y >= N / 2) as usize * 2 + (x >= N / 2) as usize;
                let i = (y * N + x) * 4;
                rgba[i..i + 3].copy_from_slice(&colors[q]);
                rgba[i + 3] = 255;
            }
        }
        out.push(Fixture { name: "color_blocks", binary: false, rgba, truth: vec![true; N * N] });
    }

    // Noise speckles plus one solid square (seeded LCG).
    {
        let mut s: u32 = 0x1234_5678;
        let mut truth = vec![false; N * N];
        let mut rgba = vec![255u8; N * N * 4];
        for y in 0..N {
            for x in 0..N {
                s = s.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let square = (64..192).contains(&x) && (64..192).contains(&y);
                let ink = square || (s >> 24) < 8;
                let i = (y * N + x) * 4;
                if ink {
                    rgba[i..i + 3].copy_from_slice(&[0, 0, 0]);
                }
                truth[y * N + x] = square;
            }
        }
        out.push(Fixture { name: "noise_speckle", binary: true, rgba, truth });
    }
    out
}

fn run_06(f: &Fixture) -> Result<String, String> {
    let img = vt06::ColorImage { pixels: f.rgba.clone(), width: N, height: N };
    let mut cfg = vt06::Config::default();
    cfg.filter_speckle = 4;
    if f.binary {
        cfg.color_mode = vt06::ColorMode::Binary;
    }
    vt06::convert(img, cfg).map(|svg| svg.to_string())
}

fn run_10(f: &Fixture) -> Result<String, String> {
    let img = vt10::ColorImage { pixels: f.rgba.clone(), width: N, height: N };
    let mut cfg = vt10::Config::default();
    cfg.filter_speckle = 4;
    if f.binary {
        cfg.clustering = vt10::Clustering::Binary;
    }
    let pipeline = cfg.build().map_err(|e| e.to_string())?;
    pipeline.to_svg(&img).map_err(|e| e.to_string())
}

/// Render SVG with resvg and score it against the fixture truth.
fn score(f: &Fixture, svg: &str) -> (f64, f64) {
    let tree = resvg::usvg::Tree::from_str(svg, &resvg::usvg::Options::default()).expect("svg parses");
    let mut pixmap = resvg::tiny_skia::Pixmap::new(N as u32, N as u32).unwrap();
    resvg::render(&tree, resvg::tiny_skia::Transform::identity(), &mut pixmap.as_mut());
    let px = pixmap.data(); // premultiplied RGBA
    let (mut inter, mut uni, mut leak, mut transparent) = (0usize, 0usize, 0usize, 0usize);
    for i in 0..N * N {
        let a = px[i * 4 + 3];
        let painted = if f.binary {
            // ink = opaque and dark (premultiplied luminance < half alpha)
            a >= 128 && (px[i * 4] as u32) < (a as u32) / 2
        } else {
            a >= 128
        };
        let t = f.truth[i];
        if painted && t {
            inter += 1;
        }
        if painted || t {
            uni += 1;
        }
        if !f.binary && !t {
            transparent += 1;
            if painted {
                leak += 1;
            }
        }
    }
    let iou = if uni == 0 { 1.0 } else { inter as f64 / uni as f64 };
    let leak = if transparent == 0 { 0.0 } else { leak as f64 / transparent as f64 };
    (iou, leak)
}

fn main() {
    let runs: usize = std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(5);
    println!("fixture\tcandidate\tmedian_ms\tpaths\tsvg_bytes\tiou\ttransparent_leak\toutput_hash");
    for f in fixtures() {
        for (name, run) in [("0.6.5", run_06 as fn(&Fixture) -> Result<String, String>), ("1.0.0-alpha.4", run_10)] {
            let mut times = Vec::new();
            let mut last = Err(String::new());
            for _ in 0..runs {
                let t = Instant::now();
                last = run(&f);
                times.push(t.elapsed().as_secs_f64() * 1000.0);
            }
            times.sort_by(|a, b| a.partial_cmp(b).unwrap());
            match last {
                Ok(svg) => {
                    let (iou, leak) = score(&f, &svg);
                    let mut h = DefaultHasher::new();
                    h.write(svg.as_bytes());
                    println!(
                        "{}\t{}\t{:.2}\t{}\t{}\t{:.4}\t{:.4}\t{:016x}",
                        f.name,
                        name,
                        times[times.len() / 2],
                        svg.matches("<path").count(),
                        svg.len(),
                        iou,
                        leak,
                        h.finish()
                    );
                }
                Err(e) => println!("{}\t{}\tERROR\t{}", f.name, name, e),
            }
        }
    }
}
