//! SVG 1.1 serializer. Emits only `svg`, `desc`, `defs`, `clipPath`, `rect`, `g` and `path`
//! with absolute coordinates; no scripts, images, external references, styles or
//! `foreignObject`. Numbers use locale-independent fixed precision with trailing zeros trimmed.

use std::fmt::Write;

use crate::color::Rgba;
use crate::error::EngineError;
use crate::params::HARD_MAX_ANCHORS;
use crate::scene::{FillRule, Path, Scene};

/// Appends `v` with at most 3 decimals, no trailing zeros, never `-0`.
pub fn push_num(out: &mut String, v: f64) {
    let mut s = format!("{v:.3}");
    if s.contains('.') {
        while s.ends_with('0') {
            s.pop();
        }
        if s.ends_with('.') {
            s.pop();
        }
    }
    if s == "-0" {
        s = "0".into();
    }
    out.push_str(&s);
}

fn num(v: f64) -> String {
    let mut s = String::new();
    push_num(&mut s, v);
    s
}

fn paint_attrs(out: &mut String, prefix: &str, c: Rgba) {
    let _ = write!(out, " {prefix}=\"{}\"", c.hex_rgb());
    if c.a < 255 {
        let _ = write!(out, " {prefix}-opacity=\"{}\"", num(f64::from(c.a) / 255.0));
    }
}

/// Path data string (`M x y L x y C … Z`).
pub fn path_data(p: &Path) -> String {
    let mut d = String::with_capacity(p.coords.len() * 7);
    let mut ci = 0;
    for v in p.verbs.bytes() {
        let n = match v {
            b'M' | b'L' => 2,
            b'C' => 6,
            _ => 0,
        };
        d.push(v as char);
        for k in 0..n {
            if k > 0 {
                d.push(' ');
            }
            push_num(&mut d, p.coords[ci + k]);
        }
        ci += n;
    }
    d
}

/// Serializes a scene after validating it.
pub fn to_svg(scene: &Scene) -> Result<String, EngineError> {
    scene.validate(HARD_MAX_ANCHORS)?;
    let (w, h) = (num(scene.width), num(scene.height));
    let mut out = String::new();
    out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    let _ = writeln!(
        out,
        "<svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\" width=\"{w}\" height=\"{h}\" viewBox=\"0 0 {w} {h}\">"
    );
    let _ = writeln!(
        out,
        "<desc>Vectra vector-engine {} · scene v{} · mode {}</desc>",
        scene.metadata.engine_version, scene.version, scene.metadata.mode
    );
    let clipped: Vec<_> = scene.groups.iter().filter(|g| g.clip.is_some()).collect();
    if !clipped.is_empty() {
        out.push_str("<defs>");
        for g in clipped {
            let c = g.clip.expect("filtered");
            let _ = write!(
                out,
                "<clipPath id=\"clip-{}\"><rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\"/></clipPath>",
                g.id,
                num(c.x),
                num(c.y),
                num(c.width),
                num(c.height)
            );
        }
        out.push_str("</defs>\n");
    }
    if let Some(bg) = scene.background {
        let _ = write!(out, "<rect width=\"{w}\" height=\"{h}\"");
        paint_attrs(&mut out, "fill", bg);
        out.push_str("/>\n");
    }
    for g in &scene.groups {
        let _ = write!(out, "<g id=\"{}\"", g.id);
        if g.clip.is_some() {
            let _ = write!(out, " clip-path=\"url(#clip-{})\"", g.id);
        }
        out.push_str(">\n");
        for p in &g.paths {
            out.push_str("<path d=\"");
            out.push_str(&path_data(p));
            out.push('"');
            match &p.fill {
                Some(f) => {
                    paint_attrs(&mut out, "fill", f.color);
                    let rule = if p.fill_rule == FillRule::Evenodd {
                        "evenodd"
                    } else {
                        "nonzero"
                    };
                    let _ = write!(out, " fill-rule=\"{rule}\"");
                    if let Some(id) = &f.palette_id {
                        let _ = write!(out, " class=\"{id}\"");
                    }
                }
                None => out.push_str(" fill=\"none\""),
            }
            if let Some(s) = &p.stroke {
                paint_attrs(&mut out, "stroke", s.color);
                let _ = write!(out, " stroke-width=\"{}\"", num(s.width));
            }
            out.push_str("/>\n");
        }
        out.push_str("</g>\n");
    }
    out.push_str("</svg>\n");
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn number_formatting_is_trimmed_and_locale_independent() {
        let cases = [
            (0.0, "0"),
            (-0.0004, "0"),
            (1.5, "1.5"),
            (2.0, "2"),
            (-12.34567, "-12.346"),
            (1e5, "100000"),
        ];
        for (v, s) in cases {
            assert_eq!(num(v), s);
        }
    }
}
