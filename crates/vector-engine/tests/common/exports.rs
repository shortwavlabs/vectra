//! Export coordinate checks (P0-R-GEO): SVG path numbers and PDF content-stream operands must
//! carry exactly the scene's coordinates (no exporter-side geometry changes).
#![allow(dead_code)]

use vector_engine::scene::Scene;

/// Numbers of an SVG written by `svg::to_svg` (absolute M/L/C/Z, space separated).
pub fn svg_coords(svg: &str) -> Vec<f64> {
    let mut v = Vec::new();
    for part in svg.split(" d=\"").skip(1) {
        let d = &part[..part.find('"').unwrap()];
        let mut num = String::new();
        for ch in d.chars() {
            if ch.is_ascii_digit() || ch == '.' || ch == '-' {
                if ch == '-' && !num.is_empty() {
                    v.push(num.parse().unwrap());
                    num.clear();
                }
                num.push(ch);
            } else {
                if !num.is_empty() {
                    v.push(num.parse().unwrap());
                    num.clear();
                }
            }
        }
        if !num.is_empty() {
            v.push(num.parse().unwrap());
        }
    }
    v
}

/// Decompresses the page content stream and compares every m/l/c operand with the scene (f32).
pub fn pdf_matches(pdf: &[u8], scene: &Scene) -> bool {
    let start = pdf.windows(7).position(|w| w == b"stream\n").unwrap() + 7;
    let end = start + pdf[start..].windows(9).position(|w| w == b"endstream").unwrap();
    let mut data = &pdf[start..end];
    while data.last() == Some(&b'\n') {
        data = &data[..data.len() - 1];
    }
    let raw = miniz_oxide::inflate::decompress_to_vec_zlib(data).unwrap();
    let text = String::from_utf8_lossy(&raw);
    let mut stack: Vec<f64> = Vec::new();
    let mut ops = Vec::new();
    for tok in text.split_whitespace() {
        match tok {
            "m" | "l" | "c" => {
                ops.append(&mut stack);
            }
            _ => match tok.parse::<f64>() {
                Ok(v) => stack.push(v),
                Err(_) => stack.clear(),
            },
        }
    }
    let want: Vec<f64> = scene
        .groups
        .iter()
        .flat_map(|g| g.paths.iter().flat_map(|p| p.coords.clone()))
        .collect();
    ops.len() == want.len()
        && ops
            .iter()
            .zip(&want)
            .all(|(a, b)| (a - f64::from(*b as f32)).abs() < 1e-4)
}
