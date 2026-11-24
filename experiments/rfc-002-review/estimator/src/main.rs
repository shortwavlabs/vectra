//! For each PNG × scale × mode (bw, color; approved defaults): time `segment_layers`, derive
//! cheap features (layer count, member area, 4-neighbour boundary length), then run the full
//! trace and record the actual anchor count (or the error). One JSON object per line.
//! Usage: rfc002-estimator <png>... > runs.jsonl
use std::time::Instant;
use vector_engine::params::TraceRequest;

fn read_png(path: &str) -> (Vec<u8>, usize, usize) {
    let mut dec = png::Decoder::new(std::io::BufReader::new(std::fs::File::open(path).unwrap()));
    dec.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut r = dec.read_info().unwrap();
    let mut buf = vec![0; r.output_buffer_size().unwrap()];
    let info = r.next_frame(&mut buf).unwrap();
    let n = (info.width * info.height) as usize;
    let rgba = match info.color_type {
        png::ColorType::Rgba => buf[..n * 4].to_vec(),
        png::ColorType::Rgb => buf[..n * 3].chunks_exact(3).flat_map(|p| [p[0], p[1], p[2], 255]).collect(),
        png::ColorType::Grayscale => buf[..n].iter().flat_map(|&v| [v, v, v, 255]).collect(),
        png::ColorType::GrayscaleAlpha => buf[..n * 2].chunks_exact(2).flat_map(|p| [p[0], p[0], p[0], p[1]]).collect(),
        _ => unreachable!(),
    };
    (rgba, info.width as usize, info.height as usize)
}

/// Area-average downscale by factor `s` (0 < s <= 1).
fn downscale(src: &[u8], w: usize, h: usize, s: f64) -> (Vec<u8>, usize, usize) {
    if s >= 1.0 {
        return (src.to_vec(), w, h);
    }
    let (ow, oh) = (((w as f64) * s).floor() as usize, ((h as f64) * s).floor() as usize);
    let mut out = vec![0u8; ow * oh * 4];
    for oy in 0..oh {
        let (y0, y1) = ((oy * h) / oh, (((oy + 1) * h) / oh).max((oy * h) / oh + 1));
        for ox in 0..ow {
            let (x0, x1) = ((ox * w) / ow, (((ox + 1) * w) / ow).max((ox * w) / ow + 1));
            let mut acc = [0u64; 4];
            for y in y0..y1 {
                for x in x0..x1 {
                    for c in 0..4 {
                        acc[c] += u64::from(src[(y * w + x) * 4 + c]);
                    }
                }
            }
            let n = ((y1 - y0) * (x1 - x0)) as u64;
            for c in 0..4 {
                out[(oy * ow + ox) * 4 + c] = (acc[c] / n) as u8;
            }
        }
    }
    (out, ow, oh)
}

/// Pre-segmentation features (O(pixels), no clustering): for colour, the number of
/// 4-neighbour pairs whose channels differ after dropping `shift` low bits; for B&W, the number
/// of luminance-threshold transitions (Rec. 601 luma, threshold 128, approximating the engine's
/// default B&W mask).
fn pre_features(img: &[u8], w: usize, h: usize) -> (Vec<(u32, usize)>, usize, f64) {
    let t = Instant::now();
    let mut out = Vec::new();
    for shift in [3u32, 4, 5, 6] {
        let q = |i: usize| -> u32 {
            (u32::from(img[i * 4]) >> shift) << 16 | (u32::from(img[i * 4 + 1]) >> shift) << 8 | (u32::from(img[i * 4 + 2]) >> shift)
        };
        let mut e = 0usize;
        for y in 0..h {
            for x in 0..w {
                let i = y * w + x;
                if x + 1 < w && q(i) != q(i + 1) { e += 1; }
                if y + 1 < h && q(i) != q(i + w) { e += 1; }
            }
        }
        out.push((shift, e));
    }
    let ink = |i: usize| -> bool {
        (299 * u32::from(img[i * 4]) + 587 * u32::from(img[i * 4 + 1]) + 114 * u32::from(img[i * 4 + 2])) / 1000 < 128
    };
    let mut bw = 0usize;
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            if x + 1 < w && ink(i) != ink(i + 1) { bw += 1; }
            if y + 1 < h && ink(i) != ink(i + w) { bw += 1; }
        }
    }
    (out, bw, t.elapsed().as_secs_f64() * 1e3)
}

fn main() {
    let pre_only = std::env::args().nth(1).as_deref() == Some("--pre");
    let modes = [("bw", r#"{"mode":"bw"}"#), ("color", r#"{"mode":"color"}"#)];
    for path in std::env::args().skip(1).filter(|a| a != "--pre") {
        let (rgba, w, h) = read_png(&path);
        let id = std::path::Path::new(&path).file_stem().unwrap().to_string_lossy().to_string();
        let mp = (w * h) as f64 / 1e6;
        // Full resolution plus downscales to ~8, ~4 and ~2 MP where smaller than the source.
        let mut scales = vec![1.0];
        for target in [8.0, 4.0, 2.0, 1.0] {
            if mp > target * 1.2 {
                scales.push((target / mp).sqrt());
            }
        }
        for s in scales {
            let (img, iw, ih) = downscale(&rgba, w, h, s);
            if pre_only {
                let (edges, bw, ms) = pre_features(&img, iw, ih);
                let e: Vec<String> = edges.iter().map(|(k, v)| format!(r#""q{k}":{v}"#)).collect();
                println!(r#"{{"image":"{id}","scale":{s:.4},"w":{iw},"h":{ih},{},"bwTransitions":{bw},"preMs":{ms:.1}}}"#, e.join(","));
                continue;
            }
            for (mode, settings) in modes {
                let req = TraceRequest::from_json(&format!(
                    r#"{{"presetVersion":1,"seed":1,"maxPixels":50000000,"maxAnchors":5000000,"settings":{settings}}}"#
                ))
                .unwrap();
                let t = Instant::now();
                let layers = vector_engine::segment_layers(&img, iw as u32, ih as u32, &req).unwrap();
                let seg_ms = t.elapsed().as_secs_f64() * 1e3;
                let (mut area, mut perim) = (0usize, 0usize);
                for (_, m) in &layers {
                    for y in 0..m.h as i64 {
                        for x in 0..m.w as i64 {
                            if m.at(x, y) {
                                area += 1;
                                perim += [(1, 0), (-1, 0), (0, 1), (0, -1)].iter().filter(|(dx, dy)| !m.at(x + dx, y + dy)).count();
                            }
                        }
                    }
                }
                let feat_ms = t.elapsed().as_secs_f64() * 1e3 - seg_ms;
                let t2 = Instant::now();
                let res = vector_engine::vectorize(&img, iw as u32, ih as u32, &req, &|| 0.0);
                let trace_ms = t2.elapsed().as_secs_f64() * 1e3;
                let (anchors, error) = match res {
                    Ok(o) => (o.metrics.stats.anchors.to_string(), "null".to_string()),
                    Err(e) => ("null".to_string(), format!("\"{}: {}\"", e.code(), e.to_string().replace('"', "'"))),
                };
                println!(
                    r#"{{"image":"{id}","scale":{s:.4},"w":{iw},"h":{ih},"mp":{:.3},"mode":"{mode}","layers":{},"area":{area},"perimeter":{perim},"segMs":{seg_ms:.1},"featureMs":{feat_ms:.1},"traceMs":{trace_ms:.1},"anchors":{anchors},"error":{error}}}"#,
                    (iw * ih) as f64 / 1e6,
                    layers.len()
                );
            }
        }
        eprintln!("{id} done");
    }
}
