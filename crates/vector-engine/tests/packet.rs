//! G-ENG acceptance (contracts C3, C4): GeometryPacket conformance, lossless Scene ↔ Packet,
//! byte serialisation, staged API identity, export baking, and the public-API boundary.
//! The full photographic corpus is covered by `examples/packet_regression.rs` (local inputs).
#[path = "common/fixtures.rs"]
mod fixtures;

use serde_json::Value;
use vector_engine::bake::{DrawList, IDENTITY, bake_draw_list, identity_draw_list};
use vector_engine::packet::{GeometryPacket, Limits, SceneMeta, parse_manifest, validate_packet};
use vector_engine::params::TraceRequest;
use vector_engine::pdf::{PdfOptions, Unit, to_pdf};
use vector_engine::scene::Scene;
use vector_engine::svg::to_svg;
use vector_engine::{Estimate, estimate, fit, segment, vectorize};

/// The modes `regression_corpus` traces each procedural fixture with.
const MODES: [&str; 6] = [
    r#"{"mode":"bw"}"#,
    r#"{"mode":"color"}"#,
    r#"{"mode":"color","compositing":"mosaic"}"#,
    r#"{"mode":"limited","colors":6}"#,
    r#"{"mode":"halftone"}"#,
    r#"{"mode":"halftone","paper":null,"pitch":6}"#,
];

fn request(settings: &str) -> TraceRequest {
    TraceRequest::from_json(&format!(
        r#"{{"presetVersion":1,"seed":1,"maxPixels":50000000,"settings":{settings}}}"#
    ))
    .unwrap()
}

fn pdf(scene: &Scene) -> Vec<u8> {
    to_pdf(
        scene,
        &PdfOptions {
            width: 200.0,
            unit: Unit::Mm,
            dpi: None,
        },
    )
    .unwrap()
}

/// Every procedural fixture × mode, plus a scene with strokes, translucency and nonzero fills.
fn corpus() -> Vec<(String, Scene)> {
    let mut out = Vec::new();
    for f in fixtures::all() {
        for settings in MODES {
            let req = request(settings);
            if let Ok(o) = vectorize(&f.rgba, f.width as u32, f.height as u32, &req, &|| 0.0) {
                out.push((format!("{} {settings}", f.id), o.scene));
            }
        }
    }
    out.push(("translucent".into(), fixtures::translucent_scene()));
    out
}

#[test]
fn scene_packet_scene_is_lossless_and_exports_are_identical() {
    let corpus = corpus();
    assert!(corpus.len() > 60, "corpus too small: {}", corpus.len());
    for (name, scene) in &corpus {
        let packet = GeometryPacket::from_scene(scene).unwrap();
        let derived = validate_packet(&packet, &Limits::ENGINEERING).unwrap();
        let stats = scene.validate(5_000_000).unwrap();
        assert_eq!(u64::from(derived.anchors), stats.anchors, "{name}: anchors");
        assert_eq!(
            derived.path_anchors.iter().map(|a| u64::from(*a)).sum::<u64>(),
            stats.anchors
        );
        assert_eq!(derived.subpath_start.len() as u64, stats.subpaths, "{name}: subpaths");
        let meta = SceneMeta::from_scene(scene);
        let back = Scene::from_packet(&packet, &meta).unwrap();
        assert_eq!(&back, scene, "{name}: structural round trip");
        assert_eq!(back.to_json(), scene.to_json(), "{name}: JSON bytes");
        assert_eq!(to_svg(&back).unwrap(), to_svg(scene).unwrap(), "{name}: SVG");
        assert_eq!(pdf(&back), pdf(scene), "{name}: PDF");

        // C3.0 bytes: exact length, round trip, padding = 8 + (-V mod 8).
        let bytes = packet.to_bytes();
        let v = u64::from(packet.manifest.verb_count);
        let mem = packet.verbs.len()
            + 8 * packet.coords.len()
            + 4 * (packet.verb_offsets.len() * 2)
            + 8 * packet.style_index.len();
        assert_eq!(bytes.len() as u64 - mem as u64, 8 + (8 - v % 8) % 8, "{name}: padding");
        let decoded = GeometryPacket::from_bytes(packet.manifest.clone(), &bytes, &Limits::ENGINEERING).unwrap();
        assert_eq!(decoded, packet, "{name}: bytes round trip");

        // Unedited P0 route through the export bake.
        let baked = bake_draw_list(
            &identity_draw_list(&packet, 0),
            std::slice::from_ref(&packet),
            &meta,
            &Limits::ENGINEERING,
        )
        .unwrap();
        assert_eq!(baked.to_json(), scene.to_json(), "{name}: identity bake");
    }
}

#[test]
fn staged_fit_of_segment_equals_vectorize() {
    for f in fixtures::all() {
        for settings in MODES {
            let req = request(settings);
            let direct = vectorize(&f.rgba, f.width as u32, f.height as u32, &req, &|| 0.0);
            let staged = segment(&f.rgba, f.width as u32, f.height as u32, &req, &|| 0.0).and_then(|s| fit(s, &|| 0.0));
            match (direct, staged) {
                (Ok(a), Ok(b)) => {
                    assert_eq!(a.scene.to_json(), b.scene.to_json(), "{} {settings}", f.id);
                    let w = |o: &vector_engine::Output| o.warnings.iter().map(|w| w.code).collect::<Vec<_>>();
                    assert_eq!(w(&a), w(&b));
                }
                (Err(a), Err(b)) => assert_eq!(a, b),
                (a, b) => panic!("{} {settings}: {:?} vs {:?}", f.id, a.is_ok(), b.is_ok()),
            }
        }
    }
}

#[test]
fn estimates_are_ranges_only_where_calibrated() {
    let f = fixtures::all().into_iter().find(|f| f.id == "adjacent_colors").unwrap();
    for (settings, calibrated) in [
        (r#"{"mode":"bw"}"#, true),
        (r#"{"mode":"color"}"#, true),
        (r#"{"mode":"color","fit":{"mode":"precision"}}"#, false),
        (r#"{"mode":"limited","colors":6}"#, false),
        (r#"{"mode":"halftone"}"#, false),
    ] {
        let seg = segment(&f.rgba, f.width as u32, f.height as u32, &request(settings), &|| 0.0).unwrap();
        match estimate(&seg) {
            Estimate::Range {
                anchors_low,
                anchors_high,
                ..
            } => {
                assert!(calibrated, "{settings}");
                assert!(anchors_low <= anchors_high && anchors_high > 0, "{settings}");
            }
            Estimate::Unavailable { reason } => assert!(!calibrated && !reason.is_empty(), "{settings}"),
        }
    }
}

#[test]
fn bake_applies_transforms_in_f64_and_rejects_distorted_strokes() {
    let scene = fixtures::translucent_scene();
    let packet = GeometryPacket::from_scene(&scene).unwrap();
    let meta = SceneMeta::from_scene(&scene);
    let mut list = identity_draw_list(&packet, 0);
    let t = [2.0, 0.0, 0.0, 2.0, 3.5, -1.25];
    for item in &mut list.items {
        item.transform = t;
    }
    let baked = bake_draw_list(&list, std::slice::from_ref(&packet), &meta, &Limits::ENGINEERING).unwrap();
    for (g0, g1) in scene.groups.iter().zip(&baked.groups) {
        for (p0, p1) in g0.paths.iter().zip(&g1.paths) {
            for (xy0, xy1) in p0.coords.chunks_exact(2).zip(p1.coords.chunks_exact(2)) {
                assert_eq!(xy1[0], 2.0 * xy0[0] + 3.5);
                assert_eq!(xy1[1], 2.0 * xy0[1] - 1.25);
            }
            if let (Some(s0), Some(s1)) = (&p0.stroke, &p1.stroke) {
                assert_eq!(s1.width, s0.width * 2.0, "uniform scale scales stroke width");
            }
        }
    }
    let stroked = list
        .items
        .iter()
        .position(|i| i.stroke.is_some())
        .expect("fixture has a stroke");
    let mut skew = list.clone();
    skew.items[stroked].transform = [1.0, 0.0, 0.5, 1.0, 0.0, 0.0];
    assert!(bake_draw_list(&skew, std::slice::from_ref(&packet), &meta, &Limits::ENGINEERING).is_err());
    let mut unordered = identity_draw_list(&packet, 0);
    if unordered.runs.len() > 1 {
        unordered.items.last_mut().unwrap().group_run = 0;
        assert!(bake_draw_list(&unordered, std::slice::from_ref(&packet), &meta, &Limits::ENGINEERING).is_err());
    }
    let missing = DrawList {
        items: vec![vector_engine::bake::DrawItem {
            chunk: 3,
            path_index: 0,
            transform: IDENTITY,
            fill: Some(0xff),
            palette_id: None,
            stroke: None,
            even_odd: false,
            group_run: 0,
        }],
        ..identity_draw_list(&packet, 0)
    };
    assert!(bake_draw_list(&missing, &[packet], &meta, &Limits::ENGINEERING).is_err());
}

// ---- Shared conformance fixtures (tests/fixtures/packet-conformance) ----

fn limits_of(case: &Value) -> Limits {
    match case.get("limits") {
        Some(l) => Limits {
            max_paths: l["maxPaths"].as_u64().unwrap(),
            max_anchors: l["maxAnchors"].as_u64().unwrap(),
            max_bytes: l["maxBytes"].as_u64().unwrap(),
        },
        None => Limits::PRODUCT,
    }
}

fn numbers<T>(v: &Value, f: impl Fn(&Value) -> T) -> Vec<T> {
    v.as_array().unwrap().iter().map(f).collect()
}

fn coord(v: &Value) -> f64 {
    match v {
        Value::String(s) if s == "NaN" => f64::NAN,
        Value::String(s) if s == "Infinity" => f64::INFINITY,
        Value::String(s) if s == "-Infinity" => f64::NEG_INFINITY,
        v => v.as_f64().unwrap(),
    }
}

fn run_case(case: &Value) -> Result<vector_engine::Derived, String> {
    let limits = limits_of(case);
    let manifest = parse_manifest(&case["manifest"], &limits).map_err(|e| e.code.as_str().to_string())?;
    let packet = match case["kind"].as_str().unwrap() {
        "manifest" => return Err("ok-manifest".into()),
        "bytes" => {
            let hex = case["blockHex"].as_str().unwrap();
            let bytes: Vec<u8> = (0..hex.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
                .collect();
            let p = GeometryPacket::from_bytes(manifest, &bytes, &limits).map_err(|e| e.code.as_str().to_string())?;
            if case["expect"] == "ok" {
                assert_eq!(
                    p.to_bytes(),
                    bytes,
                    "{}: Rust re-encoding equals the shared bytes",
                    case["id"]
                );
            }
            p
        }
        _ => {
            let a = &case["arrays"];
            let u32s = |k: &str| numbers(&a[k], |v| v.as_u64().unwrap() as u32);
            GeometryPacket {
                manifest,
                verbs: numbers(&a["verbs"], |v| v.as_u64().unwrap() as u8),
                coords: numbers(&a["coords"], coord),
                verb_offsets: u32s("verbOffsets"),
                coord_offsets: u32s("coordOffsets"),
                style_index: u32s("styleIndex"),
                group_index: u32s("groupIndex"),
            }
        }
    };
    validate_packet(&packet, &limits).map_err(|e| e.code.as_str().to_string())
}

#[test]
fn conformance_fixtures_return_the_expected_codes() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/fixtures/packet-conformance/cases.json"
    );
    let suite: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let cases = suite["cases"].as_array().unwrap();
    let mut ran = 0;
    for case in cases {
        if case.get("tsOnly").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        ran += 1;
        let id = case["id"].as_str().unwrap();
        let expect = case["expect"].as_str().unwrap();
        match (run_case(case), expect) {
            (Ok(d), "ok") => {
                let want = &case["derived"];
                assert_eq!(u64::from(d.anchors), want["anchors"].as_u64().unwrap(), "{id}");
                assert_eq!(
                    d.path_anchors,
                    numbers(&want["pathAnchors"], |v| v.as_u64().unwrap() as u32),
                    "{id}"
                );
                assert_eq!(
                    d.subpath_start,
                    numbers(&want["subpathStart"], |v| v.as_u64().unwrap() as u32),
                    "{id}"
                );
                assert_eq!(d.bounds, numbers(&want["bounds"], |v| v.as_f64().unwrap()), "{id}");
            }
            (Err(code), want) if code == want => {}
            (Err(code), want) if code == "ok-manifest" && want == "ok" => {}
            (got, want) => panic!("{id}: expected {want}, got {:?}", got.map(|_| "ok")),
        }
    }
    assert!(ran >= 40, "only {ran} cases ran");
}

#[test]
fn no_tracer_type_crosses_the_public_api() {
    // TD-ARCH-001: VTracer and visioncortex are confined to the private `trace` module.
    let src = concat!(env!("CARGO_MANIFEST_DIR"), "/src");
    for entry in std::fs::read_dir(src).unwrap() {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let text = std::fs::read_to_string(&path).unwrap();
        if name != "trace.rs" {
            assert!(
                !text.contains("vtracer::") && !text.contains("visioncortex::"),
                "{name} references a tracer crate"
            );
        }
        if name == "lib.rs" {
            assert!(text.contains("\nmod trace;"), "trace must stay private");
            assert!(!text.contains("pub use trace"), "no re-export from trace");
        }
    }
}
