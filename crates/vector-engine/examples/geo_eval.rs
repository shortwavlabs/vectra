//! P0-R-GEO Stage D: evaluates corrective candidates on the geometry corpus against the
//! pre-registered thresholds (GEOMETRIC-FIDELITY-METRICS.md).
//!
//! Usage: cargo run --release -p vector-engine --example geo_eval -- <out-dir> <sets> <variants>
//!   sets:     comma list of rejected,validation,negative,heldout
//!   variants: comma list of variant names (see `variants()`), or "all"
#[path = "../tests/common/corpus.rs"]
mod corpus;
#[path = "../tests/common/fixtures.rs"]
mod fixtures;
#[path = "../tests/common/geometry.rs"]
mod geometry;

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

use geometry::{GeoFixture, Prim, Report, Topology, evaluate, topology};
use serde::Serialize;
use vector_engine::params::TraceRequest;
use vector_engine::pdf::{PdfOptions, Unit, to_pdf};
use vector_engine::precision::{Options, Smoothing, Subpixel};
use vector_engine::svg::to_svg;

struct Counting;
static CUR: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        let p = unsafe { System.alloc(l) };
        if !p.is_null() {
            let c = CUR.fetch_add(l.size(), Ordering::Relaxed) + l.size();
            PEAK.fetch_max(c, Ordering::Relaxed);
        }
        p
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        unsafe { System.dealloc(p, l) };
        CUR.fetch_sub(l.size(), Ordering::Relaxed);
    }
}
#[global_allocator]
static A: Counting = Counting;

#[derive(Clone)]
enum Kind {
    /// Merged into the fixture's settings: `fit` object for VTracer.
    Spline(&'static str),
    Precision(Options),
}

fn opts(subpixel: Subpixel, arcs: bool, tolerance: f64, scale: f64) -> Options {
    Options {
        tolerance,
        corner_threshold: 60.0,
        corner_scale: scale,
        subpixel,
        arcs,
        smoothing: Smoothing::None,
        sharpen: false,
    }
}

fn refined(subpixel: Subpixel, arcs: bool, smoothing: Smoothing, sharpen: bool) -> Options {
    Options {
        smoothing,
        sharpen,
        ..opts(subpixel, arcs, 0.2, 2.0)
    }
}

fn variants() -> Vec<(&'static str, &'static str, Kind)> {
    use Subpixel::*;
    let p = Kind::Precision;
    let r = refined;
    vec![
        ("spline", "baseline", Kind::Spline(r#"{}"#)),
        ("D1-len2", "D1", Kind::Spline(r#"{"lengthThreshold":2}"#)),
        ("D1-len8", "D1", Kind::Spline(r#"{"lengthThreshold":8}"#)),
        ("D1-splice20", "D1", Kind::Spline(r#"{"spliceThreshold":20}"#)),
        ("D1-splice90", "D1", Kind::Spline(r#"{"spliceThreshold":90}"#)),
        (
            "D1-len2-splice20",
            "D1",
            Kind::Spline(r#"{"lengthThreshold":2,"spliceThreshold":20}"#),
        ),
        (
            "D1-len8-splice90",
            "D1",
            Kind::Spline(r#"{"lengthThreshold":8,"spliceThreshold":90}"#),
        ),
        ("D1-corner30", "D1", Kind::Spline(r#"{"cornerThreshold":30}"#)),
        ("D1-corner90", "D1", Kind::Spline(r#"{"cornerThreshold":90}"#)),
        ("D1-polygon", "D1", Kind::Spline(r#"{"mode":"polygon"}"#)),
        (
            "D1g-lattice-G1",
            "D1 (Vectra G1 fit, no sub-pixel)",
            p(opts(Off, false, 0.2, 2.0)),
        ),
        ("D2-linear", "D2", p(opts(Linear, false, 0.2, 2.0))),
        ("D2-area", "D2", p(opts(Area, false, 0.2, 2.0))),
        ("D2-reach", "D2", p(opts(AreaReach, false, 0.2, 2.0))),
        ("D3-lattice-arcs", "D3", p(opts(Off, true, 0.2, 2.0))),
        ("D4-area-arcs", "D4", p(opts(Area, true, 0.2, 2.0))),
        (
            "D2-area-sharpen",
            "D2 + corner rebuild",
            p(r(Area, false, Smoothing::None, true)),
        ),
        (
            "D2-area-b1-sharpen",
            "D2 + smoothing + corner rebuild",
            p(r(Area, false, Smoothing::Binomial(1), true)),
        ),
        (
            "D2-area-b2-sharpen",
            "D2 + smoothing + corner rebuild",
            p(r(Area, false, Smoothing::Binomial(2), true)),
        ),
        (
            "D2-area-t1-sharpen",
            "D2 + smoothing + corner rebuild",
            p(r(Area, false, Smoothing::Taubin(1), true)),
        ),
        (
            "D2-area-t2-sharpen",
            "D2 + smoothing + corner rebuild",
            p(r(Area, false, Smoothing::Taubin(2), true)),
        ),
        (
            "D2-area-t4-sharpen",
            "D2 + smoothing + corner rebuild",
            p(r(Area, false, Smoothing::Taubin(4), true)),
        ),
        (
            "D2-linear-t2-sharpen",
            "D2 + smoothing + corner rebuild",
            p(r(Linear, false, Smoothing::Taubin(2), true)),
        ),
        (
            "D4-area-t2-sharpen-arcs",
            "D4 (D2 refined + recognition)",
            p(r(Area, true, Smoothing::Taubin(2), true)),
        ),
        ("D2-area-tol0.1", "D2 sensitivity", p(opts(Area, false, 0.1, 2.0))),
        ("D2-area-tol0.3", "D2 sensitivity", p(opts(Area, false, 0.3, 2.0))),
        ("D2-area-scale1.5", "D2 sensitivity", p(opts(Area, false, 0.2, 1.5))),
        ("D2-area-scale3", "D2 sensitivity", p(opts(Area, false, 0.2, 3.0))),
    ]
}

/// Tier A unless the fixture is small (B) or binary-edged (C).
fn tier(id: &str) -> char {
    if id.contains("hard") {
        'C'
    } else if matches!(id, "circle-r3" | "h-circle-r5") {
        'B'
    } else {
        'A'
    }
}

/// IoU ≥ 0.98 applies to shapes whose smallest dimension is ≥ 20 px.
fn iou_applies(id: &str) -> bool {
    !matches!(
        id,
        "circle-r3" | "circle-r8" | "h-circle-r5" | "strokes" | "ring-bw" | "h-ring-thin-alpha"
    )
}

#[derive(Serialize, Clone)]
struct Row {
    fixture: String,
    set: String,
    variant: String,
    family: String,
    tier: char,
    pass: bool,
    failures: Vec<String>,
    anchors: u64,
    cubics: u64,
    lines: u64,
    paths: u64,
    svg_bytes: usize,
    pdf_bytes: usize,
    time_ms: f64,
    peak_mem_kib: usize,
    report: Report,
    topology: Topology,
    /// Negative controls: RMS of the output (and of the truth) about their own best-fit circle.
    output_roundness: Option<f64>,
    truth_roundness: Option<f64>,
    error: Option<String>,
}

fn request(f: &GeoFixture, kind: &Kind) -> TraceRequest {
    let mut settings: serde_json::Value = serde_json::from_str(&f.settings).unwrap();
    if let Kind::Spline(fit) = kind {
        let fit: serde_json::Value = serde_json::from_str(fit).unwrap();
        if fit.as_object().is_some_and(|o| !o.is_empty()) {
            settings["fit"] = fit;
        }
    }
    TraceRequest::from_json(&serde_json::json!({"presetVersion": 1, "seed": 1, "settings": settings}).to_string())
        .unwrap()
}

fn run(f: &GeoFixture, kind: &Kind) -> Result<(vector_engine::Output, f64, usize), String> {
    let req = request(f, kind);
    let once = || match kind {
        Kind::Spline(_) => vector_engine::vectorize(&f.rgba, f.w as u32, f.h as u32, &req, &|| 0.0),
        Kind::Precision(o) => {
            vector_engine::vectorize_with_precision_options(&f.rgba, f.w as u32, f.h as u32, &req, &|| 0.0, *o)
        }
    };
    let base = CUR.load(Ordering::Relaxed);
    PEAK.store(base, Ordering::Relaxed);
    let out = once().map_err(|e| e.to_string())?;
    let peak = PEAK.load(Ordering::Relaxed).saturating_sub(base);
    let mut times = Vec::new();
    for _ in 0..3 {
        let t = Instant::now();
        let _ = once();
        times.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    times.sort_by(f64::total_cmp);
    Ok((out, times[1], peak / 1024))
}

fn roundness(pts: &[[f64; 2]]) -> Option<f64> {
    let (c, r) = geometry::fit_circle(pts)?;
    Some(
        (pts.iter()
            .map(|p| ((p[0] - c[0]).hypot(p[1] - c[1]) - r).powi(2))
            .sum::<f64>()
            / pts.len() as f64)
            .sqrt(),
    )
}

/// Checks a fixture's report against the pre-registered thresholds.
fn assess(
    f: &GeoFixture,
    tier: char,
    r: &Report,
    t: &Topology,
    anchors: u64,
    spline_anchors: Option<u64>,
) -> Vec<String> {
    let mut fail = Vec::new();
    let mut check = |ok: bool, what: String| {
        if !ok {
            fail.push(what);
        }
    };
    let (rms, max) = match tier {
        'A' => (0.25, 0.75),
        'B' => (0.30, 0.90),
        _ => (0.35, 0.85),
    };
    check(t.preserved, "topology".into());
    if !f.ideal {
        check(r.organic.rms <= 0.25, format!("organic RMS {:.3}", r.organic.rms));
        check(
            r.organic.max_abs <= 0.75,
            format!("organic max {:.3}", r.organic.max_abs),
        );
        return fail;
    }
    check(
        r.contour_smooth.rms <= rms,
        format!("contour RMS {:.3}", r.contour_smooth.rms),
    );
    check(
        r.contour_smooth.max_abs <= max,
        format!("contour max {:.3}", r.contour_smooth.max_abs),
    );
    check(
        r.smooth_join_breaks == 0,
        format!(
            "{} tangent breaks (max {:.1}°)",
            r.smooth_join_breaks, r.max_smooth_join_angle_deg
        ),
    );
    for c in &r.circles {
        if c.visible_fraction < 0.1 || c.radial.n < 20 {
            continue;
        }
        let tag = format!("circle r={}", c.true_radius);
        check(c.center_error <= 0.5, format!("{tag} centre {:.3}", c.center_error));
        check(
            c.radius_error.abs() <= 0.5,
            format!("{tag} radius {:+.3}", c.radius_error),
        );
        check(c.radial.rms <= rms, format!("{tag} radial RMS {:.3}", c.radial.rms));
        check(
            c.radial.max_abs <= max,
            format!("{tag} radial max {:.3}", c.radial.max_abs),
        );
        if tier == 'A' {
            check(
                c.curvature.rms <= 0.15,
                format!("{tag} curvature RMS {:.3}", c.curvature.rms),
            );
            check(
                c.curvature.max_abs <= 0.5,
                format!("{tag} curvature max {:.3}", c.curvature.max_abs),
            );
        }
    }
    if tier == 'A' {
        for l in &r.loops {
            check(
                l.center_error <= 0.5 && l.major_error.abs() <= 0.5 && l.minor_error.abs() <= 0.5,
                format!(
                    "loop axes/centre {:.3}/{:+.3}/{:+.3}",
                    l.center_error, l.major_error, l.minor_error
                ),
            );
            check(
                l.area_error_rel.abs() <= 0.01,
                format!("loop area {:+.4}", l.area_error_rel),
            );
            if let Some(o) = l.orientation_error_deg {
                check(o <= 1.0, format!("orientation {o:.2}°"));
            }
        }
        if r.line_deviation.n > 0 {
            check(
                r.line_deviation.rms <= 0.15,
                format!("line RMS {:.3}", r.line_deviation.rms),
            );
            check(
                r.line_deviation.max_abs <= 0.5,
                format!("line max {:.3}", r.line_deviation.max_abs),
            );
            check(
                r.line_max_curvature <= 0.005,
                format!("line curvature {:.4}", r.line_max_curvature),
            );
        }
    }
    check(
        r.other_corner_position_max <= 1.0,
        format!("corner {:.2} px", r.other_corner_position_max),
    );
    check(
        r.acute_corner_position_max <= 1.5,
        format!("acute corner {:.2} px", r.acute_corner_position_max),
    );
    if iou_applies(&f.id) {
        check(t.iou >= 0.98, format!("IoU {:.4}", t.iou));
    }
    if let Some(sa) = spline_anchors {
        let cap = (sa as f64 * 1.5).max(sa as f64 + 8.0);
        check(anchors as f64 <= cap, format!("anchors {anchors} > {cap:.0}"));
    }
    fail
}

/// P0 IoU metric (render at 1×, dark ink vs coverage ≥ 0.5 mask) on the P0 B&W fixtures.
fn p0_iou(variants: &[(&'static str, &'static str, Kind)]) -> Vec<(String, String, f64)> {
    let mut rows = Vec::new();
    for fx in [fixtures::circle(), fixtures::sharp_corners(), fixtures::nested_rings()] {
        let g = GeoFixture {
            id: fx.id.into(),
            set: "p0",
            description: String::new(),
            w: fx.width,
            h: fx.height,
            background: [255, 255, 255, 255],
            layers: vec![],
            settings: r#"{"mode":"bw"}"#.into(),
            ideal: true,
            rgba: fx.rgba.clone(),
        };
        for (name, _, kind) in variants {
            let Ok((out, _, _)) = run(&g, kind) else { continue };
            let svg = to_svg(&out.scene).unwrap();
            let tree = resvg::usvg::Tree::from_str(&svg, &resvg::usvg::Options::default()).unwrap();
            let mut pm = resvg::tiny_skia::Pixmap::new(fx.width as u32, fx.height as u32).unwrap();
            resvg::render(&tree, resvg::tiny_skia::Transform::identity(), &mut pm.as_mut());
            let (mut i, mut u) = (0usize, 0usize);
            for (p, t) in pm.data().chunks_exact(4).zip(&fx.truth) {
                let ink = p[3] >= 128 && u32::from(p[0]) * 2 < u32::from(p[3]);
                i += usize::from(ink && *t);
                u += usize::from(ink || *t);
            }
            rows.push((fx.id.to_string(), name.to_string(), i as f64 / u as f64));
        }
    }
    rows
}

fn main() {
    let mut args = std::env::args().skip(1);
    let dir = args
        .next()
        .unwrap_or_else(|| "docs/research/p0-r-geo/artifacts/evaluation".into());
    let sets = args.next().unwrap_or_else(|| "rejected,validation,negative".into());
    let wanted = args.next().unwrap_or_else(|| "all".into());
    std::fs::create_dir_all(&dir).unwrap();
    let vars: Vec<_> = variants()
        .into_iter()
        .filter(|(n, _, _)| wanted == "all" || wanted.split(',').any(|w| w == *n))
        .collect();
    let mut fixtures_list: Vec<GeoFixture> = Vec::new();
    for s in sets.split(',') {
        fixtures_list.extend(match s {
            "rejected" => corpus::rejected(),
            "validation" => corpus::validation(),
            "negative" => corpus::negative(),
            "heldout" => corpus::heldout(),
            _ => panic!("unknown set {s}"),
        });
    }
    let mut rows: Vec<Row> = Vec::new();
    for f in &fixtures_list {
        let truth = f.truth(0.05);
        let tr = tier(&f.id);
        let truth_round = (!f.ideal)
            .then(|| roundness(&truth.samples.iter().map(|s| s.p).collect::<Vec<_>>()))
            .flatten();
        let mut spline_anchors = None;
        for (name, family, kind) in &vars {
            let row = match run(f, kind) {
                Ok((out, time_ms, peak)) => {
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
                    let report = evaluate(&truth, &out.scene, f.w, f.h);
                    let topo = topology(f, &svg, 4);
                    let st = out.metrics.stats;
                    if *name == "spline" {
                        spline_anchors = Some(st.anchors);
                    }
                    let out_round = (!f.ideal)
                        .then(|| {
                            let s = geometry::sample_scene(&out.scene, 0.2);
                            let pts: Vec<_> = s
                                .samples
                                .iter()
                                .filter(|o| {
                                    truth.nearest(o.p, 3.0).is_some_and(|(i, _)| {
                                        matches!(truth.prims[truth.samples[i].prim], Prim::Organic)
                                    })
                                })
                                .map(|o| o.p)
                                .collect();
                            roundness(&pts)
                        })
                        .flatten();
                    let failures = assess(
                        f,
                        tr,
                        &report,
                        &topo,
                        st.anchors,
                        if *name == "spline" { None } else { spline_anchors },
                    );
                    Row {
                        fixture: f.id.clone(),
                        set: f.set.into(),
                        variant: name.to_string(),
                        family: family.to_string(),
                        tier: tr,
                        pass: failures.is_empty(),
                        failures,
                        anchors: st.anchors,
                        cubics: st.cubics,
                        lines: st.lines,
                        paths: st.paths,
                        svg_bytes: svg.len(),
                        pdf_bytes: pdf.len(),
                        time_ms,
                        peak_mem_kib: peak,
                        report,
                        topology: topo,
                        output_roundness: out_round,
                        truth_roundness: truth_round,
                        error: None,
                    }
                }
                Err(e) => Row {
                    fixture: f.id.clone(),
                    set: f.set.into(),
                    variant: name.to_string(),
                    family: family.to_string(),
                    tier: tr,
                    pass: false,
                    failures: vec![e.clone()],
                    anchors: 0,
                    cubics: 0,
                    lines: 0,
                    paths: 0,
                    svg_bytes: 0,
                    pdf_bytes: 0,
                    time_ms: 0.0,
                    peak_mem_kib: 0,
                    report: Report::default(),
                    topology: Topology::default(),
                    output_roundness: None,
                    truth_roundness: truth_round,
                    error: Some(e),
                },
            };
            eprintln!(
                "{:<26} {:<20} {}",
                f.id,
                name,
                if row.pass {
                    "PASS".into()
                } else {
                    row.failures.join("; ")
                }
            );
            rows.push(row);
        }
    }
    let tag = sets.replace(',', "+");
    std::fs::write(
        format!("{dir}/eval-{tag}.json"),
        serde_json::to_string_pretty(&rows).unwrap(),
    )
    .unwrap();

    // Summary per variant.
    let mut md = String::new();
    md.push_str(&format!("### Sets: {sets}\n\n| Variant | Family | Fixtures passing | Rejected cases passing | Negative controls passing | Mean contour RMS (ideal) | Worst contour max (ideal) | Tangent breaks | Anchors (total) | Time (ms, total) |\n|---|---|---|---|---|---|---|---|---|---|\n"));
    for (name, family, _) in &vars {
        let r: Vec<&Row> = rows.iter().filter(|r| r.variant == *name).collect();
        let ideal: Vec<&&Row> = r.iter().filter(|r| r.set != "negative" && r.error.is_none()).collect();
        let pass = r.iter().filter(|r| r.pass).count();
        let rej = r.iter().filter(|r| r.set == "rejected");
        let neg = r.iter().filter(|r| r.set == "negative" || r.fixture == "h-hand-drawn");
        md.push_str(&format!(
            "| {name} | {family} | {pass}/{} | {}/{} | {}/{} | {:.3} | {:.3} | {} | {} | {:.1} |\n",
            r.len(),
            rej.clone().filter(|r| r.pass).count(),
            rej.count(),
            neg.clone().filter(|r| r.pass).count(),
            neg.count(),
            ideal.iter().map(|r| r.report.contour_smooth.rms).sum::<f64>() / ideal.len().max(1) as f64,
            ideal
                .iter()
                .map(|r| r.report.contour_smooth.max_abs)
                .fold(0.0, f64::max),
            r.iter().map(|r| r.report.smooth_join_breaks).sum::<usize>(),
            r.iter().map(|r| r.anchors).sum::<u64>(),
            r.iter().map(|r| r.time_ms).sum::<f64>(),
        ));
    }
    if sets.contains("validation") {
        md.push_str("\n### P0 IoU metric (render 1×, coverage ≥ 0.5 mask), target ≥ 0.98\n\n| Fixture | Variant | IoU |\n|---|---|---|\n");
        for (fx, v, iou) in p0_iou(&vars) {
            md.push_str(&format!("| {fx} | {v} | {iou:.4} |\n"));
        }
    }
    std::fs::write(format!("{dir}/summary-{tag}.md"), &md).unwrap();
    println!("{md}");
}
