//! GeometryPacket v1 (G-0 contract C3): the editor's only geometry transport and storage
//! format. Six flat sections (verbs, coords, per-path offsets with sentinels, style and group
//! indices) plus a JSON-compatible manifest. Bounds, per-path anchors and subpath starts are
//! derived in the single validation pass and never transported.
//!
//! Validation order and error codes are shared with the TypeScript validator
//! (`src/geometry/packet/validate.ts`); both run the fixtures in
//! `tests/fixtures/packet-conformance/`. All size arithmetic is `u64` with checked operations:
//! `usize` is 32-bit on wasm32, so a size is converted only after its cap check passes.

use std::collections::HashMap;
use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::color::Rgba;
use crate::error::EngineError;
use crate::scene::{
    ClipRect, Fill, FillRule, Group, MAX_COORD, Metadata, PaletteEntry, Path, SCENE_VERSION, Scene, Stroke,
};

pub const PACKET_VERSION: u32 = 1;
/// Artboard dimension bound (C3 manifest).
pub const MAX_ARTBOARD: f64 = 16_384.0;
/// Style and group table bound (C3 manifest).
pub const MAX_TABLE_ENTRIES: usize = 65_536;
/// Canonical manifest JSON bound for byte streams (C3.0).
pub const MAX_MANIFEST_BYTES: u64 = 16 << 20;

pub const VERB_M: u8 = 0;
pub const VERB_L: u8 = 1;
pub const VERB_C: u8 = 2;
pub const VERB_Z: u8 = 3;
const ARITY: [u32; 4] = [2, 2, 6, 0];

/// Shared error codes (C3). `Type` cannot occur in Rust (array types are static); it exists so
/// both validators report from the same closed set.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    Version,
    Manifest,
    Budget,
    Type,
    Length,
    Offsets,
    Ref,
    Opcode,
    Grammar,
    Arity,
    Coord,
    Padding,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Version => "version",
            Self::Manifest => "manifest",
            Self::Budget => "budget",
            Self::Type => "type",
            Self::Length => "length",
            Self::Offsets => "offsets",
            Self::Ref => "ref",
            Self::Opcode => "opcode",
            Self::Grammar => "grammar",
            Self::Arity => "arity",
            Self::Coord => "coord",
            Self::Padding => "padding",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PacketError {
    pub code: ErrorCode,
    pub message: String,
}

impl fmt::Display for PacketError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code.as_str(), self.message)
    }
}

impl std::error::Error for PacketError {}

fn fail<T>(code: ErrorCode, message: impl Into<String>) -> Result<T, PacketError> {
    Err(PacketError {
        code,
        message: message.into(),
    })
}

/// Caps checked before allocation (C3.2). A profile may lower them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub max_paths: u64,
    pub max_anchors: u64,
    /// Bound on `M_mem + D_max` (in-memory sections plus the derived-metadata upper bound).
    pub max_bytes: u64,
}

impl Limits {
    /// Product defaults: 1M paths, 1M anchors, 512 MiB.
    pub const PRODUCT: Limits = Limits {
        max_paths: 1_000_000,
        max_anchors: 1_000_000,
        max_bytes: 512 << 20,
    };
    /// Engine engineering ceiling (5M anchors); never a product limit.
    pub const ENGINEERING: Limits = Limits {
        max_paths: 1_000_000,
        max_anchors: 5_000_000,
        max_bytes: 512 << 20,
    };
}

impl Default for Limits {
    fn default() -> Self {
        Self::PRODUCT
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StrokeStyle {
    /// RGBA8888.
    pub color: u32,
    pub width: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Style {
    /// RGBA8888, or `None` for no fill.
    pub fill: Option<u32>,
    pub palette_id: Option<String>,
    pub stroke: Option<StrokeStyle>,
    pub even_odd: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupEntry {
    pub id: String,
    pub clip: Option<ClipRect>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub packet_version: u32,
    pub width: f64,
    pub height: f64,
    pub path_count: u32,
    pub verb_count: u32,
    pub coord_count: u32,
    pub styles: Vec<Style>,
    pub groups: Vec<GroupEntry>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GeometryPacket {
    pub manifest: Manifest,
    pub verbs: Vec<u8>,
    pub coords: Vec<f64>,
    pub verb_offsets: Vec<u32>,
    pub coord_offsets: Vec<u32>,
    pub style_index: Vec<u32>,
    pub group_index: Vec<u32>,
}

/// Derived in the validation pass (C3.1); never transported.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Derived {
    /// Control-point bounds `[x0, y0, x1, y1]` per path.
    pub bounds: Vec<f64>,
    pub path_anchors: Vec<u32>,
    /// Verb index of every M.
    pub subpath_start: Vec<u32>,
    pub anchors: u32,
}

/// Scene-level data the packet does not carry (C4 `SceneMeta`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SceneMeta {
    pub background: Option<Rgba>,
    pub palette: Vec<PaletteEntry>,
    pub metadata: Metadata,
}

impl SceneMeta {
    /// Parses scene meta JSON (C10 number formatting). When `metadata.params` parses as the
    /// engine's `Settings`, it is re-serialised through `Settings`, restoring the engine's own
    /// formatting (`8.0`, not `8`) after a JavaScript or canonical-JSON round trip. Any other
    /// params value (for example document-form metadata) is kept as given.
    pub fn from_json(json: &str) -> Result<SceneMeta, EngineError> {
        let mut meta: SceneMeta =
            serde_json::from_str(json).map_err(|e| EngineError::InvalidScene(format!("scene meta: {e}")))?;
        if let Ok(settings) = serde_json::from_value::<crate::params::Settings>(meta.metadata.params.clone()) {
            meta.metadata.params = serde_json::to_value(&settings).expect("settings serialize");
        }
        Ok(meta)
    }

    pub fn from_scene(scene: &Scene) -> SceneMeta {
        SceneMeta {
            background: scene.background,
            palette: scene.palette.clone(),
            metadata: scene.metadata.clone(),
        }
    }
}

/// Exact sizes (C3.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Sizes {
    /// `V + 8C + 16P + 8`.
    pub in_memory: u64,
    /// `36P + 4V`, known before validation.
    pub derived_max: u64,
    /// Serialized block length `B` (C3.0).
    pub block: u64,
}

fn checked(a: Option<u64>) -> Result<u64, PacketError> {
    a.ok_or_else(|| PacketError {
        code: ErrorCode::Budget,
        message: "size arithmetic overflow".into(),
    })
}

fn align8(x: u64) -> Option<u64> {
    x.checked_add((8 - x % 8) % 8)
}

/// Section byte lengths in table order.
fn section_lengths(p: u64, v: u64, c: u64) -> Result<[u64; 6], PacketError> {
    let p1 = checked(p.checked_add(1))?;
    Ok([
        v,
        checked(c.checked_mul(8))?,
        checked(p1.checked_mul(4))?,
        checked(p1.checked_mul(4))?,
        checked(p.checked_mul(4))?,
        checked(p.checked_mul(4))?,
    ])
}

/// Section start offsets within the block and the block length `B` (C3.0).
fn layout(p: u64, v: u64, c: u64) -> Result<([u64; 6], u64), PacketError> {
    let lens = section_lengths(p, v, c)?;
    let mut offsets = [0u64; 6];
    let mut at = 0u64;
    for (k, len) in lens.iter().enumerate() {
        offsets[k] = at;
        at = checked(at.checked_add(*len))?;
        if k < 5 {
            at = checked(align8(at))?;
        }
    }
    Ok((offsets, checked(align8(at))?))
}

impl Sizes {
    pub fn of(path_count: u32, verb_count: u32, coord_count: u32) -> Result<Sizes, PacketError> {
        let (p, v, c) = (u64::from(path_count), u64::from(verb_count), u64::from(coord_count));
        let lens = section_lengths(p, v, c)?;
        let mut in_memory = 0u64;
        for l in lens {
            in_memory = checked(in_memory.checked_add(l))?;
        }
        let derived_max = checked(checked(p.checked_mul(36))?.checked_add(checked(v.checked_mul(4))?))?;
        let (_, block) = layout(p, v, c)?;
        Ok(Sizes {
            in_memory,
            derived_max,
            block,
        })
    }
}

/// The scene-v1 id rule: 1–64 bytes of ASCII `[A-Za-z0-9_-]`.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn valid_clip(c: &ClipRect) -> bool {
    [c.x, c.y, c.width, c.height]
        .iter()
        .all(|v| v.is_finite() && v.abs() <= MAX_COORD)
        && c.width > 0.0
        && c.height > 0.0
}

fn valid_dimension(v: f64) -> bool {
    v.is_finite() && v > 0.0 && v <= MAX_ARTBOARD
}

/// Step 2 caps (`budget`), in this order: P, V, C, `M_mem + D_max`.
fn check_caps(m: &Manifest, limits: &Limits) -> Result<Sizes, PacketError> {
    let (p, v, c) = (
        u64::from(m.path_count),
        u64::from(m.verb_count),
        u64::from(m.coord_count),
    );
    if p > limits.max_paths || p > limits.max_anchors {
        return fail(
            ErrorCode::Budget,
            format!("pathCount {p} exceeds the path or anchor cap"),
        );
    }
    if v > limits.max_anchors.saturating_mul(2) {
        return fail(ErrorCode::Budget, format!("verbCount {v} exceeds 2 × the anchor cap"));
    }
    if c > limits.max_anchors.saturating_mul(6) {
        return fail(ErrorCode::Budget, format!("coordCount {c} exceeds 6 × the anchor cap"));
    }
    let sizes = Sizes::of(m.path_count, m.verb_count, m.coord_count)?;
    let total = checked(sizes.in_memory.checked_add(sizes.derived_max))?;
    if total > limits.max_bytes {
        return fail(
            ErrorCode::Budget,
            format!("declared {total} bytes exceed {}", limits.max_bytes),
        );
    }
    Ok(sizes)
}

/// Steps 1–2 on an already-typed manifest (a packet built in Rust).
pub fn check_manifest(m: &Manifest, limits: &Limits) -> Result<Sizes, PacketError> {
    if m.packet_version != PACKET_VERSION {
        return fail(
            ErrorCode::Version,
            format!("unsupported packet version {}", m.packet_version),
        );
    }
    if !valid_dimension(m.width) || !valid_dimension(m.height) {
        return fail(ErrorCode::Manifest, "artboard size out of range");
    }
    if m.styles.len() > MAX_TABLE_ENTRIES {
        return fail(ErrorCode::Budget, "too many styles");
    }
    for (i, s) in m.styles.iter().enumerate() {
        if s.palette_id.as_deref().is_some_and(|id| !valid_id(id)) {
            return fail(ErrorCode::Manifest, format!("style {i}: invalid paletteId"));
        }
        if s.stroke
            .is_some_and(|st| !(st.width.is_finite() && st.width > 0.0 && st.width <= 1000.0))
        {
            return fail(ErrorCode::Manifest, format!("style {i}: stroke width out of range"));
        }
    }
    if m.groups.len() > MAX_TABLE_ENTRIES {
        return fail(ErrorCode::Budget, "too many groups");
    }
    for (i, g) in m.groups.iter().enumerate() {
        if !valid_id(&g.id) {
            return fail(ErrorCode::Manifest, format!("group {i}: invalid id"));
        }
        if g.clip.as_ref().is_some_and(|c| !valid_clip(c)) {
            return fail(ErrorCode::Manifest, format!("group {i}: invalid clip"));
        }
    }
    check_caps(m, limits)
}

// ---- Manifest parsing from JSON (identical semantics to the TS validator) ----

fn exact_keys(o: &Map<String, Value>, keys: &[&str]) -> bool {
    o.len() == keys.len() && keys.iter().all(|k| o.contains_key(*k))
}

/// An integer in `[0, max]`. JSON `1.0` is the integer 1, as in JavaScript.
fn as_uint(v: &Value, max: u64) -> Option<u64> {
    let n = v.as_number()?;
    if let Some(u) = n.as_u64() {
        return (u <= max).then_some(u);
    }
    let f = n.as_f64()?;
    (f.is_finite() && f >= 0.0 && f.fract() == 0.0 && f <= max as f64).then_some(f as u64)
}

fn as_finite(v: &Value) -> Option<f64> {
    v.as_f64().filter(|f| f.is_finite())
}

fn parse_clip(v: &Value) -> Option<Option<ClipRect>> {
    if v.is_null() {
        return Some(None);
    }
    let o = v.as_object()?;
    if !exact_keys(o, &["x", "y", "width", "height"]) {
        return None;
    }
    let c = ClipRect {
        x: as_finite(&o["x"])?,
        y: as_finite(&o["y"])?,
        width: as_finite(&o["width"])?,
        height: as_finite(&o["height"])?,
    };
    valid_clip(&c).then_some(Some(c))
}

fn parse_style(v: &Value) -> Option<Style> {
    let o = v.as_object()?;
    if !exact_keys(o, &["fill", "paletteId", "stroke", "evenOdd"]) {
        return None;
    }
    let fill = match &o["fill"] {
        Value::Null => None,
        f => Some(as_uint(f, u64::from(u32::MAX))? as u32),
    };
    let palette_id = match &o["paletteId"] {
        Value::Null => None,
        Value::String(s) if valid_id(s) => Some(s.clone()),
        _ => return None,
    };
    let stroke = match &o["stroke"] {
        Value::Null => None,
        Value::Object(s) => {
            if !exact_keys(s, &["color", "width"]) {
                return None;
            }
            let width = as_finite(&s["width"]).filter(|w| *w > 0.0 && *w <= 1000.0)?;
            Some(StrokeStyle {
                color: as_uint(&s["color"], u64::from(u32::MAX))? as u32,
                width,
            })
        }
        _ => return None,
    };
    Some(Style {
        fill,
        palette_id,
        stroke,
        even_odd: o["evenOdd"].as_bool()?,
    })
}

fn parse_group(v: &Value) -> Option<GroupEntry> {
    let o = v.as_object()?;
    if !exact_keys(o, &["id", "clip"]) {
        return None;
    }
    let id = o["id"].as_str().filter(|s| valid_id(s))?.to_string();
    Some(GroupEntry {
        id,
        clip: parse_clip(&o["clip"])?,
    })
}

/// Steps 1–2 on a JSON manifest. Sub-order within step 2 (shared with TS): key set, artboard,
/// counts, styles (table cap, then entries), groups (table cap, then entries), then the caps.
pub fn parse_manifest(v: &Value, limits: &Limits) -> Result<Manifest, PacketError> {
    if v.get("packetVersion").and_then(Value::as_f64) != Some(1.0) {
        return fail(ErrorCode::Version, "unsupported or missing packetVersion");
    }
    let Some(o) = v.as_object() else {
        return fail(ErrorCode::Manifest, "manifest is not an object");
    };
    if !exact_keys(
        o,
        &[
            "packetVersion",
            "width",
            "height",
            "pathCount",
            "verbCount",
            "coordCount",
            "styles",
            "groups",
        ],
    ) {
        return fail(ErrorCode::Manifest, "manifest keys do not match C3");
    }
    let width = as_finite(&o["width"]).filter(|d| valid_dimension(*d));
    let height = as_finite(&o["height"]).filter(|d| valid_dimension(*d));
    let (Some(width), Some(height)) = (width, height) else {
        return fail(ErrorCode::Manifest, "artboard size out of range");
    };
    let count = |k: &str| as_uint(&o[k], u64::from(u32::MAX)).map(|n| n as u32);
    let (Some(path_count), Some(verb_count), Some(coord_count)) =
        (count("pathCount"), count("verbCount"), count("coordCount"))
    else {
        return fail(ErrorCode::Manifest, "counts must be integers in [0, 2^32-1]");
    };
    let Some(styles_v) = o["styles"].as_array() else {
        return fail(ErrorCode::Manifest, "styles is not an array");
    };
    if styles_v.len() > MAX_TABLE_ENTRIES {
        return fail(ErrorCode::Budget, "too many styles");
    }
    let mut styles = Vec::with_capacity(styles_v.len());
    for (i, s) in styles_v.iter().enumerate() {
        match parse_style(s) {
            Some(s) => styles.push(s),
            None => return fail(ErrorCode::Manifest, format!("style {i} is invalid")),
        }
    }
    let Some(groups_v) = o["groups"].as_array() else {
        return fail(ErrorCode::Manifest, "groups is not an array");
    };
    if groups_v.len() > MAX_TABLE_ENTRIES {
        return fail(ErrorCode::Budget, "too many groups");
    }
    let mut groups = Vec::with_capacity(groups_v.len());
    for (i, g) in groups_v.iter().enumerate() {
        match parse_group(g) {
            Some(g) => groups.push(g),
            None => return fail(ErrorCode::Manifest, format!("group {i} is invalid")),
        }
    }
    let m = Manifest {
        packet_version: PACKET_VERSION,
        width,
        height,
        path_count,
        verb_count,
        coord_count,
        styles,
        groups,
    };
    check_caps(&m, limits)?;
    Ok(m)
}

pub fn parse_manifest_json(json: &str, limits: &Limits) -> Result<Manifest, PacketError> {
    if json.len() as u64 > MAX_MANIFEST_BYTES {
        return fail(
            ErrorCode::Budget,
            format!("manifest text larger than {MAX_MANIFEST_BYTES} bytes"),
        );
    }
    let v: Value = serde_json::from_str(json).map_err(|e| PacketError {
        code: ErrorCode::Manifest,
        message: format!("manifest is not valid JSON: {e}"),
    })?;
    parse_manifest(&v, limits)
}

/// The single validation pass (steps 1–12). Steps 5–12 run per path, in path order.
pub fn validate_packet(p: &GeometryPacket, limits: &Limits) -> Result<Derived, PacketError> {
    let m = &p.manifest;
    check_manifest(m, limits)?;
    let n = m.path_count as usize; // fits: P ≤ max_paths was checked
    if p.verbs.len() as u64 != u64::from(m.verb_count) || p.coords.len() as u64 != u64::from(m.coord_count) {
        return fail(ErrorCode::Length, "array length differs from the manifest");
    }
    if p.verb_offsets.len() != n + 1 || p.coord_offsets.len() != n + 1 {
        return fail(ErrorCode::Length, "offset array length differs from pathCount + 1");
    }
    if p.style_index.len() != n || p.group_index.len() != n {
        return fail(ErrorCode::Length, "per-path array length differs from pathCount");
    }
    let (vo, co) = (&p.verb_offsets, &p.coord_offsets);
    if vo[0] != 0 || co[0] != 0 || vo[n] != m.verb_count || co[n] != m.coord_count {
        return fail(ErrorCode::Offsets, "bad sentinel");
    }
    let mut bounds = Vec::with_capacity(4 * n);
    let mut path_anchors = Vec::with_capacity(n);
    let mut subpaths = 0usize;
    let mut anchors = 0u64;
    let (n_styles, n_groups) = (m.styles.len() as u64, m.groups.len() as u64);
    for i in 0..n {
        let (v0, v1) = (vo[i] as usize, vo[i + 1] as usize);
        let (mut c, c1) = (co[i] as usize, co[i + 1] as usize);
        if v1 <= v0 || c1 < c {
            return fail(ErrorCode::Offsets, format!("path {i}: offsets not increasing"));
        }
        if v1 > p.verbs.len() || c1 > p.coords.len() {
            return fail(ErrorCode::Offsets, format!("path {i}: offset beyond array"));
        }
        if u64::from(p.style_index[i]) >= n_styles || u64::from(p.group_index[i]) >= n_groups {
            return fail(
                ErrorCode::Ref,
                format!("path {i}: style or group reference out of range"),
            );
        }
        if i > 0 && p.group_index[i] < p.group_index[i - 1] {
            return fail(ErrorCode::Ref, format!("path {i}: group order not contiguous"));
        }
        let (mut x0, mut y0, mut x1, mut y1) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
        let mut open = false;
        let mut here = 0u32;
        for k in v0..v1 {
            let op = p.verbs[k];
            if op > VERB_Z {
                return fail(ErrorCode::Opcode, format!("path {i}: opcode {op}"));
            }
            if op == VERB_M {
                open = true;
                subpaths += 1;
            } else if !open {
                return fail(ErrorCode::Grammar, format!("path {i}: segment without an open subpath"));
            }
            if op == VERB_Z {
                open = false;
                continue;
            }
            let end = c + ARITY[op as usize] as usize;
            if end > c1 {
                return fail(ErrorCode::Arity, format!("path {i}: too few coordinates"));
            }
            here += 1;
            while c < end {
                let (x, y) = (p.coords[c], p.coords[c + 1]);
                // False for NaN, so this rejects NaN, ±Infinity and |v| > MAX_COORD.
                if !((-MAX_COORD..=MAX_COORD).contains(&x) && (-MAX_COORD..=MAX_COORD).contains(&y)) {
                    return fail(
                        ErrorCode::Coord,
                        format!("path {i}: non-finite or out-of-range coordinate"),
                    );
                }
                x0 = x0.min(x);
                x1 = x1.max(x);
                y0 = y0.min(y);
                y1 = y1.max(y);
                c += 2;
            }
        }
        if c != c1 {
            return fail(ErrorCode::Arity, format!("path {i}: {} surplus coordinates", c1 - c));
        }
        anchors += u64::from(here);
        if anchors > limits.max_anchors {
            return fail(ErrorCode::Budget, format!("anchors exceed {}", limits.max_anchors));
        }
        bounds.extend_from_slice(&[x0, y0, x1, y1]);
        path_anchors.push(here);
    }
    // Exact size once S is known (C3.2).
    let mut subpath_start = Vec::with_capacity(subpaths);
    for (k, op) in p.verbs.iter().enumerate() {
        if *op == VERB_M {
            subpath_start.push(k as u32);
        }
    }
    Ok(Derived {
        bounds,
        path_anchors,
        subpath_start,
        anchors: anchors as u32, // ≤ max_anchors ≤ u32::MAX in every profile
    })
}

/// RGBA8888 (`r << 24 | g << 16 | b << 8 | a`).
pub fn rgba_to_u32(c: Rgba) -> u32 {
    u32::from_be_bytes([c.r, c.g, c.b, c.a])
}

pub fn u32_to_rgba(v: u32) -> Rgba {
    let [r, g, b, a] = v.to_be_bytes();
    Rgba { r, g, b, a }
}

fn verb_code(ch: u8) -> Option<u8> {
    match ch {
        b'M' => Some(VERB_M),
        b'L' => Some(VERB_L),
        b'C' => Some(VERB_C),
        b'Z' => Some(VERB_Z),
        _ => None,
    }
}

pub(crate) const VERB_CHARS: [char; 4] = ['M', 'L', 'C', 'Z'];

fn to_u32(n: usize, what: &str) -> Result<u32, PacketError> {
    u32::try_from(n).or_else(|_| fail(ErrorCode::Budget, format!("{what} exceeds u32")))
}

#[derive(PartialEq, Eq, Hash)]
struct StyleKey(Option<u32>, Option<String>, Option<(u32, u64)>, bool);

impl GeometryPacket {
    /// Lossless for scene v1 (with [`SceneMeta`]). Styles are deduplicated in first-use order.
    pub fn from_scene(scene: &Scene) -> Result<GeometryPacket, PacketError> {
        let (mut verbs, mut coords) = (Vec::new(), Vec::new());
        let (mut verb_offsets, mut coord_offsets) = (vec![0u32], vec![0u32]);
        let (mut style_index, mut group_index) = (Vec::new(), Vec::new());
        let mut styles: Vec<Style> = Vec::new();
        let mut keys: HashMap<StyleKey, u32> = HashMap::new();
        if scene.groups.len() > MAX_TABLE_ENTRIES {
            return fail(
                ErrorCode::Budget,
                format!("the scene has more than {MAX_TABLE_ENTRIES} groups"),
            );
        }
        for (gi, g) in scene.groups.iter().enumerate() {
            for p in &g.paths {
                let style = Style {
                    fill: p.fill.as_ref().map(|f| rgba_to_u32(f.color)),
                    palette_id: p.fill.as_ref().and_then(|f| f.palette_id.clone()),
                    stroke: p.stroke.as_ref().map(|s| StrokeStyle {
                        color: rgba_to_u32(s.color),
                        width: s.width,
                    }),
                    even_odd: p.fill_rule == FillRule::Evenodd,
                };
                let key = StyleKey(
                    style.fill,
                    style.palette_id.clone(),
                    style.stroke.map(|s| (s.color, s.width.to_bits())),
                    style.even_odd,
                );
                let next = to_u32(styles.len(), "style count")?;
                let si = *keys.entry(key).or_insert(next);
                if si == next {
                    if styles.len() == MAX_TABLE_ENTRIES {
                        return fail(
                            ErrorCode::Budget,
                            format!(
                                "the scene has more than {MAX_TABLE_ENTRIES} distinct styles; reduce colours or detail"
                            ),
                        );
                    }
                    styles.push(style);
                }
                style_index.push(si);
                group_index.push(to_u32(gi, "group count")?);
                for ch in p.verbs.bytes() {
                    match verb_code(ch) {
                        Some(v) => verbs.push(v),
                        None => return fail(ErrorCode::Opcode, format!("unsupported verb {:?}", ch as char)),
                    }
                }
                coords.extend_from_slice(&p.coords);
                verb_offsets.push(to_u32(verbs.len(), "verb count")?);
                coord_offsets.push(to_u32(coords.len(), "coordinate count")?);
            }
        }
        Ok(GeometryPacket {
            manifest: Manifest {
                packet_version: PACKET_VERSION,
                width: scene.width,
                height: scene.height,
                path_count: to_u32(style_index.len(), "path count")?,
                verb_count: to_u32(verbs.len(), "verb count")?,
                coord_count: to_u32(coords.len(), "coordinate count")?,
                styles,
                groups: scene
                    .groups
                    .iter()
                    .map(|g| GroupEntry {
                        id: g.id.clone(),
                        clip: g.clip,
                    })
                    .collect(),
            },
            verbs,
            coords,
            verb_offsets,
            coord_offsets,
            style_index,
            group_index,
        })
    }

    /// Path `i` as a scene path (the packet must be validated).
    pub(crate) fn scene_path(&self, i: usize, style: &Style) -> Result<Path, EngineError> {
        let (v0, v1) = (self.verb_offsets[i] as usize, self.verb_offsets[i + 1] as usize);
        let (c0, c1) = (self.coord_offsets[i] as usize, self.coord_offsets[i + 1] as usize);
        if style.fill.is_none() && style.palette_id.is_some() {
            return Err(EngineError::InvalidScene("paletteId without a fill".into()));
        }
        Ok(Path {
            fill: style.fill.map(|c| Fill {
                color: u32_to_rgba(c),
                palette_id: style.palette_id.clone(),
            }),
            stroke: style.stroke.map(|s| Stroke {
                color: u32_to_rgba(s.color),
                width: s.width,
            }),
            fill_rule: if style.even_odd {
                FillRule::Evenodd
            } else {
                FillRule::Nonzero
            },
            verbs: self.verbs[v0..v1].iter().map(|v| VERB_CHARS[*v as usize]).collect(),
            coords: self.coords[c0..c1].to_vec(),
        })
    }

    /// C3.0 packet block: little-endian sections at 8-byte-aligned, computed offsets, zero
    /// padding. The packet must satisfy its manifest's lengths (validated packets do).
    pub fn to_bytes(&self) -> Vec<u8> {
        let m = &self.manifest;
        let (offsets, block) = layout(
            u64::from(m.path_count),
            u64::from(m.verb_count),
            u64::from(m.coord_count),
        )
        .expect("a validated packet has a representable layout");
        let mut out = vec![0u8; block as usize];
        let o = offsets.map(|x| x as usize);
        out[o[0]..o[0] + self.verbs.len()].copy_from_slice(&self.verbs);
        for (dst, v) in out[o[1]..].chunks_exact_mut(8).zip(&self.coords) {
            dst.copy_from_slice(&v.to_le_bytes());
        }
        for (k, arr) in [
            &self.verb_offsets,
            &self.coord_offsets,
            &self.style_index,
            &self.group_index,
        ]
        .into_iter()
        .enumerate()
        {
            for (dst, v) in out[o[k + 2]..].chunks_exact_mut(4).zip(arr.iter()) {
                dst.copy_from_slice(&v.to_le_bytes());
            }
        }
        out
    }

    /// Decodes a C3.0 block. Steps 1–2 run on the manifest first (caps before allocation),
    /// then the block length (`length`) and padding (`padding`) are checked. The result still
    /// needs [`validate_packet`].
    pub fn from_bytes(manifest: Manifest, block: &[u8], limits: &Limits) -> Result<GeometryPacket, PacketError> {
        let sizes = check_manifest(&manifest, limits)?;
        if block.len() as u64 != sizes.block {
            return fail(
                ErrorCode::Length,
                format!("block is {} bytes, the manifest requires {}", block.len(), sizes.block),
            );
        }
        let (p, v, c) = (
            u64::from(manifest.path_count),
            u64::from(manifest.verb_count),
            u64::from(manifest.coord_count),
        );
        let (offsets, _) = layout(p, v, c)?;
        let lens = section_lengths(p, v, c)?;
        // Padding: every byte not covered by a section must be zero.
        let mut covered = 0u64;
        for k in 0..6 {
            let gap = &block[covered as usize..offsets[k] as usize];
            if gap.iter().any(|b| *b != 0) {
                return fail(ErrorCode::Padding, "non-zero padding");
            }
            covered = offsets[k] + lens[k];
        }
        if block[covered as usize..].iter().any(|b| *b != 0) {
            return fail(ErrorCode::Padding, "non-zero trailing padding");
        }
        let section = |k: usize| &block[offsets[k] as usize..(offsets[k] + lens[k]) as usize];
        let u32s = |k: usize| -> Vec<u32> {
            section(k)
                .chunks_exact(4)
                .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                .collect()
        };
        Ok(GeometryPacket {
            verbs: section(0).to_vec(),
            coords: section(1)
                .chunks_exact(8)
                .map(|b| f64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]]))
                .collect(),
            verb_offsets: u32s(2),
            coord_offsets: u32s(3),
            style_index: u32s(4),
            group_index: u32s(5),
            manifest,
        })
    }
}

impl Scene {
    /// Rebuilds the scene a packet came from (lossless with the matching [`SceneMeta`]).
    pub fn from_packet(packet: &GeometryPacket, meta: &SceneMeta) -> Result<Scene, EngineError> {
        validate_packet(packet, &Limits::ENGINEERING).map_err(|e| EngineError::InvalidScene(e.to_string()))?;
        let m = &packet.manifest;
        let mut groups: Vec<Group> = m
            .groups
            .iter()
            .map(|g| Group {
                id: g.id.clone(),
                clip: g.clip,
                paths: Vec::new(),
            })
            .collect();
        for i in 0..m.path_count as usize {
            let style = &m.styles[packet.style_index[i] as usize];
            groups[packet.group_index[i] as usize]
                .paths
                .push(packet.scene_path(i, style)?);
        }
        let scene = Scene {
            version: SCENE_VERSION,
            width: m.width,
            height: m.height,
            background: meta.background,
            palette: meta.palette.clone(),
            groups,
            metadata: meta.metadata.clone(),
        };
        scene.validate(Limits::ENGINEERING.max_anchors)?;
        Ok(scene)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_match_the_contract_formulas() {
        for (p, v, c) in [
            (0u32, 0u32, 0u32),
            (1, 1, 2),
            (3, 7, 22),
            (4, 9, 30),
            (1_000_000, 2_000_000, 6_000_000),
        ] {
            let s = Sizes::of(p, v, c).unwrap();
            let (p, v, c) = (u64::from(p), u64::from(v), u64::from(c));
            assert_eq!(s.in_memory, v + 8 * c + 16 * p + 8);
            assert_eq!(s.derived_max, 36 * p + 4 * v);
            assert_eq!(s.block - s.in_memory, 8 + (8 - v % 8) % 8, "padding is 8 + (-V mod 8)");
        }
    }

    #[test]
    fn overflowing_declarations_are_budget_errors_without_allocation() {
        let m = Manifest {
            packet_version: 1,
            width: 10.0,
            height: 10.0,
            path_count: u32::MAX,
            verb_count: u32::MAX,
            coord_count: u32::MAX,
            styles: vec![],
            groups: vec![],
        };
        assert_eq!(
            check_manifest(&m, &Limits::PRODUCT).unwrap_err().code,
            ErrorCode::Budget
        );
        let unlimited = Limits {
            max_paths: u64::MAX,
            max_anchors: u64::MAX,
            max_bytes: u64::MAX,
        };
        // u64 arithmetic cannot overflow for u32 counts; the byte cap still holds.
        assert!(check_manifest(&m, &unlimited).is_ok());
        assert_eq!(
            check_manifest(
                &m,
                &Limits {
                    max_bytes: 1 << 30,
                    ..unlimited
                }
            )
            .unwrap_err()
            .code,
            ErrorCode::Budget
        );
    }

    #[test]
    fn colour_packing_round_trips() {
        let c = Rgba { r: 1, g: 2, b: 3, a: 4 };
        assert_eq!(rgba_to_u32(c), 0x0102_0304);
        assert_eq!(u32_to_rgba(0x0102_0304), c);
    }
}
