//! Browser adapter: owns the JS boundary (strings, byte slices, errors, the clock).
//! The worker owns allocation and lifecycle. Errors are thrown as JSON strings
//! `{"code": "...", "message": "..."}`; a Rust panic aborts and surfaces in JS as a
//! `WebAssembly.RuntimeError`, after which the worker must be recreated.
use vector_engine::error::EngineError;
use vector_engine::pdf::{PdfOptions, to_pdf};
use vector_engine::scene::Scene;
use vector_engine::svg::to_svg;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = performance)]
    fn now() -> f64;
}

fn js_error(e: EngineError) -> JsValue {
    JsValue::from_str(&serde_json::json!({ "code": e.code(), "message": e.to_string() }).to_string())
}

#[wasm_bindgen(js_name = engineVersion)]
pub fn engine_version() -> String {
    vector_engine::ENGINE_VERSION.to_string()
}

/// Result of a trace: canonical scene JSON, report JSON (metrics, warnings), the SVG
/// serialised from the same validated scene, and the SVG serialisation time.
#[wasm_bindgen(getter_with_clone)]
pub struct TraceResult {
    pub scene: String,
    pub report: String,
    pub svg: String,
    #[wasm_bindgen(js_name = svgMs)]
    pub svg_ms: f64,
}

#[wasm_bindgen]
pub fn vectorize(rgba: &[u8], width: u32, height: u32, request_json: &str) -> Result<TraceResult, JsValue> {
    let req = vector_engine::params::TraceRequest::from_json(request_json).map_err(js_error)?;
    let out = vector_engine::vectorize(rgba, width, height, &req, &now).map_err(js_error)?;
    let t = now();
    let svg = to_svg(&out.scene).map_err(js_error)?;
    let svg_ms = now() - t;
    let scene = out.scene.to_json();
    let report = serde_json::json!({ "metrics": out.metrics, "warnings": out.warnings }).to_string();
    Ok(TraceResult {
        scene,
        report,
        svg,
        svg_ms,
    })
}

#[wasm_bindgen(js_name = sceneToSvg)]
pub fn scene_to_svg(scene_json: &str) -> Result<String, JsValue> {
    to_svg(&Scene::from_json(scene_json).map_err(js_error)?).map_err(js_error)
}

#[wasm_bindgen(js_name = sceneToPdf)]
pub fn scene_to_pdf(scene_json: &str, options_json: &str) -> Result<Vec<u8>, JsValue> {
    let scene = Scene::from_json(scene_json).map_err(js_error)?;
    let opts: PdfOptions =
        serde_json::from_str(options_json).map_err(|e| js_error(EngineError::InvalidExportOptions(e.to_string())))?;
    to_pdf(&scene, &opts).map_err(js_error)
}

/// Current size of the instance's linear memory (it grows but never shrinks).
#[wasm_bindgen(js_name = memoryBytes)]
pub fn memory_bytes() -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        (core::arch::wasm32::memory_size(0) * 65_536) as f64
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        0.0
    }
}
