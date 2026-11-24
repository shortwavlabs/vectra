//! P0-R-GEO owner acceptance bundle v2 (docs/research/p0-r-geo/owner-acceptance-bundle-v2/).
//!
//! For each geometric case: the source PNG, the P0 result (spline, the bundle-v1 settings) and
//! the corrected result (`fit.mode = "precision"`), as SVG and PDF (200 mm wide), with settings,
//! algorithm versions, scene metrics, geometric metrics and SHA-256 per file in MANIFEST.json.
//! Photographic and Old Print cases are not duplicated: the v1 files are re-traced and their
//! byte identity is recorded. Renders: a contact sheet (source | P0 | corrected, plus a 16×
//! boundary detail with contour overlays) and per-case detail overlays.
//!
//! Usage: cargo run --release -p vector-engine --example geo_bundle -- [out-dir]
#[path = "../tests/common/corpus.rs"]
mod corpus;
#[path = "../tests/common/fixtures.rs"]
mod fixtures;
#[path = "../tests/common/geometry.rs"]
mod geometry;
#[path = "../tests/common/render.rs"]
mod render;

use std::fs::File;
use std::process::Command;

use geometry::{GeoFixture, Report, evaluate};
use resvg::tiny_skia as sk;
use serde_json::{Value, json};
use vector_engine::params::TraceRequest;
use vector_engine::pdf::{PdfOptions, Unit, to_pdf};
use vector_engine::precision::PRECISION_FIT_VERSION;
use vector_engine::svg::to_svg;

const V1: &str = "docs/research/p0-r/owner-acceptance-bundle";

fn sha256(path: &str) -> String {
    let out = Command::new("shasum")
        .args(["-a", "256", path])
        .output()
        .expect("shasum");
    String::from_utf8_lossy(&out.stdout)
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_string()
}

fn write_png_rgba(path: &str, rgba: &[u8], w: usize, h: usize) {
    let mut enc = png::Encoder::new(std::io::BufWriter::new(File::create(path).unwrap()), w as u32, h as u32);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    enc.set_compression(png::Compression::High);
    enc.write_header().unwrap().write_image_data(rgba).unwrap();
}

fn request(settings: &Value) -> TraceRequest {
    TraceRequest::from_json(
        &json!({"presetVersion": 1, "seed": 1, "maxPixels": 12000000, "maxAnchors": 1000000, "settings": settings})
            .to_string(),
    )
    .unwrap()
}

fn summary(r: &Report) -> Value {
    json!({
        "contourRmsPx": r.contour_smooth.rms,
        "contourMaxPx": r.contour_smooth.max_abs,
        "tangentBreaks": r.smooth_join_breaks,
        "circles": r.circles.iter().map(|c| json!({
            "radius": c.true_radius,
            "visibleFraction": c.visible_fraction,
            "centreErrorPx": c.center_error,
            "radiusErrorPx": c.radius_error,
            "radialRmsPx": c.radial.rms,
            "radialMaxPx": c.radial.max_abs,
            "curvatureRms": c.curvature.rms,
            "curvatureMax": c.curvature.max_abs,
        })).collect::<Vec<_>>(),
        "organicRmsPx": (r.organic.n > 0).then_some(r.organic.rms),
        "organicMaxPx": (r.organic.n > 0).then_some(r.organic.max_abs),
    })
}

struct Case {
    id: &'static str,
    fixture: &'static str,
    check: &'static str,
    /// Crop (x, y, size) for the 16× boundary detail.
    detail: [f64; 3],
}

fn main() {
    let dir = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "docs/research/p0-r-geo/owner-acceptance-bundle-v2".into());
    std::fs::create_dir_all(format!("{dir}/sources")).unwrap();
    std::fs::create_dir_all(format!("{dir}/renders")).unwrap();
    let cases = [
        Case {
            id: "04-color-discs",
            fixture: "04-color-discs",
            check: "DEF-GEO-002: three overlapping discs; arcs round and even, junctions clean",
            detail: [104.0, 46.0, 28.0],
        },
        Case {
            id: "05-color-transparent-hole",
            fixture: "05-color-transparent-hole",
            check: "DEF-GEO-001: transparent hole is a clean symmetric circle (4 cubics)",
            detail: [104.0, 76.0, 48.0],
        },
        Case {
            id: "10-transparent-ring",
            fixture: "ring-alpha",
            check: "Transparent ring: both circles round, hole see-through",
            detail: [180.0, 118.0, 24.0],
        },
        Case {
            id: "11-circle-r40",
            fixture: "circle-r40-frac",
            check: "Standalone circle r=40 at a fractional centre",
            detail: [158.0, 116.0, 24.0],
        },
        Case {
            id: "12-circle-r100",
            fixture: "circle-r100",
            check: "Large circle r=100",
            detail: [216.0, 116.0, 24.0],
        },
        Case {
            id: "13-circle-r15.7",
            fixture: "h-circle-r15.7",
            check: "Small circle r=15.7 (held-out)",
            detail: [28.0, 20.0, 40.0],
        },
        Case {
            id: "14-ellipse-4to1-rot30",
            fixture: "ellipse-4to1-rot30",
            check: "Rotated 4:1 ellipse: smooth, even curvature, pointed ends not kinked",
            detail: [190.0, 150.0, 28.0],
        },
        Case {
            id: "15-ellipse-3to1-rot63",
            fixture: "h-ellipse-3to1-rot63",
            check: "Rotated 3:1 ellipse (held-out)",
            detail: [150.0, 150.0, 28.0],
        },
        Case {
            id: "16-roundrect",
            fixture: "roundrect",
            check: "Rounded rectangle: straight sides are lines, corners are round",
            detail: [190.0, 160.0, 28.0],
        },
        Case {
            id: "17-roundrect-rot12",
            fixture: "h-roundrect-rot12",
            check: "Rotated rounded rectangle (held-out)",
            detail: [180.0, 120.0, 28.0],
        },
        Case {
            id: "18-star",
            fixture: "star",
            check: "Five-point star: straight edges, sharp tips",
            detail: [114.0, 14.0, 28.0],
        },
        Case {
            id: "19-star-rot17",
            fixture: "h-star-rot17",
            check: "Rotated star (held-out)",
            detail: [118.0, 14.0, 28.0],
        },
        Case {
            id: "20-overlap-rect-disc-square",
            fixture: "adjacent-overlap",
            check: "Overlapping rectangle, disc and rotated square: shared edges, no gaps or slivers",
            detail: [130.0, 70.0, 28.0],
        },
        Case {
            id: "21-discs-three",
            fixture: "h-discs-three",
            check: "Three overlapping discs at other angles (held-out)",
            detail: [120.0, 120.0, 28.0],
        },
        Case {
            id: "22-discs-deep",
            fixture: "discs-two-deep",
            check: "Deep overlap of two discs",
            detail: [114.0, 66.0, 28.0],
        },
        Case {
            id: "30-hand-drawn-circle",
            fixture: "hand-drawn-circle",
            check: "Negative control: the wobble must be kept, not made round",
            detail: [176.0, 116.0, 24.0],
        },
        Case {
            id: "31-rough-ink",
            fixture: "rough-ink",
            check: "Negative control: rough edge kept",
            detail: [186.0, 116.0, 24.0],
        },
        Case {
            id: "32-organic-blob",
            fixture: "organic-blob",
            check: "Negative control: organic silhouette kept",
            detail: [176.0, 100.0, 28.0],
        },
    ];
    let all: Vec<GeoFixture> = corpus::all().into_iter().chain(corpus::rejected()).collect();
    let mut manifest = Vec::new();
    // Contact sheet: per row source | P0 | corrected | 16× detail (corrected, with overlays).
    let tile = 220u32;
    let mut sheet = sk::Pixmap::new(tile * 4 + 50, tile * cases.len() as u32 + 10).unwrap();
    sheet.fill(sk::Color::from_rgba8(250, 250, 250, 255));
    let mut html_rows = String::new();
    for (row, c) in cases.iter().enumerate() {
        let f = all.iter().find(|f| f.id == c.fixture).unwrap();
        let src = format!("sources/{}.png", c.id);
        write_png_rgba(&format!("{dir}/{src}"), &f.rgba, f.w, f.h);
        let before_settings: Value = if c.id.starts_with("04") || c.id.starts_with("05") {
            let m: Value =
                serde_json::from_str(&std::fs::read_to_string(format!("{V1}/MANIFEST.json")).unwrap()).unwrap();
            let e = m
                .as_array()
                .unwrap()
                .iter()
                .find(|e| e["file"].as_str().unwrap().starts_with(c.id))
                .unwrap()
                .clone();
            e["settings"]["settings"].clone()
        } else {
            serde_json::from_str(&f.settings).unwrap()
        };
        let mut after_settings = before_settings.clone();
        after_settings["fit"] = json!({"mode": "precision", "cornerThreshold": 60, "lengthThreshold": 4, "spliceThreshold": 45, "simplify": 0});
        let truth = f.truth(0.05);
        let mut row_json = json!({"case": c.id, "check": c.check, "source": src, "sourceFixture": c.fixture, "set": f.set, "analytic": f.description});
        let mut tiles = Vec::new();
        for (tag, settings) in [
            ("p0-spline", &before_settings),
            ("corrected-precision", &after_settings),
        ] {
            let out = vector_engine::vectorize(&f.rgba, f.w as u32, f.h as u32, &request(settings), &|| 0.0).unwrap();
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
            let stem = format!("{}-{tag}", c.id);
            std::fs::write(format!("{dir}/{stem}.svg"), &svg).unwrap();
            std::fs::write(format!("{dir}/{stem}.pdf"), &pdf).unwrap();
            let st = out.metrics.stats;
            row_json[tag] = json!({
                "settings": settings,
                "algorithm": if tag == "p0-spline" { json!({"engine": vector_engine::ENGINE_VERSION, "fit": "VTracer 1.0.0-alpha.4 spline"}) } else { json!({"engine": vector_engine::ENGINE_VERSION, "fit": "Vectra precision", "precisionFitVersion": PRECISION_FIT_VERSION}) },
                "svg": format!("{stem}.svg"),
                "pdf": format!("{stem}.pdf"),
                "svgSha256": sha256(&format!("{dir}/{stem}.svg")),
                "pdfSha256": sha256(&format!("{dir}/{stem}.pdf")),
                "svgBytes": svg.len(),
                "pdfBytes": pdf.len(),
                "scene": {"paths": st.paths, "subpaths": st.subpaths, "anchors": st.anchors, "cubics": st.cubics, "lines": st.lines},
                "geometry": summary(&evaluate(&truth, &out.scene, f.w, f.h)),
            });
            tiles.push((svg, out.scene));
        }
        if c.id.starts_with("04") || c.id.starts_with("05") {
            let v1 = std::fs::read_to_string(format!("{V1}/{}.svg", c.id)).unwrap();
            row_json["p0IdenticalToBundleV1"] = json!(v1 == tiles[0].0);
        }
        // Contact-sheet row.
        let y = 5 + row as u32 * tile;
        let fit = |w: usize, h: usize| (tile as f32 - 20.0) / w.max(h) as f32;
        let z = fit(f.w, f.h);
        let crop = [0.0, 0.0, f.w as f64, f.h as f64];
        let (src_pm, _) = render::source(f, crop, z);
        sheet.draw_pixmap(
            10,
            y as i32 + 10,
            src_pm.as_ref(),
            &sk::PixmapPaint::default(),
            sk::Transform::identity(),
            None,
        );
        for (k, (svg, _)) in tiles.iter().enumerate() {
            let pm = render::rendered(svg, f, crop, z);
            sheet.draw_pixmap(
                10 + (k as i32 + 1) * tile as i32,
                y as i32 + 10,
                pm.as_ref(),
                &sk::PixmapPaint::default(),
                sk::Transform::identity(),
                None,
            );
        }
        let d = c.detail;
        let dz = (tile as f32 - 20.0) / d[2] as f32;
        let (mut det, t) = render::source(f, [d[0], d[1], d[2], d[2]], dz);
        render::truth_overlay(&mut det, t, &truth);
        render::scene_overlay(&mut det, t, &tiles[1].1, true);
        sheet.draw_pixmap(
            10 + 3 * tile as i32,
            y as i32 + 10,
            det.as_ref(),
            &sk::PixmapPaint::default(),
            sk::Transform::identity(),
            None,
        );
        // Per-case 16× detail renders: P0 and corrected outlines over the source.
        for (k, tag) in ["p0-spline", "corrected-precision"].iter().enumerate() {
            let (mut pm, t) = render::source(f, [d[0], d[1], d[2], d[2]], 16.0);
            render::truth_overlay(&mut pm, t, &truth);
            render::scene_overlay(&mut pm, t, &tiles[k].1, true);
            render::write_png(&format!("{dir}/renders/{}-{tag}-detail-16x.png", c.id), &pm);
        }
        html_rows.push_str(&format!(
            "<tr><td><b>{id}</b><br>{check}<br><small>{fx} ({set})</small></td><td><img src=\"{src}\"></td><td><img src=\"{id}-p0-spline.svg\"></td><td><img src=\"{id}-corrected-precision.svg\"></td><td><a href=\"renders/{id}-p0-spline-detail-16x.png\"><img class=d src=\"renders/{id}-p0-spline-detail-16x.png\"></a></td><td><a href=\"renders/{id}-corrected-precision-detail-16x.png\"><img class=d src=\"renders/{id}-corrected-precision-detail-16x.png\"></a></td></tr>\n",
            id = c.id,
            check = c.check,
            fx = c.fixture,
            set = f.set,
        ));
        manifest.push(row_json);
        eprintln!("{}", c.id);
    }
    render::write_png(&format!("{dir}/contact-sheet.png"), &sheet);

    // Photographic and Old Print regression: re-trace the v1 cases; record byte identity.
    let v1: Value = serde_json::from_str(&std::fs::read_to_string(format!("{V1}/MANIFEST.json")).unwrap()).unwrap();
    let mut regression = Vec::new();
    for file in [
        "01-bw-photo-talbot.svg",
        "03-limited-hokusai.svg",
        "06-oldprint-talbot.svg",
        "07-oldprint-transparent-gradient.svg",
    ] {
        let e = v1.as_array().unwrap().iter().find(|e| e["file"] == file).unwrap();
        regression.push(json!({
            "case": file.trim_end_matches(".svg"),
            "bundleV1": format!("../../p0-r/owner-acceptance-bundle/{file}"),
            "settings": e["settings"],
            "note": "Approved artistic/Old Print behaviour; not duplicated here. Byte identity of the current engine's output is verified through the workbench by tests/browser/owner-bundle.spec.ts and natively by the regression corpus (PHOTOGRAPHIC-REGRESSION).",
        }));
    }
    let doc = json!({
        "generator": "cargo run --release -p vector-engine --example geo_bundle",
        "engineVersion": vector_engine::ENGINE_VERSION,
        "precisionFitVersion": PRECISION_FIT_VERSION,
        "pdfWidth": "200 mm",
        "rgba": "04/05 use the Chromium decode of the P0 fixtures (premultiplied canvas round trip), exactly as bundle v1; other sources are the PNGs in sources/",
        "cases": manifest,
        "unchangedApprovedCases": regression,
    });
    std::fs::write(
        format!("{dir}/MANIFEST.json"),
        serde_json::to_string_pretty(&doc).unwrap(),
    )
    .unwrap();
    std::fs::write(
        format!("{dir}/contact-sheet.html"),
        format!(
            "<!doctype html><meta charset=utf-8><title>Vectra P0-R-GEO owner acceptance bundle v2</title><style>body{{font:14px system-ui;margin:16px}}td{{border-top:1px solid #ccc;padding:6px;vertical-align:top}}img{{width:200px;height:200px;object-fit:contain;background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/16px 16px}}img.d{{width:240px;height:240px}}</style><h1>Owner acceptance bundle v2</h1><p>Columns: source raster · P0 result (spline, as bundle v1) · corrected (precision) · 16× detail of P0 · 16× detail of corrected. Detail renders: source pixels, true boundary (green dots), traced outline (red), anchors (blue squares), handles (orange). Open the SVG and PDF files themselves in Inkscape and macOS Preview to judge the geometry; this page only helps navigation.</p><table><tr><th>Case</th><th>Source</th><th>P0</th><th>Corrected</th><th>P0 16×</th><th>Corrected 16×</th></tr>{html_rows}</table>"
        ),
    )
    .unwrap();
    println!("wrote {} cases to {dir}", cases.len());
}
