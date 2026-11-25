//! G-ENG packet-route regression (contracts C3, C4). Regenerates the `regression_corpus`
//! cases through the GeometryPacket route and writes the same file names, so the output hashes
//! can be compared with the frozen `a4cf172.sha256`:
//!
//!   segment → fit (staged API) → Scene → GeometryPacket → C3.0 bytes → decode → validate →
//!   identity draw list → bake_draw_list → scene JSON, SVG and PDF (200 mm)
//!
//! Each case also asserts `fit(segment(x)) == vectorize(x)` and `Scene::from_packet == scene`,
//! and writes the C3.0 block (`<case>.packet.bin`) for native/WASM byte-identity checks.
//!
//! Usage: cargo run --release -p vector-engine --example packet_regression -- <out-dir> [png...]
#[path = "../tests/common/fixtures.rs"]
mod fixtures;

use std::fs::File;

use vector_engine::bake::{bake_draw_list, identity_draw_list};
use vector_engine::packet::{GeometryPacket, Limits, SceneMeta, validate_packet};
use vector_engine::params::TraceRequest;
use vector_engine::pdf::{PdfOptions, Unit, to_pdf};
use vector_engine::scene::Scene;
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
    let staged = vector_engine::segment(rgba, w, h, &req, &|| 0.0).and_then(|s| vector_engine::fit(s, &|| 0.0));
    let direct = vector_engine::vectorize(rgba, w, h, &req, &|| 0.0);
    let out = match (staged, direct) {
        (Ok(s), Ok(d)) => {
            assert_eq!(
                s.scene.to_json(),
                d.scene.to_json(),
                "{stem}: fit(segment) != vectorize"
            );
            s
        }
        (Err(e), Err(d)) => {
            assert_eq!(e, d, "{stem}: staged and direct errors differ");
            std::fs::write(format!("{path}.error.txt"), format!("{}: {e}\n", e.code())).unwrap();
            return;
        }
        _ => panic!("{stem}: staged and direct outcomes differ"),
    };
    let scene = out.scene;
    let limits = Limits::ENGINEERING;
    let packet = GeometryPacket::from_scene(&scene).unwrap();
    let bytes = packet.to_bytes();
    let decoded = GeometryPacket::from_bytes(packet.manifest.clone(), &bytes, &limits).unwrap();
    validate_packet(&decoded, &limits).unwrap();
    let meta = SceneMeta::from_scene(&scene);
    assert_eq!(
        Scene::from_packet(&decoded, &meta).unwrap(),
        scene,
        "{stem}: lossy round trip"
    );
    let baked = bake_draw_list(&identity_draw_list(&decoded, 0), &[decoded], &meta, &limits).unwrap();
    std::fs::write(format!("{path}.packet.bin"), &bytes).unwrap();
    std::fs::write(format!("{path}.scene.json"), baked.to_json()).unwrap();
    std::fs::write(format!("{path}.svg"), to_svg(&baked).unwrap()).unwrap();
    let pdf = to_pdf(
        &baked,
        &PdfOptions {
            width: 200.0,
            unit: Unit::Mm,
            dpi: None,
        },
    )
    .unwrap();
    std::fs::write(format!("{path}.pdf"), pdf).unwrap();
}

fn main() {
    let mut args = std::env::args().skip(1);
    let dir = args.next().expect("usage: packet_regression <out-dir> [png...]");
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
    println!("packet route: {n} cases written to {dir}");
}
