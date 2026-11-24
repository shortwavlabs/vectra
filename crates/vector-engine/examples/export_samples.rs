//! Writes SVG + PDF exports for the procedural corpus (native build of the same engine code
//! that runs in the browser) for independent inspection by scripts/verify-exports.mjs.
//! Usage: cargo run --release -p vector-engine --example export_samples -- <out-dir>
#[path = "../tests/common/fixtures.rs"]
mod fixtures;

use vector_engine::params::TraceRequest;
use vector_engine::pdf::{PdfOptions, Unit, to_pdf};
use vector_engine::svg::to_svg;

const MODES: [(&str, &str); 6] = [
    ("bw", r#"{"mode":"bw"}"#),
    ("color", r#"{"mode":"color"}"#),
    ("mosaic", r#"{"mode":"color","compositing":"mosaic"}"#),
    ("limited", r#"{"mode":"limited","colors":6}"#),
    ("halftone", r#"{"mode":"halftone"}"#),
    ("halftone-transparent", r#"{"mode":"halftone","paper":null,"pitch":6}"#),
];

fn main() {
    let dir = std::env::args().nth(1).unwrap_or_else(|| "tests/output/native".into());
    std::fs::create_dir_all(&dir).unwrap();
    let mut n = 0;
    for f in fixtures::all() {
        for (name, settings) in MODES {
            let req =
                TraceRequest::from_json(&format!(r#"{{"presetVersion":1,"seed":1,"settings":{settings}}}"#)).unwrap();
            let out = vector_engine::vectorize(&f.rgba, f.width as u32, f.height as u32, &req, &|| 0.0).unwrap();
            if out.metrics.stats.paths == 0 {
                continue;
            }
            let stem = format!("{dir}/{}-{name}", f.id);
            std::fs::write(format!("{stem}.svg"), to_svg(&out.scene).unwrap()).unwrap();
            let pdf = to_pdf(
                &out.scene,
                &PdfOptions {
                    width: 150.0,
                    unit: Unit::Mm,
                    dpi: None,
                },
            )
            .unwrap();
            std::fs::write(format!("{stem}.pdf"), pdf).unwrap();
            std::fs::write(format!("{stem}.scene.json"), out.scene.to_json()).unwrap();
            n += 1;
        }
    }
    // Hand-built scene with translucent background, translucent fill and a stroke.
    let scene = fixtures::translucent_scene();
    std::fs::write(format!("{dir}/translucent_paint.svg"), to_svg(&scene).unwrap()).unwrap();
    let pdf = to_pdf(
        &scene,
        &PdfOptions {
            width: 150.0,
            unit: Unit::Mm,
            dpi: None,
        },
    )
    .unwrap();
    std::fs::write(format!("{dir}/translucent_paint.pdf"), pdf).unwrap();
    n += 1;
    println!("wrote {n} SVG/PDF pairs to {dir}");
}
