//! Staged engine API (G-0 contract C4; RFC §11.1–11.2): `segment` → `estimate` → `fit`.
//! [`crate::vectorize`] is exactly `fit(segment(..))`, so the staged route reproduces the
//! approved scenes byte for byte by construction (and the regression hashes prove it).
//! [`Segmentation`] is an opaque Vectra-owned handle: no VTracer or visioncortex type escapes.

use std::borrow::Cow;

use serde::Serialize;

use crate::color::{Luma, PaletteMapper, Rgba, kmeans_palette};
use crate::error::EngineError;
use crate::image::RgbaImage;
use crate::params::{self, FitMode, PRESET_VERSION, Settings, TraceRequest};
use crate::scene::{ClipRect, Group, Metadata, PaletteEntry, Path, SCENE_VERSION, Scene};
use crate::{ENGINE_VERSION, Metrics, Output, Timings, Warning, halftone, paths_with_palette, precision, trace};

enum Stage {
    Layers(trace::Segmented),
    /// Halftone dots are synthesised directly; there is no segmentation stage.
    Halftone,
}

/// The result of [`segment`]: everything [`fit`] needs. Borrows the input pixels; use
/// [`segment_owned`] for a handle that outlives them (the WASM adapter).
pub struct Segmentation<'a> {
    req: TraceRequest,
    data: Cow<'a, [u8]>,
    width: u32,
    height: u32,
    timings: Timings,
    stage: Stage,
    warnings: Vec<Warning>,
    partial_alpha: u64,
    alpha_threshold: u8,
    /// Limited mode: the palette the image was quantised to.
    colors: Vec<Rgba>,
}

impl Segmentation<'_> {
    pub fn request(&self) -> &TraceRequest {
        &self.req
    }
}

/// Complexity estimate after segmentation (RFC §11.1, the post-segmentation decision).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Estimate {
    #[serde(rename_all = "camelCase")]
    Range {
        anchors_low: u64,
        anchors_high: u64,
        /// The predictor and its calibration.
        basis: &'static str,
    },
    /// No calibrated estimator exists for this request; never a silent zero.
    Unavailable { reason: &'static str },
}

/// R03 boundary-length calibration (independent review, `artifacts/estimator/runs.jsonl`,
/// 34 B&W and 34 colour traces at Artistic defaults, 1–24 MP): anchors / boundary length
/// ranged 0.1043–0.1785 (B&W) and 0.1279–0.1970 (colour). The high bound adds the review's
/// 10 % margin (0 false negatives, 0 false positives at the 1M budget on that corpus).
/// Recalibration and FP/FN validation on a reserved corpus belong to G-TRACE.
const BW_RATIO: (f64, f64) = (0.1043, 0.1785);
const COLOR_RATIO: (f64, f64) = (0.1279, 0.1970);
const HIGH_MARGIN: f64 = 1.10;

pub fn segment<'a>(
    data: &'a [u8],
    width: u32,
    height: u32,
    req: &TraceRequest,
    clock: &dyn Fn() -> f64,
) -> Result<Segmentation<'a>, EngineError> {
    segment_cow(Cow::Borrowed(data), width, height, req, clock)
}

pub fn segment_owned(
    data: Vec<u8>,
    width: u32,
    height: u32,
    req: &TraceRequest,
    clock: &dyn Fn() -> f64,
) -> Result<Segmentation<'static>, EngineError> {
    segment_cow(Cow::Owned(data), width, height, req, clock)
}

fn segment_cow<'a>(
    data: Cow<'a, [u8]>,
    width: u32,
    height: u32,
    req: &TraceRequest,
    clock: &dyn Fn() -> f64,
) -> Result<Segmentation<'a>, EngineError> {
    req.validate()?;
    let img = RgbaImage::new(&data, width, height, req.max_pixels)?;
    let (w, h) = (width as usize, height as usize);
    let luma = Luma::new();
    let mut t = Timings::default();
    let mut warnings = Vec::new();
    let mut partial_alpha = 0u64;
    let mut alpha_threshold = 128;
    let mut colors = Vec::new();
    let t0 = clock();
    let stage = match &req.settings {
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
            Stage::Layers(trace::Segmented(seg))
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
            Stage::Layers(trace::Segmented(seg))
        }
        Settings::Limited(s) => {
            alpha_threshold = s.alpha_threshold;
            colors = match &s.palette {
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
            Stage::Layers(trace::Segmented(seg))
        }
        Settings::Halftone(_) => Stage::Halftone,
    };
    Ok(Segmentation {
        req: req.clone(),
        data,
        width,
        height,
        timings: t,
        stage,
        warnings,
        partial_alpha,
        alpha_threshold,
        colors,
    })
}

fn fit_mode(settings: &Settings) -> Option<FitMode> {
    match settings {
        Settings::Bw(s) => Some(s.fit.mode),
        Settings::Color(s) => Some(s.fit.mode),
        Settings::Limited(s) => Some(s.fit.mode),
        Settings::Halftone(_) => None,
    }
}

/// Boundary-length estimate for B&W and colour at Artistic (spline) fitting, the calibrated
/// domain; `Unavailable` otherwise.
pub fn estimate(seg: &Segmentation) -> Estimate {
    let ratio = match (&seg.req.settings, &seg.stage) {
        (Settings::Bw(_), Stage::Layers(_)) => BW_RATIO,
        (Settings::Color(_), Stage::Layers(_)) => COLOR_RATIO,
        (Settings::Limited(_), _) => {
            return Estimate::Unavailable {
                reason: "limited mode has no calibrated estimator yet",
            };
        }
        _ => {
            return Estimate::Unavailable {
                reason: "halftone dots are synthesised without a segmentation stage",
            };
        }
    };
    if fit_mode(&seg.req.settings) != Some(FitMode::Spline) {
        return Estimate::Unavailable {
            reason: "the estimator is calibrated for Artistic (spline) fitting only",
        };
    }
    let Stage::Layers(layers) = &seg.stage else {
        unreachable!("matched above")
    };
    let perimeter = trace::boundary_length(layers) as f64;
    Estimate::Range {
        anchors_low: (perimeter * ratio.0).floor() as u64,
        anchors_high: (perimeter * ratio.1 * HIGH_MARGIN).ceil() as u64,
        basis: "boundary-length (R03 calibration, Artistic defaults, +10 % high margin)",
    }
}

/// Completes a trace. `fit(segment(x))` equals `vectorize(x)` byte for byte.
pub fn fit(seg: Segmentation, clock: &dyn Fn() -> f64) -> Result<Output, EngineError> {
    fit_impl(seg, clock, None)
}

pub(crate) fn fit_impl(
    seg: Segmentation,
    clock: &dyn Fn() -> f64,
    precision_options: Option<precision::Options>,
) -> Result<Output, EngineError> {
    let Segmentation {
        req,
        data,
        width,
        height,
        mut timings,
        stage,
        mut warnings,
        partial_alpha,
        alpha_threshold,
        colors,
    } = seg;
    let t = &mut timings;
    let img = RgbaImage {
        width,
        height,
        data: &data,
    };
    let luma = Luma::new();
    let mut palette: Vec<PaletteEntry> = Vec::new();
    let mut background = None;
    let mut clip = None;
    let mut dots = 0;
    let mut stage_times = trace::StageTimes::default();
    let paths: Vec<Path> = match (&req.settings, stage) {
        (Settings::Bw(s), Stage::Layers(seg)) => {
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
                seg.0,
                &s.fit,
                params::Compositing::Stacked,
                0,
                &[],
                &input,
                clock,
                &mut stage_times,
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
        (Settings::Color(s), Stage::Layers(seg)) => {
            let input = trace::PrecisionInput {
                img,
                luma: &luma,
                policy: precision::EdgePolicy::Color {
                    alpha_threshold: s.alpha_threshold,
                },
                options: precision_options,
            };
            let doc = trace::fit_segmentation(
                seg.0,
                &s.fit,
                s.compositing,
                s.layer_difference,
                &[],
                &input,
                clock,
                &mut stage_times,
            )?;
            let ts = clock();
            let p = paths_with_palette(trace::doc_paths(&doc), &mut palette, "c");
            t.scene = clock() - ts;
            p
        }
        (Settings::Limited(s), Stage::Layers(seg)) => {
            for (i, c) in colors.iter().enumerate() {
                palette.push(PaletteEntry {
                    id: format!("p{i}"),
                    color: *c,
                });
            }
            let input = trace::PrecisionInput {
                img,
                luma: &luma,
                policy: precision::EdgePolicy::Color {
                    alpha_threshold: s.alpha_threshold,
                },
                options: precision_options,
            };
            let doc = trace::fit_segmentation(
                seg.0,
                &s.fit,
                s.compositing,
                1,
                &colors,
                &input,
                clock,
                &mut stage_times,
            )?;
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
        (Settings::Halftone(s), Stage::Halftone) => {
            t.preprocess = 0.0;
            let t0 = clock();
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
        _ => unreachable!("segment builds the stage that matches the settings"),
    };
    t.color_fit = stage_times.color_fit;
    t.compose = stage_times.compose;
    t.optimize = stage_times.optimize;

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
    let precision_fit_version = (precision_options.is_some() || fit_mode(&req.settings) == Some(FitMode::Precision))
        .then_some(precision::PRECISION_FIT_VERSION);
    Ok(Output {
        scene,
        metrics: Metrics {
            width,
            height,
            mode,
            timings_ms: timings,
            stats,
            palette_size,
            dots,
            precision_fit_version,
        },
        warnings,
    })
}
