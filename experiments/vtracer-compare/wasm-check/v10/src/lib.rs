use wasm_bindgen::prelude::*;
#[wasm_bindgen]
pub fn trace(rgba: Vec<u8>, width: usize, height: usize, binary: bool) -> Result<String, String> {
    let mut cfg = vtracer::Config::default();
    if binary { cfg.clustering = vtracer::Clustering::Binary; }
    let p = cfg.build().map_err(|e| e.to_string())?;
    p.to_svg(&vtracer::ColorImage { pixels: rgba, width, height }).map_err(|e| e.to_string())
}
