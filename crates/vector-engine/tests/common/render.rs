//! Diagnostic renders for P0-R-GEO (tiny-skia via resvg; test/tool code, never shipped).
//! Source pixels on a checkerboard, the analytic visible boundary (green), and a traced scene
//! drawn as outlines (red) with anchors (blue squares) and control handles (orange).
#![allow(dead_code)]

use resvg::tiny_skia as sk;
use vector_engine::scene::Scene;

use super::geometry::{GeoFixture, P, Truth};

pub fn write_png(path: &str, pm: &sk::Pixmap) {
    let file = std::fs::File::create(path).unwrap();
    let mut enc = png::Encoder::new(std::io::BufWriter::new(file), pm.width(), pm.height());
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    let data: Vec<u8> = pm
        .pixels()
        .iter()
        .flat_map(|p| {
            let c = p.demultiply();
            [c.red(), c.green(), c.blue(), c.alpha()]
        })
        .collect();
    enc.write_header().unwrap().write_image_data(&data).unwrap();
}

pub fn paint(r: u8, g: u8, b: u8, a: u8) -> sk::Paint<'static> {
    let mut p = sk::Paint::default();
    p.set_color_rgba8(r, g, b, a);
    p.anti_alias = true;
    p
}

fn stroke(pm: &mut sk::Pixmap, path: &sk::Path, t: sk::Transform, col: sk::Paint, width: f32) {
    let s = sk::Stroke {
        width: width / t.sx,
        ..Default::default()
    };
    pm.stroke_path(path, &col, &s, t, None);
}

fn dot(pm: &mut sk::Pixmap, p: P, t: sk::Transform, col: sk::Paint, size: f32, square: bool) {
    let s = size / t.sx;
    let path = if square {
        sk::PathBuilder::from_rect(sk::Rect::from_xywh(p[0] as f32 - s / 2.0, p[1] as f32 - s / 2.0, s, s).unwrap())
    } else {
        sk::PathBuilder::from_circle(p[0] as f32, p[1] as f32, s / 2.0).unwrap()
    };
    pm.fill_path(&path, &col, sk::FillRule::Winding, t, None);
}

/// Source pixels of `crop = [x0, y0, w, h]` at `zoom` on a checkerboard, with a pixel grid
/// when zoomed in.
pub fn source(f: &GeoFixture, crop: [f64; 4], zoom: f32) -> (sk::Pixmap, sk::Transform) {
    let mut pm = sk::Pixmap::new((crop[2] * zoom as f64) as u32, (crop[3] * zoom as f64) as u32).unwrap();
    let t = sk::Transform::from_scale(zoom, zoom).pre_translate(-crop[0] as f32, -crop[1] as f32);
    for y in crop[1] as usize..(crop[1] + crop[3]).ceil() as usize {
        for x in crop[0] as usize..(crop[0] + crop[2]).ceil() as usize {
            if x >= f.w || y >= f.h {
                continue;
            }
            let c = &f.rgba[(y * f.w + x) * 4..(y * f.w + x) * 4 + 4];
            let checker = if (x / 4 + y / 4) % 2 == 0 { 235u8 } else { 210 };
            let a = u32::from(c[3]);
            let mix = |v: u8| ((u32::from(v) * a + u32::from(checker) * (255 - a)) / 255) as u8;
            let rect = sk::Rect::from_xywh(x as f32, y as f32, 1.0, 1.0).unwrap();
            pm.fill_rect(rect, &paint(mix(c[0]), mix(c[1]), mix(c[2]), 255), t, None);
        }
    }
    if zoom >= 8.0 {
        let mut grid = sk::PathBuilder::new();
        for k in 0..=crop[2] as i32 {
            let v = (crop[0] as i32 + k) as f32;
            grid.move_to(v, crop[1] as f32);
            grid.line_to(v, (crop[1] + crop[3]) as f32);
        }
        for k in 0..=crop[3] as i32 {
            let v = (crop[1] as i32 + k) as f32;
            grid.move_to(crop[0] as f32, v);
            grid.line_to((crop[0] + crop[2]) as f32, v);
        }
        if let Some(g) = grid.finish() {
            stroke(&mut pm, &g, t, paint(0, 0, 0, 40), 0.5);
        }
    }
    (pm, t)
}

pub fn truth_overlay(pm: &mut sk::Pixmap, t: sk::Transform, truth: &Truth) {
    for s in truth.samples.iter().step_by(2) {
        dot(pm, s.p, t, paint(0, 170, 0, 255), 2.0, false);
    }
}

/// Scene outlines (red), anchors (blue) and handles (orange).
pub fn scene_overlay(pm: &mut sk::Pixmap, t: sk::Transform, scene: &Scene, handles: bool) {
    for g in &scene.groups {
        for p in &g.paths {
            let c = &p.coords;
            let mut pb = sk::PathBuilder::new();
            let mut i = 0;
            let mut cur = [0.0f64, 0.0];
            let mut marks: Vec<(P, P, P, P)> = Vec::new();
            let mut anchors: Vec<P> = Vec::new();
            for v in p.verbs.bytes() {
                match v {
                    b'M' => {
                        pb.move_to(c[i] as f32, c[i + 1] as f32);
                        cur = [c[i], c[i + 1]];
                        anchors.push(cur);
                        i += 2;
                    }
                    b'L' => {
                        pb.line_to(c[i] as f32, c[i + 1] as f32);
                        cur = [c[i], c[i + 1]];
                        anchors.push(cur);
                        i += 2;
                    }
                    b'C' => {
                        pb.cubic_to(
                            c[i] as f32,
                            c[i + 1] as f32,
                            c[i + 2] as f32,
                            c[i + 3] as f32,
                            c[i + 4] as f32,
                            c[i + 5] as f32,
                        );
                        marks.push((cur, [c[i], c[i + 1]], [c[i + 2], c[i + 3]], [c[i + 4], c[i + 5]]));
                        cur = [c[i + 4], c[i + 5]];
                        anchors.push(cur);
                        i += 6;
                    }
                    _ => pb.close(),
                }
            }
            if let Some(path) = pb.finish() {
                stroke(pm, &path, t, paint(220, 20, 20, 255), 2.0);
            }
            if handles {
                for (a, c1, c2, b) in marks {
                    let mut h = sk::PathBuilder::new();
                    h.move_to(a[0] as f32, a[1] as f32);
                    h.line_to(c1[0] as f32, c1[1] as f32);
                    h.move_to(b[0] as f32, b[1] as f32);
                    h.line_to(c2[0] as f32, c2[1] as f32);
                    if let Some(h) = h.finish() {
                        stroke(pm, &h, t, paint(255, 140, 0, 255), 1.2);
                    }
                    dot(pm, c1, t, paint(255, 140, 0, 255), 5.0, false);
                    dot(pm, c2, t, paint(255, 140, 0, 255), 5.0, false);
                }
                for a in anchors {
                    dot(pm, a, t, paint(20, 60, 230, 255), 8.0, true);
                }
            }
        }
    }
}

/// Renders an SVG string (filled, as a viewer shows it) into `crop` at `zoom`, over the
/// fixture's background.
pub fn rendered(svg: &str, f: &GeoFixture, crop: [f64; 4], zoom: f32) -> sk::Pixmap {
    let mut pm = sk::Pixmap::new((crop[2] * zoom as f64) as u32, (crop[3] * zoom as f64) as u32).unwrap();
    let bg = f.background;
    if bg[3] == 0 {
        // Checkerboard for transparency.
        for y in 0..pm.height() {
            for x in 0..pm.width() {
                let v = if (x / 8 + y / 8) % 2 == 0 { 235 } else { 210 };
                pm.fill_rect(
                    sk::Rect::from_xywh(x as f32, y as f32, 1.0, 1.0).unwrap(),
                    &paint(v, v, v, 255),
                    sk::Transform::identity(),
                    None,
                );
            }
        }
    } else {
        pm.fill(sk::Color::from_rgba8(bg[0], bg[1], bg[2], bg[3]));
    }
    let tree = resvg::usvg::Tree::from_str(svg, &resvg::usvg::Options::default()).unwrap();
    let t = sk::Transform::from_scale(zoom, zoom).pre_translate(-crop[0] as f32, -crop[1] as f32);
    resvg::render(&tree, t, &mut pm.as_mut());
    pm
}
