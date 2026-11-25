//! G-ENG timing (RFC §11.1–11.2, C9 native execution): per PNG and mode, the staged API's
//! segment, estimate and fit times next to a plain `vectorize`, plus the estimate range and
//! the actual anchor count. Single thread, release build; record machine load with the run.
//! Not an estimator FP/FN validation (that needs a reserved corpus, G-TRACE).
//!
//! Usage: cargo run --release -p vector-engine --example staged_timing -- <reps> <png>...
use std::fs::File;
use std::time::Instant;

use vector_engine::params::TraceRequest;
use vector_engine::{Estimate, estimate, fit, segment, vectorize};

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

fn ms(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1e3
}

fn median(mut v: Vec<f64>) -> f64 {
    v.sort_by(f64::total_cmp);
    v[v.len() / 2]
}

fn main() {
    let mut args = std::env::args().skip(1);
    let reps: usize = args
        .next()
        .expect("usage: staged_timing <reps> <png>...")
        .parse()
        .unwrap();
    println!("image,mode,mp,vectorize_ms,segment_ms,estimate_ms,fit_ms,anchors,estimate");
    for png in args {
        let (rgba, w, h) = read_png(&png);
        let id = std::path::Path::new(&png)
            .file_stem()
            .unwrap()
            .to_string_lossy()
            .to_string();
        for (mode, settings) in [("bw", r#"{"mode":"bw"}"#), ("color", r#"{"mode":"color"}"#)] {
            let req = TraceRequest::from_json(&format!(
                r#"{{"presetVersion":1,"seed":1,"maxPixels":50000000,"maxAnchors":5000000,"settings":{settings}}}"#
            ))
            .unwrap();
            let (mut tv, mut ts, mut te, mut tf) = (vec![], vec![], vec![], vec![]);
            let (mut anchors, mut est) = (0, String::new());
            for _ in 0..reps {
                let t = Instant::now();
                let direct = vectorize(&rgba, w, h, &req, &|| 0.0).unwrap();
                tv.push(ms(t));
                let t = Instant::now();
                let seg = segment(&rgba, w, h, &req, &|| 0.0).unwrap();
                ts.push(ms(t));
                let t = Instant::now();
                let e = estimate(&seg);
                te.push(ms(t));
                let t = Instant::now();
                let out = fit(seg, &|| 0.0).unwrap();
                tf.push(ms(t));
                assert_eq!(out.scene.to_json(), direct.scene.to_json());
                anchors = out.metrics.stats.anchors;
                est = match e {
                    Estimate::Range {
                        anchors_low,
                        anchors_high,
                        ..
                    } => format!("{anchors_low}-{anchors_high}"),
                    Estimate::Unavailable { reason } => format!("unavailable: {reason}"),
                };
            }
            println!(
                "{id},{mode},{:.2},{:.1},{:.1},{:.2},{:.1},{anchors},{est}",
                f64::from(w * h) / 1e6,
                median(tv),
                median(ts),
                median(te),
                median(tf)
            );
        }
    }
}
