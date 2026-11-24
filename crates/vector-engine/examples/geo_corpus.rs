//! Writes the P0-R-GEO geometry corpus: one PNG per fixture plus `corpus.json` with every
//! fixture's analytic parameters, set and trace settings.
//! Usage: cargo run --release -p vector-engine --example geo_corpus -- <png-dir> <json-path>
#[path = "../tests/common/corpus.rs"]
mod corpus;
#[path = "../tests/common/geometry.rs"]
mod geometry;

use std::fs::File;
use std::io::BufWriter;

fn main() {
    let mut args = std::env::args().skip(1);
    let dir = args.next().unwrap_or_else(|| "tests/output/geo-corpus".into());
    let json = args
        .next()
        .unwrap_or_else(|| "docs/research/p0-r-geo/artifacts/corpus/corpus.json".into());
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::create_dir_all(std::path::Path::new(&json).parent().unwrap()).unwrap();
    let mut entries = Vec::new();
    for f in corpus::all() {
        let mut enc = png::Encoder::new(
            BufWriter::new(File::create(format!("{dir}/{}.png", f.id)).unwrap()),
            f.w as u32,
            f.h as u32,
        );
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.write_header().unwrap().write_image_data(&f.rgba).unwrap();
        entries.push(serde_json::json!({
            "id": f.id,
            "set": f.set,
            "description": f.description,
            "width": f.w,
            "height": f.h,
            "background": f.background,
            "layers": f.layers.iter().map(|(s, c)| serde_json::json!({"shape": s, "color": c})).collect::<Vec<_>>(),
            "settings": serde_json::from_str::<serde_json::Value>(&f.settings).unwrap(),
            "ideal": f.ideal,
        }));
    }
    std::fs::write(&json, serde_json::to_string_pretty(&entries).unwrap()).unwrap();
    println!("wrote {} fixtures to {dir} and {json}", entries.len());
}
