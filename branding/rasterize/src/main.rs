//! Renders SVG files to PNG with resvg. One job per stdin line: `<in.svg> <out.png> <w> <h>`.
//! The SVG is scaled uniformly to exactly w×h pixels (a non-uniform scale is refused, so nothing
//! is ever distorted) on a transparent canvas. Prints, per job, the output size and the bounding
//! box of its non-transparent pixels: `<out.png> <w>x<h> bbox <x0> <y0> <x1> <y1>` (exclusive
//! x1/y1; `bbox none` when fully transparent).
use resvg::{tiny_skia, usvg};
use std::io::BufRead;

fn main() {
    let opt = usvg::Options::default();
    for line in std::io::stdin().lock().lines() {
        let line = line.expect("stdin");
        let f: Vec<&str> = line.split_whitespace().collect();
        let [input, output, w, h] = f[..] else {
            panic!("expected `<in.svg> <out.png> <w> <h>`, got {line:?}")
        };
        let (w, h): (u32, u32) = (w.parse().expect("width"), h.parse().expect("height"));
        let svg = std::fs::read(input).unwrap_or_else(|e| panic!("{input}: {e}"));
        let tree = usvg::Tree::from_data(&svg, &opt).unwrap_or_else(|e| panic!("{input}: {e}"));
        let size = tree.size();
        let (sx, sy) = (w as f32 / size.width(), h as f32 / size.height());
        assert!(
            (sx / sy - 1.0).abs() < 1e-4,
            "{input}: {w}x{h} would distort its {}x{} size",
            size.width(),
            size.height()
        );
        let mut pixmap = tiny_skia::Pixmap::new(w, h).expect("pixmap");
        resvg::render(&tree, tiny_skia::Transform::from_scale(sx, sy), &mut pixmap.as_mut());
        std::fs::write(output, pixmap.encode_png().expect("png")).expect("write");

        let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0, 0);
        for (i, px) in pixmap.pixels().iter().enumerate() {
            if px.alpha() > 0 {
                let (x, y) = (i as u32 % w, i as u32 / w);
                (x0, y0, x1, y1) = (x0.min(x), y0.min(y), x1.max(x + 1), y1.max(y + 1));
            }
        }
        if x1 == 0 {
            println!("{output} {w}x{h} bbox none");
        } else {
            println!("{output} {w}x{h} bbox {x0} {y0} {x1} {y1}");
        }
    }
}
