//! P0-R-GEO performance regression: median wall time (native release, single thread) and peak
//! heap of `vectorize` per PNG and mode. Uses only the public API, so the same file runs
//! against older revisions (precision cases then report the settings error).
//! Usage: cargo run --release -p vector-engine --example geo_perf -- <runs> <png>...
use std::alloc::{GlobalAlloc, Layout, System};
use std::fs::File;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

use vector_engine::params::TraceRequest;

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

const MODES: [(&str, &str); 7] = [
    ("bw", r#"{"mode":"bw"}"#),
    ("color", r#"{"mode":"color"}"#),
    ("limited", r#"{"mode":"limited"}"#),
    ("halftone", r#"{"mode":"halftone"}"#),
    ("bw-precision", r#"{"mode":"bw","fit":{"mode":"precision"}}"#),
    ("color-precision", r#"{"mode":"color","fit":{"mode":"precision"}}"#),
    (
        "limited-precision",
        r#"{"mode":"limited","compositing":"stacked","fit":{"mode":"precision"}}"#,
    ),
];

fn read_png(path: &str) -> (Vec<u8>, u32, u32) {
    let mut dec = png::Decoder::new(std::io::BufReader::new(File::open(path).unwrap()));
    dec.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = dec.read_info().unwrap();
    let mut buf = vec![0; reader.output_buffer_size().unwrap()];
    let info = reader.next_frame(&mut buf).unwrap();
    let px = (info.width * info.height) as usize;
    let rgba = match info.color_type {
        png::ColorType::Rgba => buf[..px * 4].to_vec(),
        png::ColorType::Rgb => buf[..px * 3]
            .chunks_exact(3)
            .flat_map(|p| [p[0], p[1], p[2], 255])
            .collect(),
        _ => panic!("unsupported PNG colour type"),
    };
    (rgba, info.width, info.height)
}

fn main() {
    let mut args = std::env::args().skip(1);
    let runs: usize = args.next().unwrap().parse().unwrap();
    println!("| Image | Mode | Median ms | Peak heap MiB | Anchors | Result |\n|---|---|---|---|---|---|");
    for png in args {
        let (rgba, w, h) = read_png(&png);
        let id = std::path::Path::new(&png)
            .file_stem()
            .unwrap()
            .to_string_lossy()
            .to_string();
        for (mode, settings) in MODES {
            let req = match TraceRequest::from_json(&format!(
                r#"{{"presetVersion":1,"seed":1,"maxPixels":50000000,"settings":{settings}}}"#
            )) {
                Ok(r) => r,
                Err(e) => {
                    println!("| {id} | {mode} | — | — | — | {} |", e.code());
                    continue;
                }
            };
            let mut times = Vec::new();
            let mut peak = 0;
            let mut result = String::from("ok");
            let mut anchors = 0;
            for _ in 0..runs {
                let base = CUR.load(Ordering::Relaxed);
                PEAK.store(base, Ordering::Relaxed);
                let t = Instant::now();
                let out = vector_engine::vectorize(&rgba, w, h, &req, &|| 0.0);
                times.push(t.elapsed().as_secs_f64() * 1000.0);
                peak = peak.max(PEAK.load(Ordering::Relaxed).saturating_sub(base));
                match out {
                    Ok(o) => anchors = o.metrics.stats.anchors,
                    Err(e) => result = e.code().into(),
                }
            }
            times.sort_by(f64::total_cmp);
            println!(
                "| {id} ({w}×{h}) | {mode} | {:.0} | {:.0} | {anchors} | {result} |",
                times[times.len() / 2],
                peak as f64 / 1048576.0
            );
        }
    }
}
