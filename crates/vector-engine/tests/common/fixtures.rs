//! Procedural fixture corpus (no external artwork). Shared by the integration tests and the
//! `gen_fixtures` example, which writes the same images as PNG for the browser tests.
#![allow(dead_code)]

pub struct Fixture {
    pub id: &'static str,
    pub description: &'static str,
    pub coverage: &'static str,
    pub width: usize,
    pub height: usize,
    /// Straight RGBA8.
    pub rgba: Vec<u8>,
    /// Ground truth "ink" (bw fixtures) or "opaque" (alpha fixtures) per pixel.
    pub truth: Vec<bool>,
}

/// 4×4 supersampled coverage of a shape over pixel (x, y).
pub fn coverage(x: usize, y: usize, inside: &dyn Fn(f64, f64) -> bool) -> f64 {
    let mut hits = 0;
    for sy in 0..4 {
        for sx in 0..4 {
            if inside(x as f64 + (sx as f64 + 0.5) / 4.0, y as f64 + (sy as f64 + 0.5) / 4.0) {
                hits += 1;
            }
        }
    }
    f64::from(hits) / 16.0
}

/// Antialiased black-on-white image of a shape; truth = coverage ≥ 0.5.
pub fn ink_fixture(
    id: &'static str,
    description: &'static str,
    coverage_note: &'static str,
    w: usize,
    h: usize,
    inside: &dyn Fn(f64, f64) -> bool,
) -> Fixture {
    let mut rgba = vec![0u8; w * h * 4];
    let mut truth = vec![false; w * h];
    for y in 0..h {
        for x in 0..w {
            let c = coverage(x, y, inside);
            let v = (255.0 * (1.0 - c)).round() as u8;
            rgba[(y * w + x) * 4..(y * w + x) * 4 + 4].copy_from_slice(&[v, v, v, 255]);
            truth[y * w + x] = c >= 0.5;
        }
    }
    Fixture {
        id,
        description,
        coverage: coverage_note,
        width: w,
        height: h,
        rgba,
        truth,
    }
}

pub fn disc(cx: f64, cy: f64, r: f64) -> impl Fn(f64, f64) -> bool {
    move |x, y| (x - cx).powi(2) + (y - cy).powi(2) <= r * r
}

pub fn ring(cx: f64, cy: f64, r0: f64, r1: f64) -> impl Fn(f64, f64) -> bool {
    move |x, y| {
        let d2 = (x - cx).powi(2) + (y - cy).powi(2);
        d2 >= r0 * r0 && d2 <= r1 * r1
    }
}

/// Point-in-polygon (even-odd) for star/triangle fixtures.
pub fn polygon(pts: Vec<(f64, f64)>) -> impl Fn(f64, f64) -> bool {
    move |x, y| {
        let mut inside = false;
        let n = pts.len();
        for i in 0..n {
            let (xi, yi) = pts[i];
            let (xj, yj) = pts[(i + n - 1) % n];
            if (yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi {
                inside = !inside;
            }
        }
        inside
    }
}

pub fn circle() -> Fixture {
    ink_fixture(
        "circle",
        "Antialiased black disc r=80 on white",
        "bw IoU, curve fitting",
        256,
        256,
        &disc(128.0, 128.0, 80.0),
    )
}

pub fn rectangles() -> Fixture {
    let rotated = polygon(vec![(190.0, 120.0), (230.0, 160.0), (190.0, 200.0), (150.0, 160.0)]);
    ink_fixture(
        "rectangles",
        "Axis-aligned rectangle and a 45° rotated square",
        "straight edges, corners",
        256,
        256,
        &move |x, y| (30.0..120.0).contains(&x) && (40.0..210.0).contains(&y) || rotated(x, y),
    )
}

pub fn sharp_corners() -> Fixture {
    let star: Vec<(f64, f64)> = (0..10)
        .map(|i| {
            let r = if i % 2 == 0 { 110.0 } else { 40.0 };
            let a = std::f64::consts::PI * (i as f64) / 5.0 - std::f64::consts::FRAC_PI_2;
            (128.0 + r * a.cos(), 128.0 + r * a.sin())
        })
        .collect();
    ink_fixture(
        "sharp_corners",
        "Five-point star with 36° acute tips",
        "corner preservation",
        256,
        256,
        &polygon(star),
    )
}

pub fn nested_rings() -> Fixture {
    let (a, b, c) = (
        ring(128.0, 128.0, 90.0, 110.0),
        ring(128.0, 128.0, 50.0, 70.0),
        disc(128.0, 128.0, 30.0),
    );
    ink_fixture(
        "nested_rings",
        "Two concentric rings around a disc: 3 components, 2 holes",
        "hole preservation, topology",
        256,
        256,
        &move |x, y| a(x, y) || b(x, y) || c(x, y),
    )
}

pub fn thin_strokes() -> Fixture {
    ink_fixture(
        "thin_strokes",
        "Horizontal/vertical/diagonal strokes 1, 2, 3 and 4 px wide",
        "thin feature retention",
        256,
        256,
        &|x, y| {
            let h = |y0: f64, t: f64| y >= y0 && y < y0 + t && (20.0..236.0).contains(&x);
            let v = |x0: f64, t: f64| x >= x0 && x < x0 + t && (120.0..236.0).contains(&y);
            h(20.0, 1.0)
                || h(40.0, 2.0)
                || h(60.0, 3.0)
                || h(80.0, 4.0)
                || v(40.0, 1.0)
                || v(80.0, 2.0)
                || v(120.0, 3.0)
                || v(160.0, 4.0)
                || ((x - y + 10.0).abs() < 1.0 && (180.0..236.0).contains(&x))
        },
    )
}

/// Red ring with antialiased alpha on a fully transparent background (RGB = 0 under alpha 0,
/// as many encoders write it). Truth = alpha ≥ 128.
pub fn transparent_ring() -> Fixture {
    let inside = ring(128.0, 128.0, 60.0, 100.0);
    let (w, h) = (256, 256);
    let mut rgba = vec![0u8; w * h * 4];
    let mut truth = vec![false; w * h];
    for y in 0..h {
        for x in 0..w {
            let a = (coverage(x, y, &inside) * 255.0).round() as u8;
            let px = if a > 0 { [200, 30, 40, a] } else { [0, 0, 0, 0] };
            rgba[(y * w + x) * 4..(y * w + x) * 4 + 4].copy_from_slice(&px);
            truth[y * w + x] = a >= 128;
        }
    }
    Fixture {
        id: "transparent_ring",
        description: "Red antialiased-alpha ring on transparent background",
        coverage: "transparency, hole in alpha",
        width: w,
        height: h,
        rgba,
        truth,
    }
}

/// Mostly opaque logo with a small transparent hole that VTracer's sampled-row keying misses.
pub fn logo_transparent_hole() -> Fixture {
    let hole = disc(128.0, 100.0, 20.0);
    let (w, h) = (256, 256);
    let mut rgba = vec![0u8; w * h * 4];
    let mut truth = vec![false; w * h];
    for y in 0..h {
        for x in 0..w {
            let a = ((1.0 - coverage(x, y, &hole)) * 255.0).round() as u8;
            let px = if a > 0 { [30, 60, 200, a] } else { [0, 0, 0, 0] };
            rgba[(y * w + x) * 4..(y * w + x) * 4 + 4].copy_from_slice(&px);
            truth[y * w + x] = a >= 128;
        }
    }
    Fixture {
        id: "logo_transparent_hole",
        description: "Opaque blue field with one transparent hole off VTracer's keying rows",
        coverage: "transparency policy",
        width: w,
        height: h,
        rgba,
        truth,
    }
}

pub const BLOCK_COLORS: [[u8; 3]; 5] = [
    [220, 40, 40],
    [40, 160, 60],
    [40, 70, 210],
    [240, 200, 40],
    [30, 30, 30],
];

/// Four adjacent quadrants plus a centred square: shared edges between 5 colours.
pub fn adjacent_colors() -> Fixture {
    let (w, h) = (256, 256);
    let mut rgba = vec![0u8; w * h * 4];
    for y in 0..h {
        for x in 0..w {
            let q = if (96..160).contains(&x) && (96..160).contains(&y) {
                4
            } else {
                usize::from(y >= 128) * 2 + usize::from(x >= 128)
            };
            let c = BLOCK_COLORS[q];
            rgba[(y * w + x) * 4..(y * w + x) * 4 + 4].copy_from_slice(&[c[0], c[1], c[2], 255]);
        }
    }
    Fixture {
        id: "adjacent_colors",
        description: "Four colour quadrants and a centred dark square",
        coverage: "adjacent regions, seams, palette fidelity",
        width: w,
        height: h,
        rgba,
        truth: vec![true; w * h],
    }
}

/// Overlapping antialiased colour discs on white.
pub fn antialiased_discs() -> Fixture {
    let (w, h) = (256, 256);
    let discs = [
        (96.0, 110.0, 60.0, [230, 60, 50]),
        (160.0, 110.0, 60.0, [40, 120, 220]),
        (128.0, 165.0, 60.0, [250, 190, 30]),
    ];
    let mut rgba = vec![255u8; w * h * 4];
    for y in 0..h {
        for x in 0..w {
            let mut px = [255.0f64, 255.0, 255.0];
            for (cx, cy, r, col) in discs {
                let a = coverage(x, y, &disc(cx, cy, r));
                for k in 0..3 {
                    px[k] = px[k] * (1.0 - a) + f64::from(col[k]) * a;
                }
            }
            for k in 0..3 {
                rgba[(y * w + x) * 4 + k] = px[k].round() as u8;
            }
        }
    }
    Fixture {
        id: "antialiased_discs",
        description: "Three overlapping antialiased colour discs on white",
        coverage: "antialiased colour edges",
        width: w,
        height: h,
        rgba,
        truth: vec![true; w * h],
    }
}

/// Salt noise (seeded LCG, ~3 % density) around one solid square. Truth = the square.
pub fn noise() -> Fixture {
    let (w, h) = (256, 256);
    let mut s: u32 = 0x1234_5678;
    let mut rgba = vec![255u8; w * h * 4];
    let mut truth = vec![false; w * h];
    for y in 0..h {
        for x in 0..w {
            s = s.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let square = (64..192).contains(&x) && (64..192).contains(&y);
            let speck = (s >> 24) < 8;
            // Specks are black outside the square and white (holes) inside it.
            let ink = if square { !speck } else { speck };
            if ink {
                rgba[(y * w + x) * 4..(y * w + x) * 4 + 3].copy_from_slice(&[0, 0, 0]);
            }
            truth[y * w + x] = square;
        }
    }
    Fixture {
        id: "noise",
        description: "Square with 1-px salt-and-pepper noise inside and outside",
        coverage: "speckle removal both ways",
        width: w,
        height: h,
        rgba,
        truth,
    }
}

/// Horizontal grey ramp 0..255 (left black, right white).
pub fn gradient() -> Fixture {
    let (w, h) = (512, 128);
    let mut rgba = vec![255u8; w * h * 4];
    for y in 0..h {
        for x in 0..w {
            let v = (x * 255 / (w - 1)) as u8;
            rgba[(y * w + x) * 4..(y * w + x) * 4 + 3].copy_from_slice(&[v, v, v]);
        }
    }
    Fixture {
        id: "gradient",
        description: "Horizontal grey ramp, black to white",
        coverage: "tone mapping, banding, halftone",
        width: w,
        height: h,
        rgba,
        truth: vec![true; w * h],
    }
}

/// Colour ramp hue sweep for limited-palette experiments.
pub fn color_gradient() -> Fixture {
    let (w, h) = (256, 128);
    let mut rgba = vec![255u8; w * h * 4];
    for y in 0..h {
        for x in 0..w {
            let t = x as f64 / (w - 1) as f64;
            let c = [
                (255.0 * t) as u8,
                (255.0 * (1.0 - (2.0 * t - 1.0).abs())) as u8,
                (255.0 * (1.0 - t)) as u8,
            ];
            rgba[(y * w + x) * 4..(y * w + x) * 4 + 3].copy_from_slice(&c);
        }
    }
    Fixture {
        id: "color_gradient",
        description: "Red–green–blue horizontal ramp",
        coverage: "colour quantisation, banding",
        width: w,
        height: h,
        rgba,
        truth: vec![true; w * h],
    }
}

pub fn checkerboard() -> Fixture {
    ink_fixture(
        "checkerboard",
        "16 px checkerboard (diagonal-touching squares)",
        "connectivity ambiguity",
        256,
        256,
        &|x, y| ((x / 16.0).floor() as i64 + (y / 16.0).floor() as i64) % 2 == 0,
    )
}

pub fn all() -> Vec<Fixture> {
    vec![
        circle(),
        rectangles(),
        sharp_corners(),
        nested_rings(),
        thin_strokes(),
        transparent_ring(),
        logo_transparent_hole(),
        adjacent_colors(),
        antialiased_discs(),
        noise(),
        gradient(),
        color_gradient(),
        checkerboard(),
    ]
}

/// Hand-built scene exercising translucent background, translucent fill and stroke paint.
pub fn translucent_scene() -> vector_engine::scene::Scene {
    use vector_engine::color::Rgba;
    use vector_engine::scene::{Fill, FillRule, Group, Metadata, Path, SCENE_VERSION, Scene, Stroke};
    let square = |x: f64, fill: Option<Fill>, stroke: Option<Stroke>| Path {
        fill,
        stroke,
        fill_rule: FillRule::Nonzero,
        verbs: "MLLLZ".into(),
        coords: vec![x, 10.0, x + 30.0, 10.0, x + 30.0, 40.0, x, 40.0],
    };
    let opaque = Rgba::rgb(10, 20, 200);
    Scene {
        version: SCENE_VERSION,
        width: 120.0,
        height: 50.0,
        background: Some(Rgba {
            r: 250,
            g: 240,
            b: 200,
            a: 128,
        }),
        palette: vec![],
        groups: vec![Group {
            id: "paint".into(),
            clip: None,
            paths: vec![
                square(
                    5.0,
                    Some(Fill {
                        color: opaque,
                        palette_id: None,
                    }),
                    None,
                ),
                square(
                    45.0,
                    Some(Fill {
                        color: Rgba {
                            r: 200,
                            g: 20,
                            b: 10,
                            a: 100,
                        },
                        palette_id: None,
                    }),
                    None,
                ),
                square(
                    85.0,
                    None,
                    Some(Stroke {
                        color: Rgba {
                            r: 0,
                            g: 120,
                            b: 0,
                            a: 160,
                        },
                        width: 3.0,
                    }),
                ),
            ],
        }],
        metadata: Metadata {
            generator: "test".into(),
            engine_version: "0".into(),
            mode: "paint-test".into(),
            preset_version: 1,
            seed: 0,
            source_width: 120,
            source_height: 50,
            params: serde_json::Value::Null,
        },
    }
}
