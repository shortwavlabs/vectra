//! Engine integration tests on the procedural corpus. Geometry is scored by rendering the
//! exported SVG with resvg (an independent renderer) and comparing it to fixture ground truth.
//! Run with `--nocapture` to print the per-fixture metrics recorded in P0-G1.

mod common;

use common::fixtures::{self, Fixture};
use resvg::usvg::roxmltree;
use vector_engine::error::EngineError;
use vector_engine::params::TraceRequest;
use vector_engine::pdf::{PdfOptions, Unit, to_pdf};
use vector_engine::scene::{FillRule, Scene};
use vector_engine::svg::to_svg;
use vector_engine::{Output, vectorize};

fn request(settings: &str) -> TraceRequest {
    TraceRequest::from_json(&format!(r#"{{"presetVersion":1,"seed":7,"settings":{settings}}}"#)).unwrap()
}

fn run(f: &Fixture, settings: &str) -> Output {
    vectorize(&f.rgba, f.width as u32, f.height as u32, &request(settings), &|| 0.0)
        .unwrap_or_else(|e| panic!("{} {settings}: {e}", f.id))
}

/// Premultiplied RGBA render of an SVG at its own size.
fn render(svg: &str, w: usize, h: usize) -> Vec<u8> {
    let tree = resvg::usvg::Tree::from_str(svg, &resvg::usvg::Options::default()).expect("SVG parses");
    let mut pm = resvg::tiny_skia::Pixmap::new(w as u32, h as u32).unwrap();
    resvg::render(&tree, resvg::tiny_skia::Transform::identity(), &mut pm.as_mut());
    pm.data().to_vec()
}

fn ink(px: &[u8]) -> Vec<bool> {
    px.chunks_exact(4)
        .map(|p| p[3] >= 128 && u32::from(p[0]) * 2 < u32::from(p[3]))
        .collect()
}

fn opaque(px: &[u8]) -> Vec<bool> {
    px.chunks_exact(4).map(|p| p[3] >= 128).collect()
}

fn iou(a: &[bool], b: &[bool]) -> f64 {
    let (mut i, mut u) = (0, 0);
    for (x, y) in a.iter().zip(b) {
        i += usize::from(*x && *y);
        u += usize::from(*x || *y);
    }
    if u == 0 { 1.0 } else { i as f64 / u as f64 }
}

/// Fraction of truth-false pixels that were painted.
fn leak(painted: &[bool], truth: &[bool]) -> f64 {
    let outside = truth.iter().filter(|t| !**t).count().max(1);
    painted.iter().zip(truth).filter(|(p, t)| **p && !**t).count() as f64 / outside as f64
}

const BW: &str = r#"{"mode":"bw"}"#;

#[test]
fn bw_simple_shapes_match_ground_truth() {
    for (f, min_iou, subpaths) in [
        (fixtures::circle(), 0.98, Some(1)),
        (fixtures::rectangles(), 0.98, Some(2)),
        (fixtures::sharp_corners(), 0.97, Some(1)),
        (fixtures::nested_rings(), 0.97, Some(5)),
        (fixtures::checkerboard(), 0.98, None),
    ] {
        let out = run(&f, BW);
        let svg = to_svg(&out.scene).unwrap();
        let score = iou(&ink(&render(&svg, f.width, f.height)), &f.truth);
        eprintln!(
            "G1 bw {:<16} iou={score:.4} paths={} subpaths={} anchors={} svg_bytes={}",
            f.id,
            out.metrics.stats.paths,
            out.metrics.stats.subpaths,
            out.metrics.stats.anchors,
            svg.len()
        );
        assert!(score >= min_iou, "{} IoU {score}", f.id);
        if let Some(n) = subpaths {
            assert_eq!(out.metrics.stats.subpaths, n, "{} topology", f.id);
        }
        assert!(
            out.scene.groups[0]
                .paths
                .iter()
                .all(|p| p.fill_rule == FillRule::Evenodd)
        );
    }
}

#[test]
fn nested_ring_holes_stay_open() {
    let f = fixtures::nested_rings();
    let px = render(&to_svg(&run(&f, BW).scene).unwrap(), f.width, f.height);
    let ink = ink(&px);
    // radius 40 and 80 are inside the two holes; 20, 60 and 100 are ink.
    for (r, expect) in [
        (20.0, true),
        (40.0, false),
        (60.0, true),
        (80.0, false),
        (100.0, true),
        (120.0, false),
    ] {
        for a in [0.3f64, 1.9, 3.7, 5.1] {
            let (x, y) = ((128.0 + r * a.cos()) as usize, (128.0 + r * a.sin()) as usize);
            assert_eq!(ink[y * f.width + x], expect, "radius {r} angle {a}");
        }
    }
}

#[test]
fn thin_strokes_are_reported() {
    let f = fixtures::thin_strokes();
    for (label, settings) in [
        ("spline speckle16", BW),
        ("spline speckle0", r#"{"mode":"bw","speckle":0}"#),
        (
            "polygon speckle0",
            r#"{"mode":"bw","speckle":0,"fit":{"mode":"polygon"}}"#,
        ),
    ] {
        let out = run(&f, settings);
        let score = iou(&ink(&render(&to_svg(&out.scene).unwrap(), f.width, f.height)), &f.truth);
        eprintln!(
            "G1 thin_strokes {label:<18} iou={score:.4} paths={}",
            out.metrics.stats.paths
        );
        assert!(score > 0.6, "{label}");
    }
}

#[test]
fn invert_and_threshold_follow_luminance() {
    let f = fixtures::circle();
    let out = run(&f, r#"{"mode":"bw","invert":true}"#);
    let inverted: Vec<bool> = f.truth.iter().map(|t| !t).collect();
    let score = iou(
        &ink(&render(&to_svg(&out.scene).unwrap(), f.width, f.height)),
        &inverted,
    );
    assert!(score >= 0.98, "inverted IoU {score}");
    // Threshold 0: nothing is darker than 0, so no ink.
    let none = run(&f, r#"{"mode":"bw","threshold":0}"#);
    assert_eq!(none.metrics.stats.paths, 0);
    assert!(none.warnings.iter().any(|w| w.code == "empty_result"));
}

#[test]
fn speckle_removal_works_on_ink_and_holes() {
    let f = fixtures::noise();
    let clean = run(&f, r#"{"mode":"bw","speckle":16}"#);
    let raw = run(&f, r#"{"mode":"bw","speckle":0}"#);
    eprintln!(
        "G1 noise speckle16 paths={} subpaths={}  speckle0 paths={} subpaths={}",
        clean.metrics.stats.paths, clean.metrics.stats.subpaths, raw.metrics.stats.paths, raw.metrics.stats.subpaths
    );
    assert_eq!(
        (clean.metrics.stats.paths, clean.metrics.stats.subpaths),
        (1, 1),
        "specks and pin-holes removed"
    );
    // Finding: VTracer's fitters drop isolated ~1 px components even with speckle disabled,
    // so "raw" keeps only the larger specks.
    assert!(raw.metrics.stats.paths > 10);
    let score = iou(
        &ink(&render(&to_svg(&clean.scene).unwrap(), f.width, f.height)),
        &f.truth,
    );
    // Notches and specks touching the square edge are connected to it, so not removed.
    assert!(score >= 0.98, "{score}");
}

#[test]
fn transparent_pixels_never_become_ink_or_fill() {
    for f in [fixtures::transparent_ring(), fixtures::logo_transparent_hole()] {
        for settings in [
            BW,
            r#"{"mode":"color"}"#,
            r#"{"mode":"color","compositing":"mosaic"}"#,
            r#"{"mode":"limited","colors":4}"#,
        ] {
            let out = run(&f, settings);
            assert!(out.scene.background.is_none());
            let painted = opaque(&render(&to_svg(&out.scene).unwrap(), f.width, f.height));
            let (score, lk) = (iou(&painted, &f.truth), leak(&painted, &f.truth));
            eprintln!("G1 alpha {:<22} {settings:<44} iou={score:.4} leak={lk:.4}", f.id);
            assert!(lk < 0.01, "{} {settings}: transparent leak {lk}", f.id);
            assert!(score >= 0.97, "{} {settings}: IoU {score}", f.id);
            assert!(out.warnings.iter().any(|w| w.code == "alpha_binarized"));
        }
    }
}

#[test]
fn adjacent_colour_regions_keep_exact_colours() {
    let f = fixtures::adjacent_colors();
    for settings in [
        r#"{"mode":"color"}"#,
        r#"{"mode":"color","compositing":"mosaic"}"#,
        r#"{"mode":"limited","colors":5}"#,
    ] {
        let out = run(&f, settings);
        let px = render(&to_svg(&out.scene).unwrap(), f.width, f.height);
        let wrong = (0..f.width * f.height)
            .filter(|&i| {
                (0..3).any(|k| (i16::from(px[i * 4 + k]) - i16::from(f.rgba[i * 4 + k])).abs() > 8)
                    || px[i * 4 + 3] < 250
            })
            .count();
        let frac = wrong as f64 / (f.width * f.height) as f64;
        eprintln!(
            "G1 adjacent_colors {settings:<44} paths={} wrong_px={frac:.5}",
            out.metrics.stats.paths
        );
        assert!(frac < 0.01, "{settings}: {frac}");
        for p in &out.scene.groups[0].paths {
            let c = p.fill.as_ref().unwrap().color;
            assert!(
                fixtures::BLOCK_COLORS.contains(&[c.r, c.g, c.b]),
                "{settings}: unexpected colour {c:?}"
            );
        }
    }
}

#[test]
fn limited_palette_is_respected() {
    let f = fixtures::color_gradient();
    let out = run(&f, r#"{"mode":"limited","colors":6}"#);
    assert_eq!(out.scene.palette.len(), 6);
    let ids: Vec<_> = out.scene.palette.iter().map(|e| e.id.clone()).collect();
    for p in &out.scene.groups[0].paths {
        assert!(ids.contains(p.fill.as_ref().unwrap().palette_id.as_ref().unwrap()));
    }
    let custom = run(&f, r##"{"mode":"limited","palette":["#000000","#ffffff","#ff0000"]}"##);
    let colors: Vec<String> = custom.scene.palette.iter().map(|e| String::from(e.color)).collect();
    assert_eq!(colors, ["#000000", "#ffffff", "#ff0000"]);
    eprintln!(
        "G1 limited color_gradient k=6 paths={} anchors={}",
        out.metrics.stats.paths, out.metrics.stats.anchors
    );
}

#[test]
fn identical_inputs_produce_identical_scenes() {
    let modes = [
        BW,
        r#"{"mode":"color"}"#,
        r#"{"mode":"color","compositing":"mosaic"}"#,
        r#"{"mode":"limited","colors":8}"#,
        r#"{"mode":"halftone"}"#,
    ];
    for f in fixtures::all() {
        for m in modes {
            let a = run(&f, m).scene.to_json();
            let b = run(&f, m).scene.to_json();
            assert_eq!(a, b, "{} {m}", f.id);
            assert_eq!(
                to_svg(&Scene::from_json(&a).unwrap()).unwrap(),
                to_svg(&Scene::from_json(&b).unwrap()).unwrap()
            );
        }
    }
}

#[test]
fn halftone_maps_tone_to_dot_area() {
    let f = fixtures::gradient();
    let out = run(
        &f,
        r#"{"mode":"halftone","pitch":8,"angle":45,"paper":null,"minCoverage":0}"#,
    );
    let svg = to_svg(&out.scene).unwrap();
    let px = render(&svg, f.width, f.height);
    let band = 32;
    let mut max_err: f64 = 0.0;
    for b in 1..(f.width / band - 1) {
        let (x0, x1) = (b * band, (b + 1) * band);
        let mut covered = 0.0;
        for y in 16..f.height - 16 {
            for x in x0..x1 {
                covered += f64::from(px[(y * f.width + x) * 4 + 3]) / 255.0;
            }
        }
        let measured = covered / ((x1 - x0) * (f.height - 32)) as f64;
        let expected = 1.0 - ((x0 + x1) as f64 / 2.0 / (f.width - 1) as f64);
        max_err = max_err.max((measured - expected).abs());
    }
    eprintln!(
        "G1 halftone gradient dots={} anchors={} svg_bytes={} max_band_error={max_err:.4}",
        out.metrics.dots,
        out.metrics.stats.anchors,
        svg.len()
    );
    assert!(max_err < 0.05, "tone error {max_err}");

    // Counterfactual: the same dots filled even-odd lose ink where dots overlap.
    let mut evenodd = out.scene.clone();
    evenodd.groups[0].paths[0].fill_rule = FillRule::Evenodd;
    let eo = render(&to_svg(&evenodd).unwrap(), f.width, f.height);
    let dark = |px: &[u8]| {
        (16..112)
            .map(|y| (16..48).map(|x| u32::from(px[(y * f.width + x) * 4 + 3])).sum::<u32>())
            .sum::<u32>()
    };
    eprintln!(
        "G1 halftone darkest band coverage nonzero={} evenodd={}",
        dark(&px),
        dark(&eo)
    );
    assert!(
        dark(&eo) < dark(&px) * 9 / 10,
        "even-odd must visibly punch overlap holes"
    );
}

#[test]
fn halftone_respects_alpha_paper_and_limits() {
    let f = fixtures::transparent_ring();
    let out = run(&f, r#"{"mode":"halftone","pitch":4,"paper":null}"#);
    assert!(out.scene.background.is_none());
    let painted: Vec<bool> = render(&to_svg(&out.scene).unwrap(), f.width, f.height)
        .chunks_exact(4)
        .map(|p| p[3] > 0)
        .collect();
    let lk = leak(&painted, &f.truth);
    eprintln!("G1 halftone transparent_ring leak={lk:.4}");
    assert!(lk < 0.05);
    let with_paper = run(&f, r##"{"mode":"halftone","paper":"#f3ead8"}"##);
    assert_eq!(
        with_paper.scene.background.map(String::from),
        Some("#f3ead8".to_string())
    );

    let big: Vec<u8> = [0u8, 0, 0, 255].repeat(2000 * 2000);
    let r = vectorize(&big, 2000, 2000, &request(r#"{"mode":"halftone","pitch":2}"#), &|| 0.0);
    assert!(matches!(r, Err(EngineError::TooManyPrimitives { .. })), "{:?}", r.err());
}

#[test]
fn malformed_inputs_return_typed_errors() {
    let req = request(BW);
    let cases: [(Vec<u8>, u32, u32, &str); 4] = [
        (vec![0; 15], 2, 2, "buffer_length_mismatch"),
        (vec![], 0, 0, "invalid_dimensions"),
        (vec![0; 4], 20_000, 1, "invalid_dimensions"),
        (vec![0; 4], 1, 1, "ok"),
    ];
    for (buf, w, h, code) in cases {
        let r = vectorize(&buf, w, h, &req, &|| 0.0);
        assert_eq!(r.as_ref().err().map_or("ok", EngineError::code), code);
    }
    let small = TraceRequest::from_json(r#"{"presetVersion":1,"maxPixels":100,"settings":{"mode":"bw"}}"#).unwrap();
    let r = vectorize(&vec![0; 400 * 4], 20, 20, &small, &|| 0.0);
    assert_eq!(r.err().map(|e| e.code()), Some("image_too_large"));
}

const SVG_ELEMENTS: [&str; 7] = ["svg", "desc", "defs", "clipPath", "rect", "g", "path"];
const SVG_ATTRS: [&str; 18] = [
    "xmlns",
    "version",
    "width",
    "height",
    "viewBox",
    "id",
    "clip-path",
    "x",
    "y",
    "d",
    "fill",
    "fill-opacity",
    "fill-rule",
    "class",
    "stroke",
    "stroke-opacity",
    "stroke-width",
    "clip-rule",
];

#[test]
fn svg_export_is_allowlisted_vector_only() {
    for f in fixtures::all() {
        for m in [
            BW,
            r#"{"mode":"color"}"#,
            r#"{"mode":"limited","colors":6}"#,
            r#"{"mode":"halftone"}"#,
        ] {
            let svg = to_svg(&run(&f, m).scene).unwrap();
            let doc = roxmltree::Document::parse(&svg).expect("well-formed XML");
            let root = doc.root_element();
            assert_eq!(
                root.attribute("viewBox"),
                Some(format!("0 0 {} {}", f.width, f.height).as_str())
            );
            for n in doc.descendants().filter(|n| n.is_element()) {
                assert!(
                    SVG_ELEMENTS.contains(&n.tag_name().name()),
                    "element {}",
                    n.tag_name().name()
                );
                for a in n.attributes() {
                    assert!(SVG_ATTRS.contains(&a.name()), "attribute {}", a.name());
                    if let Some(u) = a.value().strip_prefix("url(") {
                        assert!(u.starts_with('#'), "external reference {}", a.value());
                    }
                }
            }
            for forbidden in [
                "<image",
                "<script",
                "foreignObject",
                "href",
                "<style",
                "data:",
                "http://www.w3.org/1999/xlink",
            ] {
                assert!(!svg.contains(forbidden), "{forbidden}");
            }
        }
    }
}

/// Operators in a decompressed content stream.
fn operators(stream: &str) -> std::collections::BTreeSet<String> {
    stream
        .split_ascii_whitespace()
        .filter(|t| t.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '*') && !t.starts_with('/'))
        .map(str::to_string)
        .collect()
}

#[test]
fn pdf_export_is_vector_only_with_exact_page_size() {
    let allowed: std::collections::BTreeSet<String> = [
        "q", "Q", "cm", "gs", "rg", "RG", "w", "m", "l", "c", "h", "re", "W", "n", "f", "f*", "S", "B", "B*",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    for f in [
        fixtures::nested_rings(),
        fixtures::transparent_ring(),
        fixtures::gradient(),
    ] {
        for m in [BW, r#"{"mode":"color"}"#, r#"{"mode":"halftone"}"#] {
            let scene = run(&f, m).scene;
            let pdf = to_pdf(
                &scene,
                &PdfOptions {
                    width: 100.0,
                    unit: Unit::Mm,
                    dpi: None,
                },
            )
            .unwrap();
            let text = String::from_utf8_lossy(&pdf);
            assert!(text.starts_with("%PDF-"));
            for forbidden in [
                "/Image",
                "/XObject",
                "/Font",
                "/JavaScript",
                "/JS",
                "/Pattern",
                "/Shading",
            ] {
                assert!(!text.contains(forbidden), "{forbidden} in {} {m}", f.id);
            }
            let w = 100.0 * 72.0 / 25.4;
            let h = w * f.height as f64 / f.width as f64;
            let mb = text.split("/MediaBox [").nth(1).unwrap().split(']').next().unwrap();
            let nums: Vec<f64> = mb.split_whitespace().map(|v| v.parse().unwrap()).collect();
            assert!(
                (nums[2] - w).abs() < 0.1 && (nums[3] - h).abs() < 0.1,
                "MediaBox {nums:?}"
            );
            // Decompress the single content stream and check its operators.
            let find = |needle: &[u8]| pdf.windows(needle.len()).position(|w| w == needle).unwrap();
            let start = find(b"stream\n") + 7;
            let end = find(b"\nendstream");
            let raw = miniz_oxide::inflate::decompress_to_vec_zlib(&pdf[start..end]).unwrap();
            let ops = operators(&String::from_utf8(raw).unwrap());
            assert!(
                ops.is_subset(&allowed),
                "unexpected operators {:?}",
                ops.difference(&allowed).collect::<Vec<_>>()
            );
            assert!(ops.contains("c") || ops.contains("l"));
        }
    }
    let scene = run(&fixtures::circle(), BW).scene;
    assert!(
        to_pdf(
            &scene,
            &PdfOptions {
                width: 300.0,
                unit: Unit::In,
                dpi: None
            }
        )
        .is_err(),
        "21600 pt > 14400 pt limit"
    );
}

/// Minimal content-stream interpreter: (fill rgb, active ExtGState name or "") per paint operator.
fn paint_ops(content: &str) -> Vec<(String, String, String)> {
    let (mut stack, mut gs, mut rg, mut last) = (Vec::new(), String::new(), String::new(), Vec::<&str>::new());
    let mut out = Vec::new();
    for t in content.split_ascii_whitespace() {
        match t {
            "q" => stack.push((gs.clone(), rg.clone())),
            "Q" => (gs, rg) = stack.pop().unwrap(),
            "gs" => gs = last.last().unwrap().to_string(),
            "rg" => rg = last[last.len() - 3..].join(" "),
            "f" | "f*" | "S" | "B" | "B*" => out.push((t.to_string(), rg.clone(), gs.clone())),
            _ => {}
        }
        if t.chars()
            .next()
            .is_some_and(|c| c.is_ascii_digit() || c == '-' || c == '.' || c == '/')
        {
            last.push(t);
        } else {
            last.clear();
        }
    }
    out
}

#[test]
fn translucent_fill_background_and_stroke_are_exported_without_alpha_leaks() {
    let scene = fixtures::translucent_scene();
    let svg = to_svg(&scene).unwrap();
    assert!(svg.contains("fill-opacity=\"0.502\""), "background opacity");
    assert!(svg.contains("fill-opacity=\"0.392\""), "translucent fill");
    assert!(
        svg.contains("stroke=\"#007800\" stroke-opacity=\"0.627\" stroke-width=\"3\""),
        "{svg}"
    );
    let pdf = to_pdf(
        &scene,
        &PdfOptions {
            width: 120.0,
            unit: Unit::Pt,
            dpi: None,
        },
    )
    .unwrap();
    let find = |needle: &[u8]| pdf.windows(needle.len()).position(|w| w == needle).unwrap();
    let raw = miniz_oxide::inflate::decompress_to_vec_zlib(&pdf[find(b"stream\n") + 7..find(b"\nendstream")]).unwrap();
    let ops = paint_ops(&String::from_utf8(raw).unwrap());
    // background (translucent), opaque fill, translucent fill, stroke-only.
    assert_eq!(ops.len(), 4, "{ops:?}");
    assert!(!ops[0].2.is_empty(), "background uses an ExtGState");
    assert_eq!(
        ops[1].2, "",
        "opaque fill must not inherit the background alpha: {ops:?}"
    );
    assert!(!ops[2].2.is_empty(), "translucent fill uses an ExtGState");
    assert_eq!(ops[3].0, "S");
    let text = String::from_utf8_lossy(&pdf);
    assert!(
        text.contains("/ca 0.5019608") && text.contains("/ca 0.39215687") && text.contains("/CA 0.627451"),
        "{text}"
    );
}
