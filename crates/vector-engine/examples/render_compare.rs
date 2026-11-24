//! Compares an SVG rendered by resvg with a PDF page rendered by poppler (`pdftoppm`, PPM output).
//! Both renders are composited over white at the PPM's pixel size.
//! Usage: render_compare <file.svg> <page.ppm>
//! Prints `mean_abs_diff max_diff pct_px_over_32 block32_mean_abs_diff`: the last value compares
//! 32×32-pixel block averages, so anti-aliasing differences between renderers on high-frequency
//! content (halftone dots, checkerboards) cancel out while geometric or tonal errors remain.
use std::io::Read;

fn read_ppm(path: &str) -> (usize, usize, Vec<u8>) {
    let mut buf = Vec::new();
    std::fs::File::open(path).unwrap().read_to_end(&mut buf).unwrap();
    // P6\n<w> <h>\n255\n<rgb...>
    let mut fields = Vec::new();
    let mut i = 0;
    while fields.len() < 4 {
        while buf[i].is_ascii_whitespace() {
            i += 1;
        }
        let start = i;
        while !buf[i].is_ascii_whitespace() {
            i += 1;
        }
        fields.push(String::from_utf8_lossy(&buf[start..i]).to_string());
    }
    assert_eq!(fields[0], "P6");
    let (w, h): (usize, usize) = (fields[1].parse().unwrap(), fields[2].parse().unwrap());
    (w, h, buf[i + 1..i + 1 + w * h * 3].to_vec())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (w, h, pdf) = read_ppm(&args[2]);
    let svg = std::fs::read_to_string(&args[1]).unwrap();
    let tree = resvg::usvg::Tree::from_str(&svg, &resvg::usvg::Options::default()).unwrap();
    let mut pm = resvg::tiny_skia::Pixmap::new(w as u32, h as u32).unwrap();
    pm.fill(resvg::tiny_skia::Color::WHITE);
    let s = tree.size();
    let t = resvg::tiny_skia::Transform::from_scale(w as f32 / s.width(), h as f32 / s.height());
    resvg::render(&tree, t, &mut pm.as_mut());
    let px = pm.data();
    if let Some(out) = args.get(3) {
        // Optional: write the resvg render as PPM for visual inspection.
        let mut ppm = format!("P6\n{w} {h}\n255\n").into_bytes();
        for p in px.chunks_exact(4) {
            ppm.extend_from_slice(&p[..3]);
        }
        std::fs::write(out, ppm).unwrap();
    }
    let (mut sum, mut max, mut over) = (0u64, 0u8, 0u64);
    for i in 0..w * h {
        for k in 0..3 {
            let d = (i16::from(px[i * 4 + k]) - i16::from(pdf[i * 3 + k])).unsigned_abs() as u8;
            sum += u64::from(d);
            max = max.max(d);
        }
        let dpx = (0..3)
            .map(|k| (i16::from(px[i * 4 + k]) - i16::from(pdf[i * 3 + k])).abs())
            .max()
            .unwrap();
        if dpx > 32 {
            over += 1;
        }
    }
    const B: usize = 32;
    let (bw, bh) = (w / B, h / B);
    let mut block_sum = 0.0;
    for by in 0..bh {
        for bx in 0..bw {
            for k in 0..3 {
                let (mut a, mut b) = (0u32, 0u32);
                for y in by * B..by * B + B {
                    for x in bx * B..bx * B + B {
                        a += u32::from(px[(y * w + x) * 4 + k]);
                        b += u32::from(pdf[(y * w + x) * 3 + k]);
                    }
                }
                block_sum += (f64::from(a) - f64::from(b)).abs() / (B * B) as f64;
            }
        }
    }
    println!(
        "{:.4} {} {:.4} {:.4}",
        sum as f64 / (w * h * 3) as f64,
        max,
        over as f64 * 100.0 / (w * h) as f64,
        block_sum / (bw * bh * 3).max(1) as f64
    );
}
