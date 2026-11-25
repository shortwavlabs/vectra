//! Vectra vectorization core. Pure Rust: no DOM, no JS, no I/O, no clocks (the caller supplies
//! one), no randomness except the request seed.
//!
//! Contract: `vectorize(rgba, width, height, request, clock)` validates its input and returns
//! a validated canonical [`scene::Scene`] plus metrics and warnings, or a typed
//! [`error::EngineError`]. SVG and PDF are generated only from a validated scene
//! ([`svg::to_svg`], [`pdf::to_pdf`]).

pub mod bake;
pub mod color;
pub mod error;
pub mod halftone;
pub mod image;
pub mod packet;
pub mod params;
pub mod pdf;
pub mod precision;
pub mod region;
pub mod scene;
pub mod staged;
pub mod svg;
mod trace;

use serde::Serialize;

use color::Rgba;
use error::EngineError;
use params::TraceRequest;
use scene::{Fill, FillRule, PaletteEntry, Path, Scene, SceneStats};

pub use bake::{DrawItem, DrawList, Run, bake_draw_list};
pub use packet::{Derived, GeometryPacket, Limits, PacketError, SceneMeta, validate_packet};
pub use staged::{Estimate, Segmentation, estimate, fit, segment, segment_owned};

/// Engine version recorded in every scene's metadata.
pub const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Timings {
    pub preprocess: f64,
    pub segment: f64,
    pub color_fit: f64,
    pub compose: f64,
    pub optimize: f64,
    pub scene: f64,
    pub validate: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metrics {
    pub width: u32,
    pub height: u32,
    pub mode: &'static str,
    pub timings_ms: Timings,
    pub stats: SceneStats,
    pub palette_size: usize,
    /// Halftone dots generated (halftone mode only).
    pub dots: u64,
    /// `precision::PRECISION_FIT_VERSION` when precision fitting produced the geometry.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub precision_fit_version: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Warning {
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    pub scene: Scene,
    pub metrics: Metrics,
    pub warnings: Vec<Warning>,
}

/// Assigns palette ids to traced paths. Colours are matched exactly; unseen colours get new ids.
fn paths_with_palette(
    traced: Vec<(Rgba, scene::PathBuilder)>,
    palette: &mut Vec<PaletteEntry>,
    prefix: &str,
) -> Vec<Path> {
    traced
        .into_iter()
        .map(|(c, b)| {
            let id = match palette.iter().find(|e| e.color == c) {
                Some(e) => e.id.clone(),
                None => {
                    let id = format!("{prefix}{}", palette.len());
                    palette.push(PaletteEntry {
                        id: id.clone(),
                        color: c,
                    });
                    id
                }
            };
            b.finish(
                Some(Fill {
                    color: c,
                    palette_id: Some(id),
                }),
                FillRule::Evenodd,
            )
        })
        .collect()
}

/// Engineering diagnostics only (P0-R-GEO): the segmentation layers a B&W or colour request
/// would fit, in paint order (bottom first), after colour fitting. Not used by the application;
/// compiled only with the `diagnostics` feature (TD-ARCH-004).
#[cfg(feature = "diagnostics")]
pub fn segment_layers(
    data: &[u8],
    width: u32,
    height: u32,
    req: &TraceRequest,
) -> Result<Vec<(Rgba, region::Mask)>, EngineError> {
    use image::RgbaImage;
    use params::Settings;
    req.validate()?;
    let img = RgbaImage::new(data, width, height, req.max_pixels)?;
    let (w, h) = (width as usize, height as usize);
    let luma = color::Luma::new();
    let seg = match &req.settings {
        Settings::Bw(s) => {
            let mut mask = trace::bw_mask(&img, &luma, s.threshold, s.invert, s.alpha_threshold);
            trace::fill_small_holes(&mut mask, w, h, s.speckle as usize);
            let mut seg = trace::bw_segmentation(&mask, w, h, s.speckle as usize, s.ink);
            trace::fit_colors(&mut seg, 0, &[])?;
            seg
        }
        Settings::Color(s) => {
            let (image, key, _) = trace::keyed_image(&img, s.alpha_threshold, |r, g, b| [r, g, b]);
            let mut seg = trace::cluster_segmentation(
                image,
                key,
                8 - s.color_precision,
                s.layer_difference,
                s.speckle as usize,
            );
            trace::fit_colors(&mut seg, s.layer_difference, &[])?;
            seg
        }
        Settings::Limited(_) | Settings::Halftone(_) => {
            return Err(EngineError::InvalidParams(
                "segment_layers supports bw and color".into(),
            ));
        }
    };
    Ok(seg
        .layers
        .iter()
        .map(|l| {
            let c = l.paint.color();
            (Rgba::rgb(c.r, c.g, c.b), trace::region_mask(&l.mask))
        })
        .collect())
}

/// Traces an image into a validated scene v1. Exactly `fit(segment(..))` (staged API, C4).
pub fn vectorize(
    data: &[u8],
    width: u32,
    height: u32,
    req: &TraceRequest,
    clock: &dyn Fn() -> f64,
) -> Result<Output, EngineError> {
    staged::fit(staged::segment(data, width, height, req, clock)?, clock)
}

/// Engineering evaluation only (P0-R-GEO): traces with Vectra's precision fitter and the given
/// options in place of VTracer's curve fitting (stacked compositing). Not used by the app;
/// compiled only with the `diagnostics` feature (TD-ARCH-004).
#[cfg(feature = "diagnostics")]
pub fn vectorize_with_precision_options(
    data: &[u8],
    width: u32,
    height: u32,
    req: &TraceRequest,
    clock: &dyn Fn() -> f64,
    options: precision::Options,
) -> Result<Output, EngineError> {
    staged::fit_impl(staged::segment(data, width, height, req, clock)?, clock, Some(options))
}

/// JSON-in/JSON-out wrapper used by the WASM adapter.
pub fn vectorize_json(
    data: &[u8],
    width: u32,
    height: u32,
    request_json: &str,
    clock: &dyn Fn() -> f64,
) -> Result<String, EngineError> {
    let req = TraceRequest::from_json(request_json)?;
    let out = vectorize(data, width, height, &req, clock)?;
    Ok(serde_json::to_string(&out).expect("output serializes"))
}
