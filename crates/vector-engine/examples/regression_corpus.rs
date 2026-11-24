//! Byte-level regression corpus (P0-R-GEO). Traces the procedural fixtures and any number of
//! PNG files with the approved default settings and writes the scene JSON, SVG and PDF (200 mm)
//! for each case, so two engine revisions can be compared with `shasum`.
//! Uses only the public engine API, so the same file runs against older revisions.
//!
//! Usage: cargo run --release -p vector-engine --example regression_corpus -- <out-dir> [png...]
#[path = "../tests/common/fixtures.rs"]
mod fixtures;

use std::fs::File;

use vector_engine::params::TraceRequest;
use vector_engine::pdf::{PdfOptions, Unit, to_pdf};
use vector_engine::svg::to_svg;

const FIXTURE_MODES: [(&str, &str); 6] = [
    ("bw", r#"{"mode":"bw"}"#),
    ("color", r#"{"mode":"color"}"#),
    ("mosaic", r#"{"mode":"color","compositing":"mosaic"}"#),
    ("limited", r#"{"mode":"limited","colors":6}"#),
    ("halftone", r#"{"mode":"halftone"}"#),
    ("halftone-transparent", r#"{"mode":"halftone","paper":null,"pitch":6}"#),
];

/// Photographic cases: the approved defaults of each mode.
const PHOTO_MODES: [(&str, &str); 4] = [
    ("bw", r#"{"mode":"bw"}"#),
    ("color", r#"{"mode":"color"}"#),
    ("limited", r#"{"mode":"limited"}"#),
    ("halftone", r#"{"mode":"halftone"}"#),
];

fn read_png(path: &str) -> (Vec<u8>, u32, u32) {
    let mut dec = png::Decoder::new(std::io::BufReader::new(File::open(path).expect("open png")));
    dec.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = dec.read_info().expect("png header");
    let mut buf = vec![0; reader.output_buffer_size().expect("buffer size")];
    let info = reader.next_frame(&mut buf).expect("png frame");
    let px = (info.width * info.height) as usize;
    let rgba = match info.color_type {
        png::ColorType::Rgba => buf[..px * 4].to_vec(),
        png::ColorType::Rgb => buf[..px * 3]
            .chunks_exact(3)
            .flat_map(|p| [p[0], p[1], p[2], 255])
            .collect(),
        png::ColorType::GrayscaleAlpha => buf[..px * 2]
            .chunks_exact(2)
            .flat_map(|p| [p[0], p[0], p[0], p[1]])
            .collect(),
        png::ColorType::Grayscale => buf[..px].iter().flat_map(|&v| [v, v, v, 255]).collect(),
        png::ColorType::Indexed => unreachable!("EXPAND converts indexed images"),
    };
    (rgba, info.width, info.height)
}

fn run(dir: &str, stem: &str, rgba: &[u8], w: u32, h: u32, settings: &str) {
    let req = TraceRequest::from_json(&format!(
        r#"{{"presetVersion":1,"seed":1,"maxPixels":50000000,"settings":{settings}}}"#
    ))
    .unwrap();
    let path = format!("{dir}/{stem}");
    match vector_engine::vectorize(rgba, w, h, &req, &|| 0.0) {
        Ok(out) => {
            std::fs::write(format!("{path}.scene.json"), out.scene.to_json()).unwrap();
            std::fs::write(format!("{path}.svg"), to_svg(&out.scene).unwrap()).unwrap();
            let pdf = to_pdf(
                &out.scene,
                &PdfOptions {
                    width: 200.0,
                    unit: Unit::Mm,
                    dpi: None,
                },
            )
            .unwrap();
            std::fs::write(format!("{path}.pdf"), pdf).unwrap();
        }
        Err(e) => std::fs::write(format!("{path}.error.txt"), format!("{}: {e}\n", e.code())).unwrap(),
    }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let dir = args.next().expect("usage: regression_corpus <out-dir> [png...]");
    std::fs::create_dir_all(&dir).unwrap();
    let mut n = 0;
    for f in fixtures::all() {
        for (mode, settings) in FIXTURE_MODES {
            run(
                &dir,
                &format!("{}-{mode}", f.id),
                &f.rgba,
                f.width as u32,
                f.height as u32,
                settings,
            );
            n += 1;
        }
    }
    for png in args {
        let (rgba, w, h) = read_png(&png);
        let id = std::path::Path::new(&png)
            .file_stem()
            .unwrap()
            .to_string_lossy()
            .to_string();
        for (mode, settings) in PHOTO_MODES {
            run(&dir, &format!("{id}-{mode}"), &rgba, w, h, settings);
            n += 1;
        }
        eprintln!("{id} {w}x{h} done");
    }
    println!("wrote {n} cases to {dir}");
}
