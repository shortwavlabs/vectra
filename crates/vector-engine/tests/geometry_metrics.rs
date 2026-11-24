//! P0-R-GEO metric validation: the geometric-fidelity metrics must detect visible defects
//! (kinks, flattened arcs, occlusion handling, lost holes) and must not reward node count.
mod common;

use common::corpus;
use common::geometry::{self, GeoFixture, evaluate, topology};
use vector_engine::color::Rgba;
use vector_engine::params::TraceRequest;
use vector_engine::scene::{Fill, FillRule, Group, Metadata, Path, SCENE_VERSION, Scene};
use vector_engine::svg::to_svg;

const KAPPA: f64 = 0.552_284_749_830_793_4;

fn fixture(id: &str) -> GeoFixture {
    corpus::all().into_iter().find(|f| f.id == id).unwrap()
}

/// Analytic circle as `pieces` cubic arcs; `edit` may alter the coordinates.
fn circle_path(c: [f64; 2], r: f64, pieces: usize, edit: impl Fn(usize, &mut [f64; 6])) -> Path {
    let mut verbs = String::from("M");
    let mut coords = vec![c[0] + r, c[1]];
    let step = std::f64::consts::TAU / pieces as f64;
    let k = 4.0 / 3.0 * (step / 4.0).tan() * r;
    for i in 0..pieces {
        let (a0, a1) = (step * i as f64, step * (i + 1) as f64);
        let p0 = [c[0] + r * a0.cos(), c[1] + r * a0.sin()];
        let p1 = [c[0] + r * a1.cos(), c[1] + r * a1.sin()];
        let mut seg = [
            p0[0] - k * a0.sin(),
            p0[1] + k * a0.cos(),
            p1[0] + k * a1.sin(),
            p1[1] - k * a1.cos(),
            p1[0],
            p1[1],
        ];
        edit(i, &mut seg);
        verbs.push('C');
        coords.extend_from_slice(&seg);
    }
    verbs.push('Z');
    let _ = KAPPA;
    Path {
        fill: Some(Fill {
            color: Rgba::BLACK,
            palette_id: None,
        }),
        stroke: None,
        fill_rule: FillRule::Evenodd,
        verbs,
        coords,
    }
}

fn scene(w: f64, h: f64, paths: Vec<Path>) -> Scene {
    Scene {
        version: SCENE_VERSION,
        width: w,
        height: h,
        background: None,
        palette: vec![],
        groups: vec![Group {
            id: "g".into(),
            clip: None,
            paths,
        }],
        metadata: Metadata {
            generator: "test".into(),
            engine_version: "0".into(),
            mode: "bw".into(),
            preset_version: 1,
            seed: 0,
            source_width: w as u32,
            source_height: h as u32,
            params: serde_json::Value::Null,
        },
    }
}

#[test]
fn ideal_circle_scores_near_zero_and_kinks_and_flattening_are_detected() {
    let f = fixture("circle-r40-frac");
    let truth = f.truth(0.05);
    let (c, r) = ([128.3, 127.6], 40.0);

    let ideal = evaluate(
        &truth,
        &scene(256.0, 256.0, vec![circle_path(c, r, 8, |_, _| {})]),
        256,
        256,
    );
    let circ = &ideal.circles[0];
    assert!(circ.radial.max_abs < 0.002, "{:?}", circ.radial);
    assert!(circ.center_error < 1e-3 && circ.radius_error.abs() < 1e-3);
    assert!(circ.curvature.max_abs < 0.01, "{:?}", circ.curvature);
    assert_eq!(ideal.smooth_join_breaks, 0);
    assert!(
        ideal
            .loops
            .iter()
            .any(|l| l.area_error_rel.abs() < 1e-3 && l.eccentricity_error.abs() < 0.02)
    );

    // One handle turned by 10°: a visible kink that IoU barely notices.
    let kinked = scene(
        256.0,
        256.0,
        vec![circle_path(c, r, 8, |i, s| {
            if i == 2 {
                let (dx, dy) = (s[2] - s[4], s[3] - s[5]);
                let (sn, cs) = 10f64.to_radians().sin_cos();
                s[2] = s[4] + dx * cs - dy * sn;
                s[3] = s[5] + dx * sn + dy * cs;
            }
        })],
    );
    let k = evaluate(&truth, &kinked, 256, 256);
    assert!(k.smooth_join_breaks >= 1 && k.max_smooth_join_angle_deg > 9.0, "{k:?}");

    // One arc with handles shortened to 60 %: a flattened section.
    let flat = scene(
        256.0,
        256.0,
        vec![circle_path(c, r, 8, |i, s| {
            if i == 5 {
                let p0 = [
                    c[0] + r * (5.0 * std::f64::consts::TAU / 8.0).cos(),
                    c[1] + r * (5.0 * std::f64::consts::TAU / 8.0).sin(),
                ];
                s[0] = p0[0] + (s[0] - p0[0]) * 0.6;
                s[1] = p0[1] + (s[1] - p0[1]) * 0.6;
                s[2] = s[4] + (s[2] - s[4]) * 0.6;
                s[3] = s[5] + (s[3] - s[5]) * 0.6;
            }
        })],
    );
    let fl = evaluate(&truth, &flat, 256, 256);
    assert!(fl.circles[0].curvature.max_abs > 0.3, "{:?}", fl.circles[0].curvature);
    assert!(fl.circles[0].radial.max_abs > 0.3);
    let t = topology(&f, &to_svg(&flat).unwrap(), 4);
    assert!(t.iou > 0.99, "IoU {} would hide the flattening", t.iou);
}

#[test]
fn more_nodes_are_not_rewarded() {
    // Pixel fitting has many more anchors than spline fitting but follows the staircase.
    let f = fixture("circle-r40-frac");
    let truth = f.truth(0.05);
    let run = |fit: &str| {
        let req = TraceRequest::from_json(&format!(
            r#"{{"presetVersion":1,"settings":{{"mode":"bw","fit":{{"mode":"{fit}"}}}}}}"#
        ))
        .unwrap();
        let out = vector_engine::vectorize(&f.rgba, 256, 256, &req, &|| 0.0).unwrap();
        (out.metrics.stats.anchors, evaluate(&truth, &out.scene, 256, 256))
    };
    let (a_px, px) = run("pixel");
    let (a_sp, sp) = run("spline");
    assert!(a_px > 4 * a_sp, "pixel {a_px} vs spline {a_sp} anchors");
    assert!(
        px.circles[0].radial.rms > 0.2 && px.smooth_join_breaks > 10,
        "{:?}",
        px.circles[0].radial
    );
    assert!(sp.circles[0].radial.rms > 0.0);
}

#[test]
fn occluded_arcs_are_not_ground_truth_and_lost_holes_are_detected() {
    // Two discs r=50 with centres 70 apart: the hidden part of the first disc is the arc inside
    // the second, 2·acos(35/50) of the circumference.
    let f = fixture("discs-two-wide");
    let truth = f.truth(0.05);
    let first = truth
        .prims
        .iter()
        .position(|p| matches!(p, geometry::Prim::Circle { r, .. } if *r == 50.0))
        .unwrap();
    let n = truth.samples.iter().filter(|s| s.prim == first).count() as f64;
    let visible = n / (std::f64::consts::TAU * 50.0 / 0.05).ceil();
    let expect = 1.0 - 2.0 * (35.0f64 / 50.0).acos() / std::f64::consts::TAU;
    assert!((visible - expect).abs() < 0.01, "{visible} vs {expect}");
    assert_eq!(truth.corners.len(), 2, "two visible junctions");

    // A ring traced without its hole fails topology.
    let ring = fixture("ring-bw");
    let solid = scene(256.0, 256.0, vec![circle_path([128.0, 128.0], 62.0, 8, |_, _| {})]);
    let t = topology(&ring, &to_svg(&solid).unwrap(), 2);
    assert!(!t.preserved, "{t:?}");
    let with_hole = {
        let mut outer = circle_path([128.0, 128.0], 62.0, 8, |_, _| {});
        let inner = circle_path([128.0, 128.0], 50.0, 8, |_, _| {});
        outer.verbs.push_str(&inner.verbs);
        outer.coords.extend(inner.coords);
        scene(256.0, 256.0, vec![outer])
    };
    assert!(topology(&ring, &to_svg(&with_hole).unwrap(), 2).preserved);
}
