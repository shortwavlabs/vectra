//! Direct vector PDF writer (pdf-writer 0.15). The only content-stream operators emitted are
//! state (`q Q cm gs`), colour (`rg RG w`), path construction (`m l c h re`), clipping
//! (`W n`) and painting (`f f* S B B*`). There is no image, XObject, shading, font or
//! annotation code path, so the output cannot contain raster data.
//! RGB only (DeviceRGB). No PDF/X, CMYK or print-provider compliance is claimed.

use std::collections::BTreeMap;

use pdf_writer::{Content, Filter, Finish, Name, Pdf, Rect, Ref, TextStr};
use serde::{Deserialize, Serialize};

use crate::error::EngineError;
use crate::params::HARD_MAX_ANCHORS;
use crate::scene::{FillRule, Path, Scene};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Unit {
    Pt,
    Mm,
    In,
    Px,
}

/// Physical page size. The page height follows the scene's aspect ratio.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PdfOptions {
    pub width: f64,
    pub unit: Unit,
    /// Pixels per inch; required when `unit` is `px`.
    #[serde(default)]
    pub dpi: Option<f64>,
}

/// PDF user-space limit (ISO 32000-1 Annex C: 14 400 units = 200 in).
pub const MAX_PAGE_PT: f64 = 14_400.0;

/// Converts a length to PDF points (1 pt = 1/72 in, 1 in = 25.4 mm).
pub fn to_points(value: f64, unit: Unit, dpi: Option<f64>) -> Result<f64, EngineError> {
    let bad = |m: &str| Err(EngineError::InvalidExportOptions(m.to_string()));
    if !(value.is_finite() && value > 0.0) {
        return bad("width must be a positive number");
    }
    Ok(match unit {
        Unit::Pt => value,
        Unit::Mm => value * 72.0 / 25.4,
        Unit::In => value * 72.0,
        Unit::Px => match dpi {
            Some(d) if d.is_finite() && (1.0..=2400.0).contains(&d) => value * 72.0 / d,
            _ => return bad("dpi (1–2400) is required for px units"),
        },
    })
}

/// Page size in points for a scene and options.
pub fn page_size(scene: &Scene, opts: &PdfOptions) -> Result<(f64, f64), EngineError> {
    let w = to_points(opts.width, opts.unit, opts.dpi)?;
    let h = w * scene.height / scene.width;
    for v in [w, h] {
        if !(1.0..=MAX_PAGE_PT).contains(&v) {
            return Err(EngineError::InvalidExportOptions(format!(
                "page side {v:.2} pt outside 1–{MAX_PAGE_PT} pt"
            )));
        }
    }
    Ok((w, h))
}

fn rgb(c: crate::color::Rgba) -> (f32, f32, f32) {
    (f32::from(c.r) / 255.0, f32::from(c.g) / 255.0, f32::from(c.b) / 255.0)
}

fn emit_path(content: &mut Content, p: &Path) {
    let c = &p.coords;
    let mut i = 0;
    let f = |v: f64| v as f32;
    for v in p.verbs.bytes() {
        match v {
            b'M' => {
                content.move_to(f(c[i]), f(c[i + 1]));
                i += 2;
            }
            b'L' => {
                content.line_to(f(c[i]), f(c[i + 1]));
                i += 2;
            }
            b'C' => {
                content.cubic_to(f(c[i]), f(c[i + 1]), f(c[i + 2]), f(c[i + 3]), f(c[i + 4]), f(c[i + 5]));
                i += 6;
            }
            _ => {
                content.close_path();
            }
        }
    }
}

/// Writes a single-page vector PDF from a scene after validating it.
pub fn to_pdf(scene: &Scene, opts: &PdfOptions) -> Result<Vec<u8>, EngineError> {
    scene.validate(HARD_MAX_ANCHORS)?;
    let (page_w, page_h) = page_size(scene, opts)?;
    let s = (page_w / scene.width) as f32;

    // One ExtGState per distinct (fill alpha, stroke alpha) pair that is not fully opaque.
    let mut states: BTreeMap<(u8, u8), String> = BTreeMap::new();
    let mut state_for = |fa: u8, sa: u8| -> Option<String> {
        if fa == 255 && sa == 255 {
            return None;
        }
        let n = states.len();
        Some(states.entry((fa, sa)).or_insert_with(|| format!("G{n}")).clone())
    };

    let mut content = Content::new();
    content.save_state();
    // Scene units (y down) -> PDF points (y up).
    content.transform([s, 0.0, 0.0, -s, 0.0, page_h as f32]);
    if let Some(bg) = scene.background {
        if let Some(gs) = state_for(bg.a, 255) {
            content.set_parameters(Name(gs.as_bytes()));
        }
        let (r, g, b) = rgb(bg);
        content.set_fill_rgb(r, g, b);
        content.rect(0.0, 0.0, scene.width as f32, scene.height as f32);
        content.fill_nonzero();
    }
    for group in &scene.groups {
        content.save_state();
        if let Some(c) = group.clip {
            content.rect(c.x as f32, c.y as f32, c.width as f32, c.height as f32);
            content.clip_nonzero();
            content.end_path();
        }
        for p in &group.paths {
            let fa = p.fill.as_ref().map_or(255, |f| f.color.a);
            let sa = p.stroke.as_ref().map_or(255, |s| s.color.a);
            content.save_state();
            if let Some(gs) = state_for(fa, sa) {
                content.set_parameters(Name(gs.as_bytes()));
            }
            if let Some(fill) = &p.fill {
                let (r, g, b) = rgb(fill.color);
                content.set_fill_rgb(r, g, b);
            }
            if let Some(stroke) = &p.stroke {
                let (r, g, b) = rgb(stroke.color);
                content.set_stroke_rgb(r, g, b);
                content.set_line_width(stroke.width as f32);
            }
            emit_path(&mut content, p);
            let even_odd = p.fill_rule == FillRule::Evenodd;
            match (p.fill.is_some(), p.stroke.is_some(), even_odd) {
                (true, false, false) => content.fill_nonzero(),
                (true, false, true) => content.fill_even_odd(),
                (true, true, false) => content.fill_nonzero_and_stroke(),
                (true, true, true) => content.fill_even_odd_and_stroke(),
                (false, _, _) => content.stroke(),
            };
            content.restore_state();
        }
        content.restore_state();
    }
    content.restore_state();
    let raw = content.finish();
    let compressed = miniz_oxide::deflate::compress_to_vec_zlib(raw.as_slice(), 6);

    let catalog_id = Ref::new(1);
    let pages_id = Ref::new(2);
    let page_id = Ref::new(3);
    let content_id = Ref::new(4);
    let info_id = Ref::new(5);
    let mut pdf = Pdf::new();
    pdf.catalog(catalog_id).pages(pages_id);
    pdf.pages(pages_id).kids([page_id]).count(1);
    let state_ids: Vec<(String, (u8, u8), Ref)> = states
        .iter()
        .enumerate()
        .map(|(i, (k, name))| (name.clone(), *k, Ref::new(6 + i as i32)))
        .collect();
    {
        let mut page = pdf.page(page_id);
        page.media_box(Rect::new(0.0, 0.0, page_w as f32, page_h as f32));
        page.parent(pages_id);
        page.contents(content_id);
        let mut resources = page.resources();
        let mut gs = resources.ext_g_states();
        for (name, _, id) in &state_ids {
            gs.pair(Name(name.as_bytes()), *id);
        }
        gs.finish();
        resources.finish();
        page.finish();
    }
    for (_, (fa, sa), id) in &state_ids {
        pdf.ext_graphics(*id)
            .non_stroking_alpha(f32::from(*fa) / 255.0)
            .stroking_alpha(f32::from(*sa) / 255.0);
    }
    pdf.stream(content_id, &compressed).filter(Filter::FlateDecode);
    pdf.document_info(info_id)
        .producer(TextStr(&format!("Vectra vector-engine {}", crate::ENGINE_VERSION)));
    Ok(pdf.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_conversions_are_exact() {
        assert_eq!(to_points(72.0, Unit::Pt, None).unwrap(), 72.0);
        assert_eq!(to_points(1.0, Unit::In, None).unwrap(), 72.0);
        assert!((to_points(25.4, Unit::Mm, None).unwrap() - 72.0).abs() < 1e-12);
        assert!((to_points(210.0, Unit::Mm, None).unwrap() - 595.275_590_551).abs() < 1e-6);
        assert_eq!(to_points(300.0, Unit::Px, Some(300.0)).unwrap(), 72.0);
        assert!(to_points(10.0, Unit::Px, None).is_err());
        assert!(to_points(-1.0, Unit::Mm, None).is_err());
        assert!(to_points(f64::NAN, Unit::Pt, None).is_err());
    }
}
