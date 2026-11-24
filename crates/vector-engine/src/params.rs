//! Trace request schema. Deserialised from JSON at the WASM boundary, then validated;
//! unknown fields and out-of-range values are rejected (no silent clamping).

use serde::{Deserialize, Serialize};

use crate::color::Rgba;
use crate::error::EngineError;
use crate::image::DEFAULT_MAX_PIXELS;

pub const PRESET_VERSION: u32 = 1;
/// Default bound on on-curve points per scene (VALIDATION.md proposes ~100k primitives;
/// a primitive here is an anchor, and a halftone dot has 5).
pub const DEFAULT_MAX_ANCHORS: u64 = 1_000_000;
pub const HARD_MAX_ANCHORS: u64 = 5_000_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TraceRequest {
    pub preset_version: u32,
    #[serde(default)]
    pub seed: u32,
    #[serde(default = "default_max_pixels")]
    pub max_pixels: u64,
    #[serde(default = "default_max_anchors")]
    pub max_anchors: u64,
    pub settings: Settings,
}

fn default_max_pixels() -> u64 {
    DEFAULT_MAX_PIXELS
}
fn default_max_anchors() -> u64 {
    DEFAULT_MAX_ANCHORS
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum Settings {
    Bw(BwSettings),
    Color(ColorSettings),
    Limited(LimitedSettings),
    Halftone(HalftoneSettings),
}

impl Settings {
    pub fn mode(&self) -> &'static str {
        match self {
            Settings::Bw(_) => "bw",
            Settings::Color(_) => "color",
            Settings::Limited(_) => "limited",
            Settings::Halftone(_) => "halftone",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FitMode {
    /// VTracer spline fitting: the approved artistic behaviour for photographs and organic art.
    Spline,
    Polygon,
    Pixel,
    /// Vectra precision fitting for logos and geometric artwork: sub-pixel boundaries from the
    /// antialiased source, G1-continuous cubics, rebuilt corners and conservative circle/arc
    /// recognition (`precision.rs`, `PRECISION_FIT_VERSION`). Stacked compositing only;
    /// `cornerThreshold` applies, `lengthThreshold` and `spliceThreshold` do not.
    Precision,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Compositing {
    /// Regions painted bottom-to-top; smallest output, possible hairline drift between neighbours.
    Stacked,
    /// Seam-free shared boundaries (VTracer 1.0 mosaic).
    Mosaic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct FitSettings {
    pub mode: FitMode,
    /// Degrees; sharper turns become corners.
    pub corner_threshold: i32,
    /// Px; segment length used during spline fitting.
    pub length_threshold: f64,
    /// Degrees.
    pub splice_threshold: i32,
    /// Px tolerance of curve simplification; 0 disables it.
    pub simplify: f64,
}

impl Default for FitSettings {
    fn default() -> Self {
        Self {
            mode: FitMode::Spline,
            corner_threshold: 60,
            length_threshold: 4.0,
            splice_threshold: 45,
            simplify: 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct BwSettings {
    /// Pixels darker than this luminance (0–255) become ink.
    pub threshold: u8,
    pub invert: bool,
    /// Remove ink specks and fill holes smaller than this area (source px²).
    pub speckle: u32,
    /// Pixels with alpha below this are transparent background, never ink.
    pub alpha_threshold: u8,
    pub ink: Rgba,
    pub fit: FitSettings,
}

impl Default for BwSettings {
    fn default() -> Self {
        Self {
            threshold: 128,
            invert: false,
            speckle: 16,
            alpha_threshold: 128,
            ink: Rgba::BLACK,
            fit: FitSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct ColorSettings {
    /// Significant bits per channel (1–8).
    pub color_precision: i32,
    /// Colour difference between hierarchical layers (0–255).
    pub layer_difference: i32,
    pub speckle: u32,
    pub alpha_threshold: u8,
    pub compositing: Compositing,
    pub fit: FitSettings,
}

impl Default for ColorSettings {
    fn default() -> Self {
        Self {
            color_precision: 6,
            layer_difference: 16,
            speckle: 16,
            alpha_threshold: 128,
            compositing: Compositing::Stacked,
            fit: FitSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct LimitedSettings {
    /// Number of colours for automatic palette reduction (2–32).
    pub colors: u8,
    /// Explicit palette (2–32 colours, opaque). Overrides `colors`.
    pub palette: Option<Vec<Rgba>>,
    pub speckle: u32,
    pub alpha_threshold: u8,
    pub compositing: Compositing,
    pub fit: FitSettings,
}

impl Default for LimitedSettings {
    fn default() -> Self {
        Self {
            colors: 8,
            palette: None,
            speckle: 16,
            alpha_threshold: 128,
            compositing: Compositing::Mosaic,
            fit: FitSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DotPaths {
    /// All dots of one ink in one compound path (nonzero fill unions overlapping dots).
    Compound,
    /// One path element per dot (for size/performance comparison).
    PerDot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct HalftoneSettings {
    /// Grid pitch in source px (dot spacing).
    pub pitch: f64,
    /// Screen angle in degrees.
    pub angle: f64,
    pub ink: Rgba,
    /// Paper colour; `None` keeps the background transparent.
    pub paper: Option<Rgba>,
    /// Tone curve exponent applied to darkness (>1 lightens mid-tones).
    pub gamma: f64,
    /// −1..1; positive increases contrast around mid-grey.
    pub contrast: f64,
    /// Cells with ink coverage below this fraction get no dot.
    pub min_coverage: f64,
    pub dot_paths: DotPaths,
}

impl Default for HalftoneSettings {
    fn default() -> Self {
        Self {
            pitch: 8.0,
            angle: 45.0,
            ink: Rgba::rgb(0x1d, 0x1d, 0x1b),
            paper: Some(Rgba::rgb(0xf3, 0xea, 0xd8)),
            gamma: 1.0,
            contrast: 0.0,
            min_coverage: 0.02,
            dot_paths: DotPaths::Compound,
        }
    }
}

fn check(ok: bool, msg: &str) -> Result<(), EngineError> {
    if ok {
        Ok(())
    } else {
        Err(EngineError::InvalidParams(msg.to_string()))
    }
}

impl FitSettings {
    fn validate(&self) -> Result<(), EngineError> {
        check(
            (0..=180).contains(&self.corner_threshold),
            "fit.cornerThreshold must be 0–180",
        )?;
        check(
            (0..=180).contains(&self.splice_threshold),
            "fit.spliceThreshold must be 0–180",
        )?;
        check(
            self.length_threshold.is_finite() && (1.0..=20.0).contains(&self.length_threshold),
            "fit.lengthThreshold must be 1–20",
        )?;
        check(
            self.simplify.is_finite() && (0.0..=10.0).contains(&self.simplify),
            "fit.simplify must be 0–10",
        )?;
        check(
            self.mode != FitMode::Precision || self.simplify == 0.0,
            "fit.simplify is not used by precision fitting; it must be 0",
        )
    }

    fn validate_compositing(&self, c: Compositing) -> Result<(), EngineError> {
        check(
            self.mode != FitMode::Precision || c == Compositing::Stacked,
            "fit.mode precision requires compositing stacked",
        )
    }
}

impl TraceRequest {
    pub fn from_json(json: &str) -> Result<Self, EngineError> {
        let r: TraceRequest = serde_json::from_str(json).map_err(|e| EngineError::InvalidParams(e.to_string()))?;
        r.validate()?;
        Ok(r)
    }

    pub fn validate(&self) -> Result<(), EngineError> {
        check(self.preset_version == PRESET_VERSION, "unsupported presetVersion")?;
        check(self.max_pixels > 0, "maxPixels must be positive")?;
        check(
            (1..=HARD_MAX_ANCHORS).contains(&self.max_anchors),
            "maxAnchors out of range",
        )?;
        let speckle_ok = |s: u32| s <= 10_000;
        match &self.settings {
            Settings::Bw(s) => {
                check(speckle_ok(s.speckle), "speckle must be ≤ 10000")?;
                check(s.ink.a == 255, "ink must be opaque")?;
                s.fit.validate()
            }
            Settings::Color(s) => {
                check((1..=8).contains(&s.color_precision), "colorPrecision must be 1–8")?;
                check((0..=255).contains(&s.layer_difference), "layerDifference must be 0–255")?;
                check(speckle_ok(s.speckle), "speckle must be ≤ 10000")?;
                s.fit.validate_compositing(s.compositing)?;
                s.fit.validate()
            }
            Settings::Limited(s) => {
                check((2..=32).contains(&s.colors), "colors must be 2–32")?;
                if let Some(p) = &s.palette {
                    check((2..=32).contains(&p.len()), "palette must have 2–32 colours")?;
                    check(p.iter().all(|c| c.a == 255), "palette colours must be opaque")?;
                }
                check(speckle_ok(s.speckle), "speckle must be ≤ 10000")?;
                s.fit.validate_compositing(s.compositing)?;
                s.fit.validate()
            }
            Settings::Halftone(s) => {
                check(
                    s.pitch.is_finite() && (2.0..=200.0).contains(&s.pitch),
                    "pitch must be 2–200 px",
                )?;
                check(
                    s.angle.is_finite() && (-90.0..=90.0).contains(&s.angle),
                    "angle must be −90–90°",
                )?;
                check(
                    s.gamma.is_finite() && (0.2..=5.0).contains(&s.gamma),
                    "gamma must be 0.2–5",
                )?;
                check(
                    s.contrast.is_finite() && (-1.0..=1.0).contains(&s.contrast),
                    "contrast must be −1–1",
                )?;
                check(
                    s.min_coverage.is_finite() && (0.0..=0.5).contains(&s.min_coverage),
                    "minCoverage must be 0–0.5",
                )?;
                check(s.ink.a == 255, "ink must be opaque")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_defaults_and_rejects_unknown_or_out_of_range() {
        let r = TraceRequest::from_json(r#"{"presetVersion":1,"settings":{"mode":"bw"}}"#).unwrap();
        for ok in [
            r#"{"presetVersion":1,"settings":{"mode":"bw","fit":{"mode":"precision"}}}"#,
            r#"{"presetVersion":1,"settings":{"mode":"color","fit":{"mode":"precision"}}}"#,
            r#"{"presetVersion":1,"settings":{"mode":"limited","compositing":"stacked","fit":{"mode":"precision"}}}"#,
        ] {
            TraceRequest::from_json(ok).unwrap();
        }
        assert!(matches!(r.settings, Settings::Bw(BwSettings { threshold: 128, .. })));
        assert_eq!(r.max_pixels, DEFAULT_MAX_PIXELS);
        for bad in [
            r#"{"presetVersion":2,"settings":{"mode":"bw"}}"#,
            r#"{"presetVersion":1,"settings":{"mode":"bw","threshhold":3}}"#,
            r#"{"presetVersion":1,"settings":{"mode":"bw","threshold":300}}"#,
            r#"{"presetVersion":1,"settings":{"mode":"sepia"}}"#,
            r#"{"presetVersion":1,"settings":{"mode":"limited","colors":1}}"#,
            r#"{"presetVersion":1,"settings":{"mode":"halftone","pitch":0.5}}"#,
            r#"{"presetVersion":1,"settings":{"mode":"color","fit":{"simplify":-1}}}"#,
            r#"{"presetVersion":1,"extra":0,"settings":{"mode":"bw"}}"#,
            r#"{"presetVersion":1,"settings":{"mode":"limited","fit":{"mode":"precision"}}}"#,
            r#"{"presetVersion":1,"settings":{"mode":"color","compositing":"mosaic","fit":{"mode":"precision"}}}"#,
            r#"{"presetVersion":1,"settings":{"mode":"color","fit":{"mode":"precision","simplify":1}}}"#,
        ] {
            assert!(TraceRequest::from_json(bad).is_err(), "{bad}");
        }
    }
}
