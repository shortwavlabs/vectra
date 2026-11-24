//! P0-R-GEO regression protection for `fit.mode = "precision"` (geometric artwork).
//! The approved spline behaviour is protected separately by the byte-level regression corpus
//! (`regression_corpus` against `artifacts/regression/baseline-7cdde36.sha256`) and by the
//! existing engine tests, which are unchanged.
mod common;

use common::corpus;
use common::geometry::{GeoFixture, evaluate, topology};
use vector_engine::color::Luma;
use vector_engine::image::RgbaImage;
use vector_engine::params::TraceRequest;
use vector_engine::pdf::{PdfOptions, Unit, to_pdf};
use vector_engine::precision::{self, EdgePolicy, Field, Options, PRECISION_FIT_VERSION};
use vector_engine::svg::to_svg;

fn precision_request(f: &GeoFixture) -> TraceRequest {
    let mut settings: serde_json::Value = serde_json::from_str(&f.settings).unwrap();
    settings["fit"] = serde_json::json!({"mode": "precision"});
    TraceRequest::from_json(&serde_json::json!({"presetVersion": 1, "seed": 1, "settings": settings}).to_string())
        .unwrap()
}

fn trace(f: &GeoFixture) -> vector_engine::Output {
    vector_engine::vectorize(&f.rgba, f.w as u32, f.h as u32, &precision_request(f), &|| 0.0).unwrap()
}

fn find(id: &str) -> GeoFixture {
    corpus::all()
        .into_iter()
        .chain(corpus::rejected())
        .find(|f| f.id == id)
        .unwrap()
}

#[test]
fn owner_rejected_circles_meet_the_briefs_targets() {
    for id in ["05-color-transparent-hole", "04-color-discs"] {
        let f = find(id);
        let out = trace(&f);
        assert_eq!(out.metrics.precision_fit_version, Some(PRECISION_FIT_VERSION));
        let r = evaluate(&f.truth(0.05), &out.scene, f.w, f.h);
        assert!(!r.circles.is_empty());
        for c in &r.circles {
            assert!(c.center_error <= 0.5, "{id} centre {}", c.center_error);
            assert!(c.radius_error.abs() <= 0.5, "{id} radius {}", c.radius_error);
            assert!(c.radial.rms <= 0.25, "{id} RMS {}", c.radial.rms);
            assert!(c.radial.max_abs <= 0.75, "{id} max {}", c.radial.max_abs);
        }
        assert_eq!(r.smooth_join_breaks, 0, "{id}: {} tangent breaks", r.smooth_join_breaks);
        assert!(topology(&f, &to_svg(&out.scene).unwrap(), 4).preserved, "{id} topology");
        // Both exporters carry exactly the validated scene's coordinates.
        let coords: Vec<f64> = out
            .scene
            .groups
            .iter()
            .flat_map(|g| g.paths.iter().flat_map(|p| p.coords.clone()))
            .collect();
        assert_eq!(
            common::exports::svg_coords(&to_svg(&out.scene).unwrap()),
            coords,
            "{id} SVG"
        );
        let pdf = to_pdf(
            &out.scene,
            &PdfOptions {
                width: 200.0,
                unit: Unit::Mm,
                dpi: None,
            },
        )
        .unwrap();
        assert!(common::exports::pdf_matches(&pdf, &out.scene), "{id} PDF");
    }
}

#[test]
fn public_setting_equals_the_evaluated_configuration_and_is_deterministic() {
    let f = find("04-color-discs");
    let a = trace(&f);
    let b = trace(&f);
    assert_eq!(a.scene, b.scene);
    let mut settings: serde_json::Value = serde_json::from_str(&f.settings).unwrap();
    settings["fit"] = serde_json::json!({"mode": "precision", "cornerThreshold": 60});
    let req =
        TraceRequest::from_json(&serde_json::json!({"presetVersion": 1, "seed": 1, "settings": settings}).to_string())
            .unwrap();
    let c = vector_engine::vectorize_with_precision_options(&f.rgba, 256, 256, &req, &|| 0.0, Options::production(60))
        .unwrap();
    assert_eq!(to_svg(&a.scene).unwrap(), to_svg(&c.scene).unwrap());
}

#[test]
fn negative_controls_are_followed_not_idealised() {
    let luma = Luma::new();
    for id in ["hand-drawn-circle", "rough-ink", "asymmetric-egg", "hand-drawn-hole"] {
        let f = find(id);
        let out = trace(&f);
        let r = evaluate(&f.truth(0.05), &out.scene, f.w, f.h);
        assert!(
            r.organic.rms <= 0.25 && r.organic.max_abs <= 0.75,
            "{id}: {:?}",
            r.organic
        );
        // No section of a deliberately irregular outline is replaced by a recognised circle.
        let layers = vector_engine::segment_layers(&f.rgba, f.w as u32, f.h as u32, &precision_request(&f)).unwrap();
        let img = RgbaImage::new(&f.rgba, f.w as u32, f.h as u32, 1 << 24).unwrap();
        let policy = if f.settings.contains("\"bw\"") {
            EdgePolicy::Luma {
                threshold: 128,
                invert: false,
                alpha_threshold: 128,
            }
        } else {
            EdgePolicy::Color { alpha_threshold: 128 }
        };
        let o = Options::production(60);
        let field = Field::new(img, &luma, policy, o.subpixel, layers.iter().map(|l| l.1.clone()));
        let recognised: usize = layers
            .iter()
            .flat_map(|(_, m)| precision::contours(&field, m))
            .filter_map(|c| precision::fit_contour(&c, &o))
            .map(|l| l.recognised)
            .sum();
        assert_eq!(recognised, 0, "{id}");
    }
}

#[test]
fn holes_rings_and_small_components_survive() {
    for id in ["ring-bw", "ring-alpha", "compound-holes", "concentric"] {
        let f = find(id);
        let t = topology(&f, &to_svg(&trace(&f).scene).unwrap(), 4);
        assert!(t.preserved, "{id}: {t:?}");
    }
    // A 1 px hole in an 8×8 square and a 1 px blob, speckle 0: every loop is kept.
    let w = 16usize;
    let mut ink = vec![false; w * w];
    for y in 4..12 {
        for x in 4..12 {
            ink[y * w + x] = !(x == 8 && y == 8);
        }
    }
    ink[14 * w + 1] = true;
    let rgba: Vec<u8> = ink
        .iter()
        .flat_map(|&b| if b { [0, 0, 0, 255] } else { [255, 255, 255, 255] })
        .collect();
    let req = TraceRequest::from_json(
        r#"{"presetVersion":1,"settings":{"mode":"bw","speckle":0,"fit":{"mode":"precision"}}}"#,
    )
    .unwrap();
    let out = vector_engine::vectorize(&rgba, w as u32, w as u32, &req, &|| 0.0).unwrap();
    let loops: usize = out.scene.groups[0]
        .paths
        .iter()
        .map(|p| p.verbs.matches('M').count())
        .sum();
    assert_eq!(loops, 3, "outer square, its 1 px hole and the 1 px blob");
}
