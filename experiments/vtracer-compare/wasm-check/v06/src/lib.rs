use wasm_bindgen::prelude::*;
#[wasm_bindgen]
pub fn trace(rgba: Vec<u8>, width: usize, height: usize, binary: bool) -> Result<String, String> {
    let mut cfg = vtracer::Config::default();
    if binary { cfg.color_mode = vtracer::ColorMode::Binary; }
    vtracer::convert(vtracer::ColorImage { pixels: rgba, width, height }, cfg).map(|s| s.to_string())
}
