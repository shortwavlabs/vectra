//! P0-R-GEO geometry corpus: procedural fixtures with analytic ground truth.
//!
//! Sets:
//! - `validation`: used while developing the correction.
//! - `heldout`: different sizes, sub-pixel positions, rotations and antialiasing, used only
//!   for the final verdict.
//! - `negative`: deliberately irregular outlines that must *not* be idealised.
//!
//! Parameters live here, independently of the tracer; `geo_corpus` writes them to JSON.
#![allow(dead_code)]

use super::geometry::{GeoFixture, P, Shape};

const BLACK: [u8; 4] = [0, 0, 0, 255];
const WHITE: [u8; 4] = [255, 255, 255, 255];
const CLEAR: [u8; 4] = [0, 0, 0, 0];
const BW: &str = r#"{"mode":"bw"}"#;
const COLOR: &str = r#"{"mode":"color"}"#;

#[allow(clippy::too_many_arguments)]
fn fx(
    id: &str,
    set: &'static str,
    description: &str,
    (w, h): (usize, usize),
    background: [u8; 4],
    layers: Vec<(Shape, [u8; 4])>,
    settings: &str,
    ss: usize,
) -> GeoFixture {
    let mut f = GeoFixture {
        id: id.into(),
        set,
        description: description.into(),
        w,
        h,
        background,
        layers,
        settings: settings.into(),
        ideal: set != "negative",
        rgba: Vec::new(),
    };
    f.rasterize(ss);
    f
}

fn circle(c: P, r: f64) -> Shape {
    Shape::Circle { c, r }
}
fn ring(c: P, r0: f64, r1: f64) -> Shape {
    Shape::Diff(Box::new(circle(c, r1)), Box::new(circle(c, r0)))
}
fn rect(c: P, w: f64, h: f64, deg: f64) -> Shape {
    let t = deg.to_radians();
    let (s, co) = t.sin_cos();
    let pts = [
        [-w / 2.0, -h / 2.0],
        [w / 2.0, -h / 2.0],
        [w / 2.0, h / 2.0],
        [-w / 2.0, h / 2.0],
    ]
    .iter()
    .map(|p| [c[0] + p[0] * co - p[1] * s, c[1] + p[0] * s + p[1] * co])
    .collect();
    Shape::Polygon(pts)
}
fn star(c: P, outer: f64, inner: f64, deg: f64) -> Shape {
    Shape::Polygon(
        (0..10)
            .map(|i| {
                let r = if i % 2 == 0 { outer } else { inner };
                let a = std::f64::consts::PI * i as f64 / 5.0 - std::f64::consts::FRAC_PI_2 + deg.to_radians();
                [c[0] + r * a.cos(), c[1] + r * a.sin()]
            })
            .collect(),
    )
}
fn frame(w: f64, h: f64) -> Shape {
    Shape::Polygon(vec![[0.0, 0.0], [w, 0.0], [w, h], [0.0, h]])
}
fn polar(c: P, r: f64, terms: &[(f64, f64, f64)]) -> Shape {
    Shape::Polar {
        c,
        r,
        terms: terms.to_vec(),
    }
}
fn diff(a: Shape, b: Shape) -> Shape {
    Shape::Diff(Box::new(a), Box::new(b))
}

/// Chromium's decode of a straight-alpha PNG: canvas storage is premultiplied, so
/// `getImageData` returns RGB = round(round(c·a/255)·255/a) for partially transparent pixels.
pub fn browser_decode(rgba: &[u8]) -> Vec<u8> {
    rgba.chunks_exact(4)
        .flat_map(|p| {
            let a = u32::from(p[3]);
            let rt = |c: u8| match a {
                0 => 0,
                255 => c,
                _ => {
                    let pm = (u32::from(c) * a + 127) / 255;
                    ((pm * 255 + a / 2) / a).min(255) as u8
                }
            };
            [rt(p[0]), rt(p[1]), rt(p[2]), p[3]]
        })
        .collect()
}

/// The two owner-rejected cases: P0 fixture pixels as the browser decoded them for the bundle,
/// with analytic truth.
pub fn rejected() -> Vec<GeoFixture> {
    let frame = Shape::Polygon(vec![[0.0, 0.0], [256.0, 0.0], [256.0, 256.0], [0.0, 256.0]]);
    vec![
        GeoFixture {
            id: "05-color-transparent-hole".into(),
            set: "rejected",
            description: "DEF-GEO-001: opaque blue field with a transparent circular hole c=(128,100) r=20".into(),
            w: 256,
            h: 256,
            background: CLEAR,
            layers: vec![(diff(frame, circle([128.0, 100.0], 20.0)), [30, 60, 200, 255])],
            settings: COLOR.into(),
            ideal: true,
            rgba: browser_decode(&super::fixtures::logo_transparent_hole().rgba),
        },
        GeoFixture {
            id: "04-color-discs".into(),
            set: "rejected",
            description: "DEF-GEO-002: discs r=60 at (96,110) red, (160,110) blue, (128,165) yellow on white".into(),
            w: 256,
            h: 256,
            background: WHITE,
            layers: vec![
                (circle([96.0, 110.0], 60.0), [230, 60, 50, 255]),
                (circle([160.0, 110.0], 60.0), [40, 120, 220, 255]),
                (circle([128.0, 165.0], 60.0), [250, 190, 30, 255]),
            ],
            settings: COLOR.into(),
            ideal: true,
            rgba: browser_decode(&super::fixtures::antialiased_discs().rgba),
        },
    ]
}

pub fn all() -> Vec<GeoFixture> {
    let mut v = validation();
    v.extend(negative());
    v.extend(heldout());
    v
}

pub fn validation() -> Vec<GeoFixture> {
    let s = "validation";
    vec![
        // Circular geometry.
        fx(
            "circle-r40-frac",
            s,
            "Black disc r=40 at (128.3,127.6)",
            (256, 256),
            WHITE,
            vec![(circle([128.3, 127.6], 40.0), BLACK)],
            BW,
            8,
        ),
        fx(
            "circle-r100",
            s,
            "Black disc r=100 at (128.5,128.5)",
            (256, 256),
            WHITE,
            vec![(circle([128.5, 128.5], 100.0), BLACK)],
            BW,
            8,
        ),
        fx(
            "circle-r8",
            s,
            "Small black disc r=8 at (31.7,32.2)",
            (64, 64),
            WHITE,
            vec![(circle([31.7, 32.2], 8.0), BLACK)],
            BW,
            8,
        ),
        fx(
            "circle-r3",
            s,
            "Tiny black disc r=3 at (16.4,15.8)",
            (32, 32),
            WHITE,
            vec![(circle([16.4, 15.8], 3.0), BLACK)],
            r#"{"mode":"bw","speckle":0}"#,
            8,
        ),
        fx(
            "circle-hard-r40",
            s,
            "Disc r=40 rendered without antialiasing (1 sample/px)",
            (128, 128),
            WHITE,
            vec![(circle([64.3, 63.8], 40.0), BLACK)],
            BW,
            1,
        ),
        fx(
            "hole-alpha-r30",
            s,
            "Opaque red field with transparent circular hole r=30 at (100.4,140.7)",
            (256, 256),
            CLEAR,
            vec![(
                diff(frame(256.0, 256.0), circle([100.4, 140.7], 30.0)),
                [200, 50, 40, 255],
            )],
            COLOR,
            8,
        ),
        fx(
            "hole-x0.5",
            s,
            "05 geometry at half resolution: hole r=10",
            (128, 128),
            CLEAR,
            vec![(
                diff(frame(128.0, 128.0), circle([64.0, 50.0], 10.0)),
                [30, 60, 200, 255],
            )],
            COLOR,
            8,
        ),
        fx(
            "hole-x2",
            s,
            "05 geometry at double resolution: hole r=40",
            (512, 512),
            CLEAR,
            vec![(
                diff(frame(512.0, 512.0), circle([256.0, 200.0], 40.0)),
                [30, 60, 200, 255],
            )],
            COLOR,
            8,
        ),
        fx(
            "ring-bw",
            s,
            "Black ring r 50–62",
            (256, 256),
            WHITE,
            vec![(ring([128.0, 128.0], 50.0, 62.0), BLACK)],
            BW,
            8,
        ),
        fx(
            "ring-alpha",
            s,
            "Green ring r 50–70 on transparency",
            (256, 256),
            CLEAR,
            vec![(ring([127.6, 128.4], 50.0, 70.0), [40, 160, 60, 255])],
            COLOR,
            8,
        ),
        fx(
            "concentric",
            s,
            "Concentric discs r=90/70/50/30 in alternating colours",
            (256, 256),
            WHITE,
            vec![
                (circle([128.0, 128.0], 90.0), [30, 40, 110, 255]),
                (circle([128.0, 128.0], 70.0), [240, 190, 40, 255]),
                (circle([128.0, 128.0], 50.0), [30, 40, 110, 255]),
                (circle([128.0, 128.0], 30.0), [210, 40, 40, 255]),
            ],
            COLOR,
            8,
        ),
        fx(
            "discs-two-wide",
            s,
            "Two discs r=50, centres 70 apart",
            (256, 256),
            WHITE,
            vec![
                (circle([93.0, 128.0], 50.0), [230, 60, 50, 255]),
                (circle([163.0, 128.0], 50.0), [40, 120, 220, 255]),
            ],
            COLOR,
            8,
        ),
        fx(
            "discs-two-deep",
            s,
            "Two discs r=50, centres 30 apart",
            (256, 256),
            WHITE,
            vec![
                (circle([113.0, 128.0], 50.0), [230, 60, 50, 255]),
                (circle([143.0, 128.0], 50.0), [40, 120, 220, 255]),
            ],
            COLOR,
            8,
        ),
        fx(
            "discs-x2",
            s,
            "04 geometry at double resolution (r=120)",
            (512, 512),
            WHITE,
            vec![
                (circle([192.0, 220.0], 120.0), [230, 60, 50, 255]),
                (circle([320.0, 220.0], 120.0), [40, 120, 220, 255]),
                (circle([256.0, 330.0], 120.0), [250, 190, 30, 255]),
            ],
            COLOR,
            8,
        ),
        // Other geometry.
        fx(
            "ellipse-2to1",
            s,
            "Ellipse a=80 b=40",
            (256, 256),
            WHITE,
            vec![(
                Shape::Ellipse {
                    c: [128.0, 128.0],
                    a: 80.0,
                    b: 40.0,
                    rot: 0.0,
                },
                BLACK,
            )],
            BW,
            8,
        ),
        fx(
            "ellipse-4to1-rot30",
            s,
            "Ellipse a=90 b=22.5 rotated 30°",
            (256, 256),
            WHITE,
            vec![(
                Shape::Ellipse {
                    c: [128.2, 127.7],
                    a: 90.0,
                    b: 22.5,
                    rot: 30f64.to_radians(),
                },
                BLACK,
            )],
            BW,
            8,
        ),
        fx(
            "square",
            s,
            "Axis-aligned square 100 px at fractional offset",
            (256, 256),
            WHITE,
            vec![(rect([128.3, 128.3], 100.0, 100.0, 0.0), BLACK)],
            BW,
            8,
        ),
        fx(
            "rect-rot20",
            s,
            "Rectangle 140×70 rotated 20°",
            (256, 256),
            WHITE,
            vec![(rect([128.0, 128.0], 140.0, 70.0, 20.0), BLACK)],
            BW,
            8,
        ),
        fx(
            "roundrect",
            s,
            "Rounded rectangle 160×100, corner radius 20",
            (256, 256),
            WHITE,
            vec![(
                Shape::RoundRect {
                    c: [128.0, 128.0],
                    w: 160.0,
                    h: 100.0,
                    r: 20.0,
                    rot: 0.0,
                },
                BLACK,
            )],
            BW,
            8,
        ),
        fx(
            "triangle",
            s,
            "Triangle",
            (256, 256),
            WHITE,
            vec![(
                Shape::Polygon(vec![[40.3, 210.0], [215.7, 200.0], [120.0, 40.0]]),
                BLACK,
            )],
            BW,
            8,
        ),
        fx(
            "star",
            s,
            "Five-point star, outer 110, inner 45",
            (256, 256),
            WHITE,
            vec![(star([128.0, 132.0], 110.0, 45.0, 0.0), BLACK)],
            BW,
            8,
        ),
        fx(
            "strokes",
            s,
            "Bars 2, 3 and 5 px wide at 0°, 30°, 45° and 60°",
            (256, 256),
            WHITE,
            vec![
                (rect([128.0, 30.0], 200.0, 2.0, 0.0), BLACK),
                (rect([70.0, 120.0], 120.0, 3.0, 30.0), BLACK),
                (rect([180.0, 120.0], 120.0, 5.0, 45.0), BLACK),
                (rect([128.0, 200.0], 100.0, 3.0, 60.0), BLACK),
            ],
            BW,
            8,
        ),
        fx(
            "compound-holes",
            s,
            "Square with a circular and a triangular hole",
            (256, 256),
            WHITE,
            vec![(
                diff(
                    diff(rect([128.0, 128.0], 180.0, 180.0, 0.0), circle([90.0, 90.0], 30.0)),
                    Shape::Polygon(vec![[130.0, 200.0], [200.0, 200.0], [165.0, 130.0]]),
                ),
                BLACK,
            )],
            BW,
            8,
        ),
        fx(
            "adjacent-overlap",
            s,
            "Red rectangle, blue disc overlapping it, green rotated square",
            (256, 256),
            WHITE,
            vec![
                (rect([90.0, 110.0], 110.0, 80.0, 0.0), [220, 40, 40, 255]),
                (circle([150.0, 140.0], 55.0), [40, 70, 210, 255]),
                (rect([190.0, 70.0], 60.0, 60.0, 15.0), [40, 160, 60, 255]),
            ],
            COLOR,
            8,
        ),
    ]
}

pub fn negative() -> Vec<GeoFixture> {
    let s = "negative";
    vec![
        fx(
            "hand-drawn-circle",
            s,
            "Near-circle r=60 with low-frequency wobble (2–3.5 % of r)",
            (256, 256),
            WHITE,
            vec![(
                polar(
                    [128.0, 128.0],
                    60.0,
                    &[(2.0, 0.02, 0.3), (3.0, 0.035, 1.1), (5.0, 0.01, 2.0)],
                ),
                BLACK,
            )],
            BW,
            8,
        ),
        fx(
            "irregular-ellipse",
            s,
            "Ellipse-like outline with uneven sides",
            (256, 256),
            WHITE,
            vec![(
                polar(
                    [128.0, 128.0],
                    70.0,
                    &[(2.0, 0.22, 0.0), (3.0, 0.04, 0.7), (7.0, 0.012, 1.9)],
                ),
                BLACK,
            )],
            BW,
            8,
        ),
        fx(
            "organic-blob",
            s,
            "Organic silhouette (harmonics 3, 5, 7)",
            (256, 256),
            WHITE,
            vec![(
                polar(
                    [128.0, 128.0],
                    65.0,
                    &[(3.0, 0.12, 0.4), (5.0, 0.06, 2.2), (7.0, 0.04, 0.9)],
                ),
                BLACK,
            )],
            BW,
            8,
        ),
        fx(
            "rough-ink",
            s,
            "Disc r=70 with high-frequency rough edge (≈1 px bumps)",
            (256, 256),
            WHITE,
            vec![(
                polar(
                    [128.0, 128.0],
                    70.0,
                    &[(17.0, 0.015, 0.2), (23.0, 0.012, 1.3), (31.0, 0.01, 2.7)],
                ),
                BLACK,
            )],
            BW,
            8,
        ),
        fx(
            "asymmetric-egg",
            s,
            "Egg shape (harmonics 1 and 2)",
            (256, 256),
            WHITE,
            vec![(
                polar([128.0, 128.0], 70.0, &[(1.0, 0.08, 1.57), (2.0, 0.05, 0.0)]),
                BLACK,
            )],
            BW,
            8,
        ),
        fx(
            "hand-drawn-hole",
            s,
            "Transparent hand-drawn hole in a coloured field",
            (256, 256),
            CLEAR,
            vec![(
                diff(
                    frame(256.0, 256.0),
                    polar([128.0, 110.0], 35.0, &[(2.0, 0.03, 0.5), (3.0, 0.03, 2.0)]),
                ),
                [30, 60, 200, 255],
            )],
            COLOR,
            8,
        ),
    ]
}

pub fn heldout() -> Vec<GeoFixture> {
    let s = "heldout";
    vec![
        fx(
            "h-circle-r15.7",
            s,
            "Disc r=15.7 at (47.13,39.71), 16×16 supersampling",
            (96, 80),
            WHITE,
            vec![(circle([47.13, 39.71], 15.7), BLACK)],
            BW,
            16,
        ),
        fx(
            "h-circle-r55-coarse",
            s,
            "Disc r=55 with coarse 2×2 antialiasing",
            (320, 288),
            WHITE,
            vec![(circle([160.6, 141.2], 55.0), [20, 20, 20, 255])],
            BW,
            2,
        ),
        fx(
            "h-circle-r5",
            s,
            "Small disc r=5 at (19.6,20.3)",
            (40, 40),
            WHITE,
            vec![(circle([19.6, 20.3], 5.0), BLACK)],
            r#"{"mode":"bw","speckle":0}"#,
            8,
        ),
        fx(
            "h-hole-r33",
            s,
            "Transparent hole r=33 at (90.3,70.9) in a green field",
            (200, 160),
            CLEAR,
            vec![(
                diff(frame(200.0, 160.0), circle([90.3, 70.9], 33.0)),
                [20, 140, 90, 255],
            )],
            COLOR,
            8,
        ),
        fx(
            "h-ellipse-3to1-rot63",
            s,
            "Ellipse a=75 b=25 rotated 63°",
            (256, 200),
            WHITE,
            vec![(
                Shape::Ellipse {
                    c: [130.4, 99.1],
                    a: 75.0,
                    b: 25.0,
                    rot: 63f64.to_radians(),
                },
                BLACK,
            )],
            BW,
            8,
        ),
        fx(
            "h-roundrect-rot12",
            s,
            "Rounded rectangle 150×90 r=28 rotated 12°",
            (256, 200),
            WHITE,
            vec![(
                Shape::RoundRect {
                    c: [128.0, 100.0],
                    w: 150.0,
                    h: 90.0,
                    r: 28.0,
                    rot: 12f64.to_radians(),
                },
                BLACK,
            )],
            BW,
            8,
        ),
        fx(
            "h-star-rot17",
            s,
            "Five-point star outer 90 inner 38 rotated 17°",
            (220, 220),
            WHITE,
            vec![(star([110.0, 112.0], 90.0, 38.0, 17.0), BLACK)],
            BW,
            8,
        ),
        fx(
            "h-discs-three",
            s,
            "Three discs r=45/52/38 overlapping at other angles",
            (300, 260),
            WHITE,
            vec![
                (circle([110.0, 120.0], 45.0), [200, 30, 120, 255]),
                (circle([175.0, 105.0], 52.0), [30, 160, 170, 255]),
                (circle([150.0, 170.0], 38.0), [240, 140, 20, 255]),
            ],
            COLOR,
            8,
        ),
        fx(
            "h-ring-thin-alpha",
            s,
            "Thin ring r 40–44 on transparency",
            (128, 128),
            CLEAR,
            vec![(ring([63.7, 64.2], 40.0, 44.0), [120, 40, 160, 255])],
            COLOR,
            8,
        ),
        fx(
            "h-compound-two-holes",
            s,
            "Disc r=70 with two circular holes r=15 and r=22",
            (200, 200),
            WHITE,
            vec![(
                diff(
                    diff(circle([100.0, 100.0], 70.0), circle([70.0, 85.0], 15.0)),
                    circle([125.0, 120.0], 22.0),
                ),
                [60, 60, 60, 255],
            )],
            COLOR,
            8,
        ),
        fx(
            "h-rect-rot37",
            s,
            "Rectangle 120×50 rotated 37°",
            (200, 200),
            WHITE,
            vec![(rect([100.3, 99.6], 120.0, 50.0, 37.0), BLACK)],
            BW,
            8,
        ),
        {
            let mut f = fx(
                "h-hand-drawn",
                s,
                "Held-out negative control: wobbly circle r=50",
                (200, 200),
                WHITE,
                vec![(
                    polar([100.0, 100.0], 50.0, &[(2.0, 0.025, 1.7), (4.0, 0.02, 0.4)]),
                    BLACK,
                )],
                BW,
                8,
            );
            f.ideal = false;
            f
        },
    ]
}
