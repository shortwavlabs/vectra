//! Canonical, versioned vector scene. Every export (SVG, PDF) and the preview are generated
//! from a scene that has passed `Scene::validate`.
//!
//! Geometry: absolute coordinates in source-pixel units (origin top-left, y down).
//! Paths use only `M`, `L`, `C` (cubic Bézier) and `Z`; quadratics must be converted to cubics
//! and transforms baked in before a path enters the scene. The only clipping primitive is an
//! optional axis-aligned rectangle per group.

use serde::{Deserialize, Serialize};

use crate::color::Rgba;
use crate::error::EngineError;
use crate::image::MAX_DIMENSION;

pub const SCENE_VERSION: u32 = 1;
/// Coordinates beyond this magnitude are rejected (guards serializers and PDF f32 operands).
pub const MAX_COORD: f64 = 1.0e6;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scene {
    pub version: u32,
    pub width: f64,
    pub height: f64,
    /// Optional opaque or translucent background fill. `None` = transparent.
    pub background: Option<Rgba>,
    pub palette: Vec<PaletteEntry>,
    /// Paint order: first group is drawn first (bottom).
    pub groups: Vec<Group>,
    pub metadata: Metadata,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaletteEntry {
    pub id: String,
    pub color: Rgba,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Group {
    pub id: String,
    pub clip: Option<ClipRect>,
    pub paths: Vec<Path>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClipRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FillRule {
    Nonzero,
    Evenodd,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Fill {
    pub color: Rgba,
    pub palette_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Stroke {
    pub color: Rgba,
    pub width: f64,
}

/// A compound path: `verbs` is a string over `M L C Z`; `coords` holds 2 numbers per
/// `M`/`L`, 6 per `C`, none per `Z`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Path {
    pub fill: Option<Fill>,
    pub stroke: Option<Stroke>,
    pub fill_rule: FillRule,
    pub verbs: String,
    pub coords: Vec<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Metadata {
    pub generator: String,
    pub engine_version: String,
    pub mode: String,
    pub preset_version: u32,
    pub seed: u32,
    pub source_width: u32,
    pub source_height: u32,
    /// The validated parameters that produced the scene (no file names or user data).
    pub params: serde_json::Value,
}

/// Incremental builder for `Path` geometry.
#[derive(Default)]
pub struct PathBuilder {
    verbs: String,
    coords: Vec<f64>,
}

impl PathBuilder {
    pub fn move_to(&mut self, x: f64, y: f64) {
        self.verbs.push('M');
        self.coords.extend_from_slice(&[x, y]);
    }
    pub fn line_to(&mut self, x: f64, y: f64) {
        self.verbs.push('L');
        self.coords.extend_from_slice(&[x, y]);
    }
    pub fn cubic_to(&mut self, c: [f64; 6]) {
        self.verbs.push('C');
        self.coords.extend_from_slice(&c);
    }
    pub fn close(&mut self) {
        self.verbs.push('Z');
    }
    pub fn is_empty(&self) -> bool {
        self.verbs.is_empty()
    }
    pub fn finish(self, fill: Option<Fill>, fill_rule: FillRule) -> Path {
        Path {
            fill,
            stroke: None,
            fill_rule,
            verbs: self.verbs,
            coords: self.coords,
        }
    }
}

/// Size statistics computed during validation.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneStats {
    pub groups: u64,
    pub paths: u64,
    pub subpaths: u64,
    /// On-curve points (path starts plus segment end points).
    pub anchors: u64,
    pub lines: u64,
    pub cubics: u64,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn finite_in_range(v: f64) -> bool {
    v.is_finite() && v.abs() <= MAX_COORD
}

impl Scene {
    /// Validates structure, references and geometry. `max_anchors` bounds output size.
    pub fn validate(&self, max_anchors: u64) -> Result<SceneStats, EngineError> {
        let bad = |m: String| Err(EngineError::InvalidScene(m));
        if self.version != SCENE_VERSION {
            return bad(format!("unsupported scene version {}", self.version));
        }
        let max_dim = f64::from(MAX_DIMENSION);
        for (name, v) in [("width", self.width), ("height", self.height)] {
            if !(v.is_finite() && v > 0.0 && v <= max_dim) {
                return bad(format!("{name} {v} out of range"));
            }
        }
        let mut palette_ids = std::collections::BTreeMap::new();
        for e in &self.palette {
            if !valid_id(&e.id) || palette_ids.insert(e.id.as_str(), e.color).is_some() {
                return bad(format!("invalid or duplicate palette id {:?}", e.id));
            }
        }
        let mut stats = SceneStats::default();
        let mut group_ids = std::collections::BTreeSet::new();
        for g in &self.groups {
            if !valid_id(&g.id) || !group_ids.insert(g.id.as_str()) {
                return bad(format!("invalid or duplicate group id {:?}", g.id));
            }
            if let Some(c) = g.clip {
                let ok = [c.x, c.y, c.width, c.height].iter().all(|v| finite_in_range(*v))
                    && c.width > 0.0
                    && c.height > 0.0;
                if !ok {
                    return bad(format!("invalid clip rectangle in group {}", g.id));
                }
            }
            stats.groups += 1;
            for p in &g.paths {
                if p.fill.is_none() && p.stroke.is_none() {
                    return bad("path has neither fill nor stroke".into());
                }
                if let Some(f) = &p.fill
                    && let Some(id) = &f.palette_id
                {
                    match palette_ids.get(id.as_str()) {
                        Some(c) if *c == f.color => {}
                        Some(_) => return bad(format!("fill colour does not match palette entry {id}")),
                        None => return bad(format!("unknown palette id {id}")),
                    }
                }
                if let Some(s) = &p.stroke
                    && !(s.width.is_finite() && s.width > 0.0 && s.width <= 1000.0)
                {
                    return bad(format!("stroke width {} out of range", s.width));
                }
                validate_geometry(p, &mut stats).map_err(EngineError::InvalidScene)?;
                stats.paths += 1;
            }
        }
        if stats.anchors > max_anchors {
            return Err(EngineError::TooManyPrimitives {
                count: stats.anchors,
                limit: max_anchors,
            });
        }
        Ok(stats)
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("scene serialization cannot fail")
    }

    pub fn from_json(json: &str) -> Result<Scene, EngineError> {
        serde_json::from_str(json).map_err(|e| EngineError::InvalidScene(e.to_string()))
    }
}

fn validate_geometry(p: &Path, stats: &mut SceneStats) -> Result<(), String> {
    let mut ci = 0usize;
    let mut open = false; // inside a subpath that has not been closed
    let mut started = false; // a subpath exists (for segments after Z we require a new M)
    let take = |n: usize, ci: &mut usize| -> Result<(), String> {
        let end = ci.checked_add(n).ok_or("coordinate overflow")?;
        let slice = p.coords.get(*ci..end).ok_or("too few coordinates for verbs")?;
        if !slice.iter().all(|v| finite_in_range(*v)) {
            return Err("non-finite or out-of-range coordinate".into());
        }
        *ci = end;
        Ok(())
    };
    if p.verbs.is_empty() {
        return Err("empty path".into());
    }
    for v in p.verbs.bytes() {
        match v {
            b'M' => {
                take(2, &mut ci)?;
                stats.subpaths += 1;
                stats.anchors += 1;
                open = true;
                started = true;
            }
            b'L' | b'C' => {
                if !open {
                    return Err("segment without a current point (missing M)".into());
                }
                take(if v == b'L' { 2 } else { 6 }, &mut ci)?;
                stats.anchors += 1;
                if v == b'L' {
                    stats.lines += 1;
                } else {
                    stats.cubics += 1;
                }
            }
            b'Z' => {
                if !open {
                    return Err("Z without an open subpath".into());
                }
                open = false;
            }
            other => return Err(format!("unsupported path verb {:?}", other as char)),
        }
    }
    if !started {
        return Err("path has no subpath".into());
    }
    if ci != p.coords.len() {
        return Err("more coordinates than verbs require".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scene_with(path: Path) -> Scene {
        Scene {
            version: SCENE_VERSION,
            width: 10.0,
            height: 10.0,
            background: None,
            palette: vec![PaletteEntry {
                id: "ink".into(),
                color: Rgba::BLACK,
            }],
            groups: vec![Group {
                id: "g".into(),
                clip: None,
                paths: vec![path],
            }],
            metadata: Metadata {
                generator: "test".into(),
                engine_version: "0".into(),
                mode: "test".into(),
                preset_version: 1,
                seed: 0,
                source_width: 10,
                source_height: 10,
                params: serde_json::Value::Null,
            },
        }
    }

    fn path(verbs: &str, coords: Vec<f64>) -> Path {
        Path {
            fill: Some(Fill {
                color: Rgba::BLACK,
                palette_id: Some("ink".into()),
            }),
            stroke: None,
            fill_rule: FillRule::Evenodd,
            verbs: verbs.into(),
            coords,
        }
    }

    #[test]
    fn valid_scene_stats_and_json_roundtrip() {
        let s = scene_with(path("MLCZ", vec![0., 0., 1., 0., 1., 1., 2., 2., 0., 2.]));
        let stats = s.validate(100).unwrap();
        assert_eq!((stats.subpaths, stats.anchors, stats.lines, stats.cubics), (1, 3, 1, 1));
        let back = Scene::from_json(&s.to_json()).unwrap();
        assert_eq!(back, s);
        assert_eq!(back.to_json(), s.to_json(), "serialization is deterministic");
    }

    #[test]
    fn rejects_malformed_geometry_and_references() {
        let cases = [
            path("LZ", vec![0., 0.]),
            path("MZ", vec![0., 0., 1.]),
            path("ML", vec![0., 0.]),
            path("MQ", vec![0., 0., 1., 1., 2., 2.]),
            path("ML", vec![0., 0., f64::NAN, 1.]),
            path("MZL", vec![0., 0., 1., 1.]),
            path("M", vec![2.0e6, 0.]),
            path("", vec![]),
        ];
        for p in cases {
            assert!(
                scene_with(p.clone()).validate(100).is_err(),
                "{:?} should be rejected",
                p.verbs
            );
        }
        let mut wrong_palette = path("ML", vec![0., 0., 1., 1.]);
        wrong_palette.fill = Some(Fill {
            color: Rgba::rgb(1, 2, 3),
            palette_id: Some("ink".into()),
        });
        assert!(scene_with(wrong_palette).validate(100).is_err());
        assert!(matches!(
            scene_with(path("MLLL", vec![0.; 8])).validate(3),
            Err(EngineError::TooManyPrimitives { count: 4, limit: 3 })
        ));
        assert!(Scene::from_json(r#"{"version":1,"unexpected":true}"#).is_err());
    }
}
