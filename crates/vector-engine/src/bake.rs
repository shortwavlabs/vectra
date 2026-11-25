//! Export baking (G-0 contracts C3.1, C4, C8): turns a frozen draw list of effective values
//! (transform, style, fill rule, clip run) plus the referenced packets into one validated
//! scene v1 for the SVG and PDF writers.
//!
//! - Identity transforms copy coordinates bit for bit (no arithmetic), so an unedited trace
//!   with unchanged styles reproduces its original scene and export hashes.
//! - Other transforms are applied in f64. Stroked paths accept only similarity transforms
//!   (uniform scale with rotation or reflection); widths are never averaged (RFC §5.1).
//! - Runs become scene groups in order, including empty runs; the caller omits fully clipped
//!   items and empty-clip runs (C8 rules 4 and 6). Visibility is resolved by the caller.

use serde::{Deserialize, Serialize};

use crate::error::EngineError;
use crate::packet::{GeometryPacket, Limits, SceneMeta, StrokeStyle, Style, validate_packet};
use crate::scene::{ClipRect, Group, SCENE_VERSION, Scene};

pub const IDENTITY: [f64; 6] = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Run {
    pub id: String,
    /// Effective clip in document space, or `None`.
    pub clip: Option<ClipRect>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DrawItem {
    /// Index into the packet slice passed to [`bake_draw_list`].
    pub chunk: u32,
    pub path_index: u32,
    /// Effective 2×3 affine `[a, b, c, d, e, f]`: `x' = a·x + c·y + e`, `y' = b·x + d·y + f`.
    pub transform: [f64; 6],
    /// Effective style (C3.1): fill RGBA8888, palette entry, stroke, fill rule.
    pub fill: Option<u32>,
    pub palette_id: Option<String>,
    pub stroke: Option<StrokeStyle>,
    pub even_odd: bool,
    /// Index into `runs`; non-decreasing in paint order.
    pub group_run: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DrawList {
    /// Artboard size (physical output size is chosen by the writer options).
    pub width: f64,
    pub height: f64,
    pub runs: Vec<Run>,
    /// Visible, not fully clipped items in paint order.
    pub items: Vec<DrawItem>,
}

fn bad(m: impl Into<String>) -> EngineError {
    EngineError::InvalidScene(m.into())
}

/// Uniform scale of a similarity transform, or `None` if the transform distorts strokes.
fn similarity_scale(t: &[f64; 6]) -> Option<f64> {
    let [a, b, c, d, _, _] = *t;
    let rotation = a == d && b == -c;
    let reflection = a == -d && b == c;
    (rotation || reflection).then(|| (a * d - b * c).abs().sqrt())
}

/// Bakes a draw list into a validated scene v1. Every packet is validated (engineering limits)
/// and the scene is validated against `limits.max_anchors`.
pub fn bake_draw_list(
    list: &DrawList,
    packets: &[GeometryPacket],
    meta: &SceneMeta,
    limits: &Limits,
) -> Result<Scene, EngineError> {
    let mut derived = Vec::with_capacity(packets.len());
    for (k, p) in packets.iter().enumerate() {
        derived.push(validate_packet(p, &Limits::ENGINEERING).map_err(|e| bad(format!("packet {k}: {e}")))?);
    }
    // Anchors per reference, checked before any geometry is copied (review finding 4).
    let mut anchors = 0u64;
    for (n, item) in list.items.iter().enumerate() {
        let d = derived
            .get(item.chunk as usize)
            .ok_or_else(|| bad(format!("item {n}: chunk {} does not exist", item.chunk)))?;
        let a = d
            .path_anchors
            .get(item.path_index as usize)
            .ok_or_else(|| bad(format!("item {n}: path {} does not exist", item.path_index)))?;
        anchors += u64::from(*a);
        if anchors > limits.max_anchors {
            return Err(EngineError::TooManyPrimitives {
                count: anchors,
                limit: limits.max_anchors,
            });
        }
    }
    let mut groups: Vec<Group> = list
        .runs
        .iter()
        .map(|r| Group {
            id: r.id.clone(),
            clip: r.clip,
            paths: Vec::new(),
        })
        .collect();
    let mut last_run = 0u32;
    for (n, item) in list.items.iter().enumerate() {
        if item.group_run < last_run {
            return Err(bad(format!("item {n}: runs out of paint order")));
        }
        last_run = item.group_run;
        let group = groups
            .get_mut(item.group_run as usize)
            .ok_or_else(|| bad(format!("item {n}: run {} does not exist", item.group_run)))?;
        let packet = packets
            .get(item.chunk as usize)
            .ok_or_else(|| bad(format!("item {n}: chunk {} does not exist", item.chunk)))?;
        if item.path_index >= packet.manifest.path_count {
            return Err(bad(format!("item {n}: path {} does not exist", item.path_index)));
        }
        if !item.transform.iter().all(|v| v.is_finite()) {
            return Err(bad(format!("item {n}: non-finite transform")));
        }
        let identity = item.transform == IDENTITY;
        let stroke = match (item.stroke, identity) {
            (None, _) => None,
            (Some(s), true) => Some(s),
            (Some(s), false) => {
                let scale = similarity_scale(&item.transform).ok_or_else(|| {
                    bad(format!(
                        "item {n}: non-uniform transform on a stroked path is not supported"
                    ))
                })?;
                Some(StrokeStyle {
                    color: s.color,
                    width: s.width * scale,
                })
            }
        };
        let style = Style {
            fill: item.fill,
            palette_id: item.palette_id.clone(),
            stroke,
            even_odd: item.even_odd,
        };
        let mut path = packet.scene_path(item.path_index as usize, &style)?;
        if !identity {
            let [a, b, c, d, e, f] = item.transform;
            for xy in path.coords.chunks_exact_mut(2) {
                let (x, y) = (xy[0], xy[1]);
                xy[0] = a * x + c * y + e;
                xy[1] = b * x + d * y + f;
            }
        }
        group.paths.push(path);
    }
    let scene = Scene {
        version: SCENE_VERSION,
        width: list.width,
        height: list.height,
        background: meta.background,
        palette: meta.palette.clone(),
        groups,
        metadata: meta.metadata.clone(),
    };
    scene.validate(limits.max_anchors)?;
    Ok(scene)
}

/// The draw list an unedited packet maps to under C3.1 (identity transforms, packet styles,
/// one run per packet group). Used by the P0-route byte-identity regression.
pub fn identity_draw_list(packet: &GeometryPacket, chunk: u32) -> DrawList {
    let m = &packet.manifest;
    DrawList {
        width: m.width,
        height: m.height,
        runs: m
            .groups
            .iter()
            .map(|g| Run {
                id: g.id.clone(),
                clip: g.clip,
            })
            .collect(),
        items: (0..m.path_count as usize)
            .map(|i| {
                let s = &m.styles[packet.style_index[i] as usize];
                DrawItem {
                    chunk,
                    path_index: i as u32,
                    transform: IDENTITY,
                    fill: s.fill,
                    palette_id: s.palette_id.clone(),
                    stroke: s.stroke,
                    even_odd: s.even_odd,
                    group_run: packet.group_index[i],
                }
            })
            .collect(),
    }
}
