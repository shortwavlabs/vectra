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

// ---- GeometryPacket v1 route (G-0 contracts C3, C4; G-ENG) ----
// Packet arrays cross the boundary as typed arrays. Every `take*` method moves its array out
// once: wasm-bindgen copies it into a fresh, whole-buffer JS typed array (C2 rule 1).

use vector_engine::bake::{DrawList, bake_draw_list};
use vector_engine::packet::{GeometryPacket, Limits, PacketError, SceneMeta, parse_manifest_json, validate_packet};
use vector_engine::staged::{Segmentation, estimate, fit, segment_owned};

fn packet_error(e: PacketError) -> JsValue {
    JsValue::from_str(&serde_json::json!({ "code": e.code.as_str(), "message": e.message }).to_string())
}

fn invalid(m: String) -> JsValue {
    js_error(EngineError::InvalidParams(m))
}

/// A packet plus the scene-level data and trace report (`vectorizePacket`, `fitPacket`).
#[wasm_bindgen]
pub struct PacketResult {
    manifest_json: String,
    scene_meta_json: String,
    report_json: String,
    packet: GeometryPacket,
}

#[wasm_bindgen]
impl PacketResult {
    #[wasm_bindgen(getter, js_name = manifestJson)]
    pub fn manifest_json(&self) -> String {
        self.manifest_json.clone()
    }
    #[wasm_bindgen(getter, js_name = sceneMetaJson)]
    pub fn scene_meta_json(&self) -> String {
        self.scene_meta_json.clone()
    }
    #[wasm_bindgen(getter, js_name = reportJson)]
    pub fn report_json(&self) -> String {
        self.report_json.clone()
    }
    #[wasm_bindgen(js_name = takeVerbs)]
    pub fn take_verbs(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.packet.verbs)
    }
    #[wasm_bindgen(js_name = takeCoords)]
    pub fn take_coords(&mut self) -> Vec<f64> {
        std::mem::take(&mut self.packet.coords)
    }
    #[wasm_bindgen(js_name = takeVerbOffsets)]
    pub fn take_verb_offsets(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.packet.verb_offsets)
    }
    #[wasm_bindgen(js_name = takeCoordOffsets)]
    pub fn take_coord_offsets(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.packet.coord_offsets)
    }
    #[wasm_bindgen(js_name = takeStyleIndex)]
    pub fn take_style_index(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.packet.style_index)
    }
    #[wasm_bindgen(js_name = takeGroupIndex)]
    pub fn take_group_index(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.packet.group_index)
    }
    /// The C3.0 block (call before any `take*`), for native/WASM byte-identity checks.
    #[wasm_bindgen(js_name = blockBytes)]
    pub fn block_bytes(&self) -> Vec<u8> {
        self.packet.to_bytes()
    }
}

fn packet_result(out: vector_engine::Output, limits: &Limits) -> Result<PacketResult, JsValue> {
    let packet = GeometryPacket::from_scene(&out.scene).map_err(packet_error)?;
    validate_packet(&packet, limits).map_err(packet_error)?;
    Ok(PacketResult {
        manifest_json: serde_json::to_string(&packet.manifest).expect("manifest serializes"),
        scene_meta_json: serde_json::to_string(&SceneMeta::from_scene(&out.scene)).expect("meta serializes"),
        report_json: serde_json::json!({ "metrics": out.metrics, "warnings": out.warnings }).to_string(),
        packet,
    })
}

fn request_limits(req: &vector_engine::params::TraceRequest) -> Limits {
    Limits {
        max_anchors: req.max_anchors,
        ..Limits::ENGINEERING
    }
}

/// Traces and returns the result as a validated GeometryPacket (C4 `vectorizePacket`).
#[wasm_bindgen(js_name = vectorizePacket)]
pub fn vectorize_packet(rgba: &[u8], width: u32, height: u32, request_json: &str) -> Result<PacketResult, JsValue> {
    let req = vector_engine::params::TraceRequest::from_json(request_json).map_err(js_error)?;
    let out = vector_engine::vectorize(rgba, width, height, &req, &now).map_err(js_error)?;
    packet_result(out, &request_limits(&req))
}

#[allow(clippy::too_many_arguments)]
fn packet_from_js(
    manifest_json: &str,
    verbs: &[u8],
    coords: &[f64],
    verb_offsets: &[u32],
    coord_offsets: &[u32],
    style_index: &[u32],
    group_index: &[u32],
    limits: &Limits,
) -> Result<GeometryPacket, PacketError> {
    Ok(GeometryPacket {
        manifest: parse_manifest_json(manifest_json, limits)?,
        verbs: verbs.to_vec(),
        coords: coords.to_vec(),
        verb_offsets: verb_offsets.to_vec(),
        coord_offsets: coord_offsets.to_vec(),
        style_index: style_index.to_vec(),
        group_index: group_index.to_vec(),
    })
}

/// Validation summary (`validatePacket`). The per-path arrays are derived again wherever they
/// are needed; only the totals cross back.
#[wasm_bindgen(js_name = validatePacket)]
#[allow(clippy::too_many_arguments)]
pub fn validate_packet_js(
    manifest_json: &str,
    verbs: &[u8],
    coords: &[f64],
    verb_offsets: &[u32],
    coord_offsets: &[u32],
    style_index: &[u32],
    group_index: &[u32],
) -> Result<String, JsValue> {
    let limits = Limits::PRODUCT;
    let p = packet_from_js(
        manifest_json,
        verbs,
        coords,
        verb_offsets,
        coord_offsets,
        style_index,
        group_index,
        &limits,
    )
    .map_err(packet_error)?;
    let d = validate_packet(&p, &limits).map_err(packet_error)?;
    Ok(
        serde_json::json!({ "anchors": d.anchors, "paths": d.path_anchors.len(), "subpaths": d.subpath_start.len() })
            .to_string(),
    )
}

/// A set of packets referenced by index from a draw list (`exportDrawList*`).
#[wasm_bindgen]
#[derive(Default)]
pub struct PacketSet {
    packets: Vec<GeometryPacket>,
}

#[wasm_bindgen]
impl PacketSet {
    #[wasm_bindgen(constructor)]
    pub fn new() -> PacketSet {
        PacketSet::default()
    }
    /// Adds a validated packet; returns its index (the draw list's `chunk`).
    #[allow(clippy::too_many_arguments)]
    pub fn add(
        &mut self,
        manifest_json: &str,
        verbs: &[u8],
        coords: &[f64],
        verb_offsets: &[u32],
        coord_offsets: &[u32],
        style_index: &[u32],
        group_index: &[u32],
    ) -> Result<u32, JsValue> {
        let limits = Limits::PRODUCT;
        let p = packet_from_js(
            manifest_json,
            verbs,
            coords,
            verb_offsets,
            coord_offsets,
            style_index,
            group_index,
            &limits,
        )
        .map_err(packet_error)?;
        validate_packet(&p, &limits).map_err(packet_error)?;
        self.packets.push(p);
        Ok(self.packets.len() as u32 - 1)
    }
}

fn bake(draw_list_json: &str, scene_meta_json: &str, set: &PacketSet) -> Result<Scene, JsValue> {
    let list: DrawList = serde_json::from_str(draw_list_json).map_err(|e| invalid(format!("draw list: {e}")))?;
    let meta: SceneMeta = serde_json::from_str(scene_meta_json).map_err(|e| invalid(format!("scene meta: {e}")))?;
    bake_draw_list(&list, &set.packets, &meta, &Limits::PRODUCT).map_err(js_error)
}

/// Export from a frozen draw list (C5 `export`): bake (C3.1) → scene v1 → SVG.
#[wasm_bindgen(js_name = exportDrawListSvg)]
pub fn export_draw_list_svg(draw_list_json: &str, scene_meta_json: &str, set: &PacketSet) -> Result<String, JsValue> {
    to_svg(&bake(draw_list_json, scene_meta_json, set)?).map_err(js_error)
}

/// Export from a frozen draw list (C5 `export`): bake (C3.1) → scene v1 → PDF.
#[wasm_bindgen(js_name = exportDrawListPdf)]
pub fn export_draw_list_pdf(
    draw_list_json: &str,
    scene_meta_json: &str,
    options_json: &str,
    set: &PacketSet,
) -> Result<Vec<u8>, JsValue> {
    let opts: PdfOptions =
        serde_json::from_str(options_json).map_err(|e| js_error(EngineError::InvalidExportOptions(e.to_string())))?;
    to_pdf(&bake(draw_list_json, scene_meta_json, set)?, &opts).map_err(js_error)
}

fn single_packet_scene(scene_meta_json: &str, set: &PacketSet) -> Result<Scene, JsValue> {
    let [p] = set.packets.as_slice() else {
        return Err(invalid("packetToSvg/packetToPdf take exactly one packet".into()));
    };
    let meta: SceneMeta = serde_json::from_str(scene_meta_json).map_err(|e| invalid(format!("scene meta: {e}")))?;
    Scene::from_packet(p, &meta).map_err(js_error)
}

/// Single-packet convenience used by the byte-identity regression (C4).
#[wasm_bindgen(js_name = packetToSvg)]
pub fn packet_to_svg(scene_meta_json: &str, set: &PacketSet) -> Result<String, JsValue> {
    to_svg(&single_packet_scene(scene_meta_json, set)?).map_err(js_error)
}

#[wasm_bindgen(js_name = packetToPdf)]
pub fn packet_to_pdf(scene_meta_json: &str, options_json: &str, set: &PacketSet) -> Result<Vec<u8>, JsValue> {
    let opts: PdfOptions =
        serde_json::from_str(options_json).map_err(|e| js_error(EngineError::InvalidExportOptions(e.to_string())))?;
    to_pdf(&single_packet_scene(scene_meta_json, set)?, &opts).map_err(js_error)
}

/// Staged handle (C4 segment/estimate), scoped to this worker instance.
#[wasm_bindgen]
pub struct SegmentationHandle {
    inner: Option<Segmentation<'static>>,
}

#[wasm_bindgen]
pub fn segment(rgba: Vec<u8>, width: u32, height: u32, request_json: &str) -> Result<SegmentationHandle, JsValue> {
    let req = vector_engine::params::TraceRequest::from_json(request_json).map_err(js_error)?;
    let seg = segment_owned(rgba, width, height, &req, &now).map_err(js_error)?;
    Ok(SegmentationHandle { inner: Some(seg) })
}

#[wasm_bindgen]
impl SegmentationHandle {
    /// JSON `{"kind":"range","anchorsLow","anchorsHigh","basis"}` or `{"kind":"unavailable","reason"}`.
    #[wasm_bindgen(js_name = estimateJson)]
    pub fn estimate_json(&self) -> Result<String, JsValue> {
        let seg = self
            .inner
            .as_ref()
            .ok_or_else(|| invalid("segmentation already fitted".into()))?;
        Ok(serde_json::to_string(&estimate(seg)).expect("estimate serializes"))
    }
    /// Completes the trace (consumes the segmentation).
    #[wasm_bindgen(js_name = fitPacket)]
    pub fn fit_packet(&mut self) -> Result<PacketResult, JsValue> {
        let seg = self
            .inner
            .take()
            .ok_or_else(|| invalid("segmentation already fitted".into()))?;
        let limits = request_limits(seg.request());
        let out = fit(seg, &now).map_err(js_error)?;
        packet_result(out, &limits)
    }
}
