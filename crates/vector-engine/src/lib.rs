//! Vectra vectorization core. Pure Rust: no DOM, no JS, no I/O, no clocks (the caller supplies
//! one), no randomness except the request seed.
//!
//! Contract: `vectorize(rgba, width, height, request, clock)` validates its input and returns
//! a validated canonical [`scene::Scene`] plus metrics and warnings, or a typed
//! [`error::EngineError`]. SVG and PDF are generated only from a validated scene
//! ([`svg::to_svg`], [`pdf::to_pdf`]).

pub mod color;
pub mod error;
pub mod halftone;
pub mod image;
pub mod params;
pub mod pdf;
pub mod precision;
pub mod region;
pub mod scene;
pub mod svg;
mod trace;

use serde::Serialize;

use color::{Luma, PaletteMapper, Rgba, kmeans_palette};
use error::EngineError;
use image::RgbaImage;
use params::{PRESET_VERSION, Settings, TraceRequest};
use scene::{ClipRect, Fill, FillRule, Group, Metadata, PaletteEntry, Path, SCENE_VERSION, Scene, SceneStats};

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
/// would fit, in paint order (bottom first), after colour fitting. Not used by the application.
#[doc(hidden)]
pub fn segment_layers(
    data: &[u8],
    width: u32,
    height: u32,
    req: &TraceRequest,
) -> Result<Vec<(Rgba, region::Mask)>, EngineError> {
    req.validate()?;
    let img = RgbaImage::new(data, width, height, req.max_pixels)?;
    let (w, h) = (width as usize, height as usize);
    let luma = Luma::new();
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

pub fn vectorize(
    data: &[u8],
    width: u32,
    height: u32,
    req: &TraceRequest,
    clock: &dyn Fn() -> f64,
) -> Result<Output, EngineError> {
    vectorize_impl(data, width, height, req, clock, None)
}

/// Engineering evaluation only (P0-R-GEO): traces with Vectra's precision fitter and the given
/// options in place of VTracer's curve fitting (stacked compositing). Not used by the app.
#[doc(hidden)]
pub fn vectorize_with_precision_options(
    data: &[u8],
    width: u32,
    height: u32,
    req: &TraceRequest,
    clock: &dyn Fn() -> f64,
    options: precision::Options,
) -> Result<Output, EngineError> {
    vectorize_impl(data, width, height, req, clock, Some(options))
}

fn vectorize_impl(
    data: &[u8],
    width: u32,
    height: u32,
    req: &TraceRequest,
    clock: &dyn Fn() -> f64,
    precision_options: Option<precision::Options>,
) -> Result<Output, EngineError> {
    req.validate()?;
    let img = RgbaImage::new(data, width, height, req.max_pixels)?;
    let (w, h) = (width as usize, height as usize);
    let luma = Luma::new();
    let mut t = Timings::default();
    let mut warnings = Vec::new();
    let mut palette: Vec<PaletteEntry> = Vec::new();
    let mut background = None;
    let mut clip = None;
    let mut dots = 0;
    let mut stage = trace::StageTimes::default();
    let mut partial_alpha = 0u64;
    let mut alpha_threshold = 128;

    let t0 = clock();
    let paths: Vec<Path> = match &req.settings {
        Settings::Bw(s) => {
            alpha_threshold = s.alpha_threshold;
            partial_alpha = img.data.chunks_exact(4).filter(|p| p[3] > 0 && p[3] < 255).count() as u64;
            let mut mask = trace::bw_mask(&img, &luma, s.threshold, s.invert, s.alpha_threshold);
            trace::fill_small_holes(&mut mask, w, h, s.speckle as usize);
            let t1 = clock();
            t.preprocess = t1 - t0;
            let seg = trace::bw_segmentation(&mask, w, h, s.speckle as usize, s.ink);
            drop(mask);
            t.segment = clock() - t1;
            let input = trace::PrecisionInput {
                img,
                luma: &luma,
                policy: precision::EdgePolicy::Luma {
                    threshold: s.threshold,
                    invert: s.invert,
                    alpha_threshold: s.alpha_threshold,
                },
                options: precision_options,
            };
            let doc = trace::fit_segmentation(
                seg,
                &s.fit,
                params::Compositing::Stacked,
                0,
                &[],
                &input,
                clock,
                &mut stage,
            )?;
            palette.push(PaletteEntry {
                id: "ink".into(),
                color: s.ink,
            });
            let ts = clock();
            let p = paths_with_palette(trace::doc_paths(&doc), &mut palette, "ink");
            t.scene = clock() - ts;
            p
        }
        Settings::Color(s) => {
            alpha_threshold = s.alpha_threshold;
            let (image, key, partial) = trace::keyed_image(&img, s.alpha_threshold, |r, g, b| [r, g, b]);
            partial_alpha = partial;
            let t1 = clock();
            t.preprocess = t1 - t0;
            let seg = trace::cluster_segmentation(
                image,
                key,
                8 - s.color_precision,
                s.layer_difference,
                s.speckle as usize,
            );
            t.segment = clock() - t1;
            let input = trace::PrecisionInput {
                img,
                luma: &luma,
                policy: precision::EdgePolicy::Color {
                    alpha_threshold: s.alpha_threshold,
                },
                options: precision_options,
            };
            let doc = trace::fit_segmentation(
                seg,
                &s.fit,
                s.compositing,
                s.layer_difference,
                &[],
                &input,
                clock,
                &mut stage,
            )?;
            let ts = clock();
            let p = paths_with_palette(trace::doc_paths(&doc), &mut palette, "c");
            t.scene = clock() - ts;
            p
        }
        Settings::Limited(s) => {
            alpha_threshold = s.alpha_threshold;
            let colors = match &s.palette {
                Some(p) => p.clone(),
                None => kmeans_palette(
                    &luma,
                    img.data,
                    s.alpha_threshold,
                    usize::from(s.colors),
                    u64::from(req.seed),
                ),
            };
            if s.palette.is_none() && colors.len() < usize::from(s.colors) {
                warnings.push(Warning {
                    code: "palette_reduced",
                    message: format!("requested {} colours, image yields {}", s.colors, colors.len()),
                });
            }
            for (i, c) in colors.iter().enumerate() {
                palette.push(PaletteEntry {
                    id: format!("p{i}"),
                    color: *c,
                });
            }
            let mut mapper = PaletteMapper::new(&luma, &colors);
            let (image, key, partial) = trace::keyed_image(&img, s.alpha_threshold, |r, g, b| {
                let c = colors[mapper.index(&luma, r, g, b)];
                [c.r, c.g, c.b]
            });
            drop(mapper);
            partial_alpha = partial;
            let t1 = clock();
            t.preprocess = t1 - t0;
            // Quantised image: full colour precision, single-step layering, palette snap after.
            let seg = trace::cluster_segmentation(image, key, 0, 1, s.speckle as usize);
            t.segment = clock() - t1;
            let input = trace::PrecisionInput {
                img,
                luma: &luma,
                policy: precision::EdgePolicy::Color {
                    alpha_threshold: s.alpha_threshold,
                },
                options: precision_options,
            };
            let doc = trace::fit_segmentation(seg, &s.fit, s.compositing, 1, &colors, &input, clock, &mut stage)?;
            let ts = clock();
            let traced = trace::doc_paths(&doc);
            let p = paths_with_palette(traced, &mut palette, "x");
            if palette.len() > colors.len() {
                return Err(EngineError::Tracer(
                    "limited-colour output used a colour outside the palette".into(),
                ));
            }
            t.scene = clock() - ts;
            p
        }
        Settings::Halftone(s) => {
            t.preprocess = 0.0;
            let r = halftone::halftone(&img, s, &luma, req.max_anchors)?;
            t.segment = clock() - t0; // dot synthesis
            dots = r.dots;
            palette.push(PaletteEntry {
                id: "ink".into(),
                color: s.ink,
            });
            background = s.paper;
            clip = Some(ClipRect {
                x: 0.0,
                y: 0.0,
                width: f64::from(width),
                height: f64::from(height),
            });
            r.paths
        }
    };
    t.color_fit = stage.color_fit;
    t.compose = stage.compose;
    t.optimize = stage.optimize;

    if partial_alpha > 0 && !matches!(req.settings, Settings::Halftone(_)) {
        warnings.push(Warning {
            code: "alpha_binarized",
            message: format!(
                "{partial_alpha} partially transparent pixels were treated as opaque or transparent at alpha {alpha_threshold}; partial transparency is not preserved"
            ),
        });
    }

    let mode = req.settings.mode();
    let scene = Scene {
        version: SCENE_VERSION,
        width: f64::from(width),
        height: f64::from(height),
        background,
        palette,
        groups: vec![Group {
            id: mode.into(),
            clip,
            paths,
        }],
        metadata: Metadata {
            generator: "vectra".into(),
            engine_version: ENGINE_VERSION.into(),
            mode: mode.into(),
            preset_version: PRESET_VERSION,
            seed: req.seed,
            source_width: width,
            source_height: height,
            params: serde_json::to_value(&req.settings).expect("settings serialize"),
        },
    };
    let tv = clock();
    let stats = scene.validate(req.max_anchors)?;
    t.validate = clock() - tv;
    if stats.paths == 0 {
        warnings.push(Warning {
            code: "empty_result",
            message: "no vector content was produced with these settings".into(),
        });
    }
    let palette_size = scene.palette.len();
    let fit_mode = match &req.settings {
        Settings::Bw(s) => Some(s.fit.mode),
        Settings::Color(s) => Some(s.fit.mode),
        Settings::Limited(s) => Some(s.fit.mode),
        Settings::Halftone(_) => None,
    };
    let precision_fit_version = (precision_options.is_some() || fit_mode == Some(params::FitMode::Precision))
        .then_some(precision::PRECISION_FIT_VERSION);
    Ok(Output {
        scene,
        metrics: Metrics {
            width,
            height,
            mode,
            timings_ms: t,
            stats,
            palette_size,
            dots,
            precision_fit_version,
        },
        warnings,
    })
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
