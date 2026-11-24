//! Browser adapter: owns the JS boundary. The worker owns allocation and lifecycle.
use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = engineVersion)]
pub fn engine_version() -> String {
    vector_engine::ENGINE_VERSION.to_string()
}
