//! Writes the procedural fixture corpus as PNG files for the browser tests.
//! Usage: cargo run -p vector-engine --example gen_fixtures -- <out-dir>
#[path = "../tests/common/fixtures.rs"]
mod fixtures;

use std::fs::File;
use std::io::{BufWriter, Write};

fn main() {
    let dir = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "tests/fixtures/procedural".into());
    std::fs::create_dir_all(&dir).expect("create output dir");
    let mut index = String::from("[\n");
    let all = fixtures::all();
    for (i, f) in all.iter().enumerate() {
        let path = format!("{dir}/{}.png", f.id);
        let mut enc = png::Encoder::new(
            BufWriter::new(File::create(&path).expect("create png")),
            f.width as u32,
            f.height as u32,
        );
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.set_compression(png::Compression::High);
        enc.write_header()
            .expect("png header")
            .write_image_data(&f.rgba)
            .expect("png data");
        index.push_str(&format!(
            "  {{\"id\": \"{}\", \"file\": \"procedural/{}.png\", \"description\": \"{}\", \"coverage\": \"{}\"}}{}\n",
            f.id,
            f.id,
            f.description,
            f.coverage,
            if i + 1 < all.len() { "," } else { "" }
        ));
    }
    index.push_str("]\n");
    File::create(format!("{dir}/index.json"))
        .and_then(|mut fh| fh.write_all(index.as_bytes()))
        .expect("write index");
    println!("wrote {} fixtures to {dir}", all.len());
}
