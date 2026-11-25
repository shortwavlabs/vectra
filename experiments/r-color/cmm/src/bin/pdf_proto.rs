//! R-COLOR-04 PDF structure prototype. Writes one synthetic scene in five variants:
//!
//!   A-device-rgb   the unmodified production writer (`vector_engine::pdf::to_pdf`)
//!   B-icc-rgb      ICCBased sRGB colour space (embedded profile), same geometry
//!   C-cmyk         DeviceCMYK values converted by moxcms (sRGB -> CMYK profile, relative
//!                  colorimetric), OutputIntent with the CMYK profile, TrimBox/BleedBox/CropBox,
//!                  crop marks in the /All separation
//!   D-cmyk-spot    C plus one palette entry as a Separation ink and pure black as K only
//!   E-plate-spot   one ink plate: only the spot ink's paths, as solid DeviceGray black
//!
//! No variant writes GTS_PDFXVersion or claims PDF/X: none has been validated (PDFX-FEASIBILITY.md).
//! Usage: pdf_proto <out-dir>   with RC_SRGB and RC_CMYK naming ICC profile files.
//! Outputs stay in the out dir (they embed third-party profiles and are never committed);
//! `pdf-proto.json` holds the measurable facts.

use std::collections::BTreeMap;
use std::fs;

use lcms2::{CIExyY, Intent, PixelFormat, Profile, Transform};
use pdf_writer::types::{ColorSpaceOperand, OutputIntentSubtype};
use pdf_writer::writers::ColorSpace;
use pdf_writer::{Content, Filter, Finish, Name, Pdf, Rect, Ref, TextStr};
use r_color_cmm::{ciede2000, moxcms_convert};
use serde_json::json;
use vector_engine::color::Rgba;
use vector_engine::pdf::{PdfOptions, Unit, page_size, to_pdf};
use vector_engine::scene::{ClipRect, Fill, FillRule, Group, Metadata, PaletteEntry, Path, PathBuilder, Scene, Stroke};

const SPOT_ID: &str = "spot-lime";
const BLEED_MM: f64 = 3.0;
const MARK_MM: f64 = 10.0;

fn rgba(hex: u32, a: u8) -> Rgba {
    Rgba {
        r: (hex >> 16) as u8,
        g: (hex >> 8) as u8,
        b: hex as u8,
        a,
    }
}

fn rect(x: f64, y: f64, w: f64, h: f64, c: Rgba, pid: Option<&str>) -> Path {
    let mut b = PathBuilder::default();
    b.move_to(x, y);
    b.line_to(x + w, y);
    b.line_to(x + w, y + h);
    b.line_to(x, y + h);
    b.close();
    b.finish(
        Some(Fill {
            color: c,
            palette_id: pid.map(String::from),
        }),
        FillRule::Nonzero,
    )
}

fn circle(b: &mut PathBuilder, cx: f64, cy: f64, r: f64) {
    let k = 0.552_284_749_8 * r;
    b.move_to(cx + r, cy);
    b.cubic_to([cx + r, cy + k, cx + k, cy + r, cx, cy + r]);
    b.cubic_to([cx - k, cy + r, cx - r, cy + k, cx - r, cy]);
    b.cubic_to([cx - r, cy - k, cx - k, cy - r, cx, cy - r]);
    b.cubic_to([cx + k, cy - r, cx + r, cy - k, cx + r, cy]);
    b.close();
}

/// Synthetic scene: black line-art bar, even-odd square with a hole, three translucent
/// overlapping discs, a grey ramp, an out-of-gamut blue, a stroke and a spot-ink rectangle,
/// inside a clipped group; the spot rectangle is also in an unclipped group.
fn scene() -> Scene {
    let mut p = vec![rect(40.0, 40.0, 200.0, 24.0, rgba(0x000000, 255), Some("ink-black"))];
    let mut sq = PathBuilder::default();
    for (x, y, w) in [(260.0, 40.0, 120.0), (290.0, 70.0, 60.0)] {
        sq.move_to(x, y);
        sq.line_to(x + w, y);
        sq.line_to(x + w, y + w);
        sq.line_to(x, y + w);
        sq.close();
    }
    p.push(sq.finish(
        Some(Fill {
            color: rgba(0xb9e87b, 255),
            palette_id: Some("lime".into()),
        }),
        FillRule::Evenodd,
    ));
    for (cx, cy, c, id) in [
        (110.0, 190.0, 0xff0000, "red"),
        (160.0, 190.0, 0x00ff00, "green"),
        (135.0, 233.0, 0x0000ff, "blue"),
    ] {
        let mut b = PathBuilder::default();
        circle(&mut b, cx, cy, 50.0);
        p.push(b.finish(
            Some(Fill {
                color: rgba(c, 128),
                palette_id: Some(id.into()),
            }),
            FillRule::Nonzero,
        ));
    }
    for (i, g) in [0u32, 64, 128, 192, 255].into_iter().enumerate() {
        p.push(rect(
            260.0 + 40.0 * i as f64,
            200.0,
            40.0,
            40.0,
            rgba(g << 16 | g << 8 | g, 255),
            None,
        ));
    }
    p.push(rect(420.0, 40.0, 80.0, 60.0, rgba(0x0000ff, 255), Some("oog-blue")));
    let mut s = PathBuilder::default();
    s.move_to(260.0, 280.0);
    s.cubic_to([320.0, 250.0, 380.0, 330.0, 460.0, 280.0]);
    let mut stroke = s.finish(None, FillRule::Nonzero);
    stroke.stroke = Some(Stroke {
        color: rgba(0x191a1c, 255),
        width: 4.0,
    });
    p.push(stroke);
    Scene {
        version: 1,
        width: 600.0,
        height: 400.0,
        background: Some(rgba(0xeee8d8, 255)),
        palette: [
            ("ink-black", 0x000000, 255),
            ("lime", 0xb9e87b, 255),
            ("red", 0xff0000, 128),
            ("green", 0x00ff00, 128),
            ("blue", 0x0000ff, 128),
            ("oog-blue", 0x0000ff, 255),
            (SPOT_ID, 0xb9e87b, 255),
        ]
        .into_iter()
        .map(|(id, c, a)| PaletteEntry {
            id: id.into(),
            color: rgba(c, a),
        })
        .collect(),
        groups: vec![
            Group {
                id: "art".into(),
                clip: Some(ClipRect {
                    x: 20.0,
                    y: 20.0,
                    width: 560.0,
                    height: 360.0,
                }),
                paths: p,
            },
            Group {
                id: "spot".into(),
                clip: None,
                paths: vec![rect(420.0, 300.0, 140.0, 60.0, rgba(0xb9e87b, 255), Some(SPOT_ID))],
            },
        ],
        metadata: Metadata {
            generator: "r-color pdf_proto".into(),
            engine_version: vector_engine::ENGINE_VERSION.into(),
            mode: "document".into(),
            preset_version: 0,
            seed: 0,
            source_width: 600,
            source_height: 400,
            params: json!({}),
        },
    }
}

/// How a scene colour becomes PDF paint.
#[derive(Clone, Copy, PartialEq)]
enum Mode {
    /// DeviceRGB paint plus an explicit page transparency group (/CS /DeviceRGB).
    DeviceRgbGroup,
    /// ICCBased sRGB paint plus a page transparency group in the same ICCBased space.
    IccRgbGroup,
    IccRgb,
    Cmyk,
    CmykSpot,
    Plate,
}

struct Paint {
    cmyk: BTreeMap<[u8; 3], [f32; 4]>,
}

impl Paint {
    fn emit(&self, mode: Mode, c: &mut Content, fill: bool, color: Rgba, pid: Option<&str>) {
        let rgb = [color.r, color.g, color.b];
        match mode {
            Mode::DeviceRgbGroup => {
                let v = rgb.map(|x| f32::from(x) / 255.0);
                if fill {
                    c.set_fill_rgb(v[0], v[1], v[2])
                } else {
                    c.set_stroke_rgb(v[0], v[1], v[2])
                };
            }
            Mode::IccRgb | Mode::IccRgbGroup => {
                let v = rgb.map(|x| f32::from(x) / 255.0);
                if fill {
                    c.set_fill_color_space(ColorSpaceOperand::Named(Name(b"CS0")))
                        .set_fill_color(v);
                } else {
                    c.set_stroke_color_space(ColorSpaceOperand::Named(Name(b"CS0")))
                        .set_stroke_color(v);
                }
            }
            Mode::CmykSpot if pid == Some(SPOT_ID) => {
                if fill {
                    c.set_fill_color_space(ColorSpaceOperand::Named(Name(b"SP0")))
                        .set_fill_color([1.0]);
                } else {
                    c.set_stroke_color_space(ColorSpaceOperand::Named(Name(b"SP0")))
                        .set_stroke_color([1.0]);
                }
            }
            Mode::Plate => {
                if fill {
                    c.set_fill_gray(0.0)
                } else {
                    c.set_stroke_gray(0.0)
                };
            }
            _ => {
                // Explicit ink override: pure black becomes K only in the spot variant.
                let k = if mode == Mode::CmykSpot && rgb == [0, 0, 0] {
                    [0.0, 0.0, 0.0, 1.0]
                } else {
                    self.cmyk[&rgb]
                };
                if fill {
                    c.set_fill_cmyk(k[0], k[1], k[2], k[3])
                } else {
                    c.set_stroke_cmyk(k[0], k[1], k[2], k[3])
                };
            }
        }
    }
}

fn emit_path(c: &mut Content, p: &Path) {
    let k = &p.coords;
    let f = |v: f64| v as f32;
    let mut i = 0;
    for v in p.verbs.bytes() {
        match v {
            b'M' => {
                c.move_to(f(k[i]), f(k[i + 1]));
                i += 2;
            }
            b'L' => {
                c.line_to(f(k[i]), f(k[i + 1]));
                i += 2;
            }
            b'C' => {
                c.cubic_to(f(k[i]), f(k[i + 1]), f(k[i + 2]), f(k[i + 3]), f(k[i + 4]), f(k[i + 5]));
                i += 6;
            }
            _ => {
                c.close_path();
            }
        }
    }
}

/// The production loop (crates/vector-engine/src/pdf.rs) with the colour operators replaced by
/// `Paint::emit`. Returns the artwork content and the alpha ExtGState table.
fn artwork(
    scene: &Scene,
    s: f32,
    page_h: f32,
    mode: Mode,
    paint: &Paint,
    bleed_px: f64,
) -> (Vec<u8>, BTreeMap<(u8, u8), String>) {
    let mut states: BTreeMap<(u8, u8), String> = BTreeMap::new();
    let mut state_for = |fa: u8, sa: u8| -> Option<String> {
        if fa == 255 && sa == 255 {
            return None;
        }
        let n = states.len();
        Some(states.entry((fa, sa)).or_insert_with(|| format!("G{n}")).clone())
    };
    let mut c = Content::new();
    c.save_state();
    c.transform([s, 0.0, 0.0, -s, 0.0, page_h]);
    if let Some(bg) = scene.background.filter(|_| mode != Mode::Plate) {
        c.save_state();
        if let Some(gs) = state_for(bg.a, 255) {
            c.set_parameters(Name(gs.as_bytes()));
        }
        paint.emit(mode, &mut c, true, bg, None);
        // With bleed the background extends to the bleed box: it is artwork, not paper.
        let b = bleed_px as f32;
        c.rect(-b, -b, scene.width as f32 + 2.0 * b, scene.height as f32 + 2.0 * b);
        c.fill_nonzero();
        c.restore_state();
    }
    for group in &scene.groups {
        c.save_state();
        if let Some(r) = group.clip {
            c.rect(r.x as f32, r.y as f32, r.width as f32, r.height as f32);
            c.clip_nonzero();
            c.end_path();
        }
        for p in &group.paths {
            let pid = p.fill.as_ref().and_then(|f| f.palette_id.as_deref());
            if mode == Mode::Plate && pid != Some(SPOT_ID) {
                continue;
            }
            let fa = p.fill.as_ref().map_or(255, |f| f.color.a);
            let sa = p.stroke.as_ref().map_or(255, |s| s.color.a);
            c.save_state();
            if let Some(gs) = state_for(fa, sa).filter(|_| mode != Mode::Plate) {
                c.set_parameters(Name(gs.as_bytes()));
            }
            if let Some(fill) = &p.fill {
                paint.emit(mode, &mut c, true, fill.color, pid);
            }
            if let Some(st) = &p.stroke {
                paint.emit(mode, &mut c, false, st.color, None);
                c.set_line_width(st.width as f32);
            }
            emit_path(&mut c, p);
            match (p.fill.is_some(), p.stroke.is_some(), p.fill_rule == FillRule::Evenodd) {
                (true, false, false) => c.fill_nonzero(),
                (true, false, true) => c.fill_even_odd(),
                (true, true, false) => c.fill_nonzero_and_stroke(),
                (true, true, true) => c.fill_even_odd_and_stroke(),
                (false, _, _) => c.stroke(),
            };
            c.restore_state();
        }
        c.restore_state();
    }
    c.restore_state();
    (c.finish().into_vec(), states)
}

fn write_variant(scene: &Scene, mode: Mode, paint: &Paint, srgb: &[u8], cmyk: &[u8]) -> (Vec<u8>, Vec<u8>) {
    let opts = PdfOptions {
        width: 200.0,
        unit: Unit::Mm,
        dpi: None,
    };
    let (tw, th) = page_size(scene, &opts).unwrap();
    let pt_per_mm = 72.0 / 25.4;
    let print = matches!(mode, Mode::Cmyk | Mode::CmykSpot | Mode::Plate);
    let (bleed, margin) = if print {
        (BLEED_MM * pt_per_mm, MARK_MM * pt_per_mm)
    } else {
        (0.0, 0.0)
    };
    let (mw, mh) = (tw + 2.0 * margin, th + 2.0 * margin);
    let s = (tw / scene.width) as f32;
    let (art, states) = artwork(scene, s, th as f32, mode, paint, bleed / f64::from(s));
    let mut page = Content::new();
    page.save_state();
    page.transform([1.0, 0.0, 0.0, 1.0, margin as f32, margin as f32]);
    let mut raw = page.finish().into_vec();
    raw.push(b'\n'); // content fragments must be separated by white space
    raw.extend_from_slice(&art);
    raw.push(b'\n');
    let mut tail = Content::new();
    tail.restore_state();
    if print {
        // Crop marks: 0.25 pt lines in /All, outside the bleed box, at the trim corners.
        tail.save_state();
        tail.set_stroke_color_space(ColorSpaceOperand::Named(Name(b"ALL")))
            .set_stroke_color([1.0]);
        tail.set_line_width(0.25);
        let (x0, y0, x1, y1) = (margin as f32, margin as f32, (margin + tw) as f32, (margin + th) as f32);
        let (gap, len) = ((bleed + 1.0) as f32, (margin - bleed - 2.0) as f32);
        for (x, y, dx, dy) in [
            (x0, y0, -1.0, -1.0),
            (x1, y0, 1.0, -1.0),
            (x0, y1, -1.0, 1.0),
            (x1, y1, 1.0, 1.0),
        ] {
            tail.move_to(x + dx * gap, y).line_to(x + dx * (gap + len), y);
            tail.move_to(x, y + dy * gap).line_to(x, y + dy * (gap + len));
        }
        tail.stroke();
        tail.restore_state();
    }
    raw.extend_from_slice(&tail.finish().into_vec());
    let compressed = miniz_oxide::deflate::compress_to_vec_zlib(&raw, 6);

    let (catalog, pages, page_id, content, info) = (Ref::new(1), Ref::new(2), Ref::new(3), Ref::new(4), Ref::new(5));
    let (icc_rgb, icc_cmyk, all_fn, spot_fn) = (Ref::new(6), Ref::new(7), Ref::new(8), Ref::new(9));
    let mut pdf = Pdf::new();
    {
        let mut cat = pdf.catalog(catalog);
        cat.pages(pages);
        if print {
            let mut oi = cat.output_intents();
            oi.push()
                .subtype(OutputIntentSubtype::PDFX)
                .output_condition_identifier(TextStr("Custom"))
                .output_condition(TextStr("Local test profile (not a registered characterisation)"))
                .info(TextStr("R-COLOR prototype; not PDF/X"))
                .dest_output_profile(icc_cmyk);
        }
    }
    pdf.pages(pages).kids([page_id]).count(1);
    let state_ids: Vec<(String, (u8, u8), Ref)> = states
        .iter()
        .enumerate()
        .map(|(i, (k, n))| (n.clone(), *k, Ref::new(10 + i as i32)))
        .collect();
    {
        let mut pg = pdf.page(page_id);
        pg.media_box(Rect::new(0.0, 0.0, mw as f32, mh as f32));
        if print {
            let (m, b) = (margin as f32, bleed as f32);
            pg.trim_box(Rect::new(m, m, m + tw as f32, m + th as f32));
            pg.bleed_box(Rect::new(m - b, m - b, m + tw as f32 + b, m + th as f32 + b));
            pg.crop_box(Rect::new(0.0, 0.0, mw as f32, mh as f32));
        }
        match mode {
            Mode::DeviceRgbGroup => pg.group().transparency().color_space().device_rgb(),
            Mode::IccRgbGroup => pg.group().transparency().color_space().icc_based(icc_rgb),
            _ => {}
        }
        pg.parent(pages);
        pg.contents(content);
        let mut res = pg.resources();
        {
            let mut cs = res.color_spaces();
            if matches!(mode, Mode::IccRgb | Mode::IccRgbGroup) {
                cs.insert(Name(b"CS0")).start::<ColorSpace>().icc_based(icc_rgb);
            }
            if print {
                let mut sep = cs.insert(Name(b"ALL")).start::<ColorSpace>().separation(Name(b"All"));
                sep.alternate_color_space().device_cmyk();
                sep.tint_ref(all_fn);
            }
            if mode == Mode::CmykSpot {
                let mut sep = cs
                    .insert(Name(b"SP0"))
                    .start::<ColorSpace>()
                    .separation(Name(b"Vectra Lime"));
                sep.alternate_color_space().device_cmyk();
                sep.tint_ref(spot_fn);
            }
        }
        let mut gs = res.ext_g_states();
        for (name, _, id) in &state_ids {
            gs.pair(Name(name.as_bytes()), *id);
        }
        gs.finish();
        res.finish();
        pg.finish();
    }
    for (_, (fa, sa), id) in &state_ids {
        pdf.ext_graphics(*id)
            .non_stroking_alpha(f32::from(*fa) / 255.0)
            .stroking_alpha(f32::from(*sa) / 255.0);
    }
    if matches!(mode, Mode::IccRgb | Mode::IccRgbGroup) {
        pdf.icc_profile(icc_rgb, srgb).n(3);
    }
    if print {
        pdf.icc_profile(icc_cmyk, cmyk).n(4);
        pdf.exponential_function(all_fn)
            .domain([0.0, 1.0])
            .c0([0.0; 4])
            .c1([1.0; 4])
            .n(1.0);
        let lime = paint.cmyk[&[0xb9, 0xe8, 0x7b]];
        pdf.exponential_function(spot_fn)
            .domain([0.0, 1.0])
            .c0([0.0; 4])
            .c1(lime)
            .n(1.0);
    }
    pdf.stream(content, &compressed).filter(Filter::FlateDecode);
    pdf.document_info(info)
        .producer(TextStr("R-COLOR pdf_proto (research prototype)"));
    (pdf.finish(), art)
}

/// Content operators with colour operators and their operands removed.
fn geometry_tokens(content: &[u8]) -> Vec<String> {
    const COLOUR: [&str; 12] = ["rg", "RG", "k", "K", "g", "G", "cs", "CS", "sc", "SC", "scn", "SCN"];
    let mut out = Vec::new();
    let mut operands: Vec<String> = Vec::new();
    for t in String::from_utf8_lossy(content).split_ascii_whitespace() {
        let is_op = t.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '*');
        if !is_op {
            operands.push(t.to_string());
            continue;
        }
        if !COLOUR.contains(&t) {
            out.append(&mut operands);
            out.push(t.to_string());
        }
        operands.clear();
    }
    out
}

fn inflate_object_stream(pdf: &[u8], obj: &str) -> Vec<u8> {
    let start = pdf.windows(obj.len()).position(|w| w == obj.as_bytes()).unwrap();
    let s = start + pdf[start..].windows(7).position(|w| w == b"stream\n").unwrap() + 7;
    let e = s + pdf[s..].windows(10).position(|w| w == b"\nendstream").unwrap();
    miniz_oxide::inflate::decompress_to_vec_zlib(&pdf[s..e]).unwrap()
}

/// R-COLOR-06 raster probe: rasterise the production SVG of the same scene with resvg/tiny-skia
/// at 200 mm × 300 dpi, then write (a) RGBA PNG with an embedded sRGB profile (generated by
/// Little CMS) and pHYs, (b) CMYK TIFF flattened on white, converted by moxcms (8-bit), with the
/// CMYK profile embedded and 300 dpi. Each file is written twice to check byte determinism.
fn raster(out: &str, sc: &Scene, srgb_b: &[u8], cmyk_b: &[u8]) -> serde_json::Value {
    use std::time::Instant;
    let dpi = 300.0_f64;
    let w = (200.0 / 25.4 * dpi).round() as u32;
    let h = (f64::from(w) * sc.height / sc.width).round() as u32;
    let svg = vector_engine::svg::to_svg(sc).unwrap();
    let t0 = Instant::now();
    let tree = resvg::usvg::Tree::from_str(&svg, &resvg::usvg::Options::default()).unwrap();
    let mut pm = resvg::tiny_skia::Pixmap::new(w, h).unwrap();
    let s = w as f32 / sc.width as f32;
    resvg::render(&tree, resvg::tiny_skia::Transform::from_scale(s, s), &mut pm.as_mut());
    let render_ms = t0.elapsed().as_millis();
    let straight: Vec<u8> = pm
        .pixels()
        .iter()
        .flat_map(|p| {
            let c = p.demultiply();
            [c.red(), c.green(), c.blue(), c.alpha()]
        })
        .collect();
    let srgb_icc = Profile::new_srgb().icc().unwrap();
    let png_bytes = || {
        let mut buf = Vec::new();
        let mut e = png::Encoder::new(&mut buf, w, h);
        e.set_color(png::ColorType::Rgba);
        e.set_depth(png::BitDepth::Eight);
        e.set_pixel_dims(Some(png::PixelDimensions {
            xppu: 11_811,
            yppu: 11_811,
            unit: png::Unit::Meter,
        }));
        let mut wr = e.write_header().unwrap();
        let mut iccp = b"sRGB (Little CMS)\0\0".to_vec();
        iccp.extend(miniz_oxide::deflate::compress_to_vec_zlib(&srgb_icc, 9));
        wr.write_chunk(png::chunk::ChunkType(*b"iCCP"), &iccp).unwrap();
        wr.write_image_data(&straight).unwrap();
        wr.finish().unwrap();
        buf
    };
    let t1 = Instant::now();
    let p1 = png_bytes();
    let png_ms = t1.elapsed().as_millis();
    let p2 = png_bytes();
    fs::write(format!("{out}/raster-rgba-srgb.png"), &p1).unwrap();
    // Flatten on white in encoded sRGB (as the preview composites), then convert.
    let rgb: Vec<u8> = straight
        .chunks_exact(4)
        .flat_map(|p| {
            let a = u32::from(p[3]);
            [0, 1, 2].map(|i| ((u32::from(p[i]) * a + 255 * (255 - a) + 127) / 255) as u8)
        })
        .collect();
    let t2 = Instant::now();
    let cmyk: Vec<u8> = moxcms_convert(srgb_b, cmyk_b, 4, 1, true, 8, &rgb)
        .unwrap()
        .into_iter()
        .map(|v| v as u8)
        .collect();
    let convert_ms = t2.elapsed().as_millis();
    let tiff_bytes =
        || {
            let mut cur = std::io::Cursor::new(Vec::new());
            let mut enc = tiff::encoder::TiffEncoder::new(&mut cur).unwrap().with_compression(
                tiff::encoder::Compression::Deflate(tiff::encoder::DeflateLevel::Balanced),
            );
            let mut img = enc.new_image::<tiff::encoder::colortype::CMYK8>(w, h).unwrap();
            img.resolution(
                tiff::tags::ResolutionUnit::Inch,
                tiff::encoder::Rational { n: 300, d: 1 },
            );
            img.encoder().write_tag(tiff::tags::Tag::IccProfile, cmyk_b).unwrap();
            img.write_data(&cmyk).unwrap();
            cur.into_inner()
        };
    let t3 = Instant::now();
    let c1 = tiff_bytes();
    let tiff_ms = t3.elapsed().as_millis();
    let c2 = tiff_bytes();
    fs::write(format!("{out}/raster-cmyk.tif"), &c1).unwrap();
    json!({
        "pixels": [w, h], "megapixels": (f64::from(w) * f64::from(h) / 1e6 * 100.0).round() / 100.0,
        "pixmapBytes": pm.data().len(), "cmykBytes": cmyk.len(),
        "ms": { "parseAndRender": render_ms, "pngEncode": png_ms, "rgbToCmyk": convert_ms, "tiffEncode": tiff_ms },
        "png": { "bytes": p1.len(), "deterministic": p1 == p2 },
        "tiff": { "bytes": c1.len(), "deterministic": c1 == c2 },
    })
}

fn main() {
    let out = std::env::args().nth(1).expect("usage: pdf_proto <out-dir>");
    fs::create_dir_all(&out).unwrap();
    let srgb_b = fs::read(std::env::var("RC_SRGB").unwrap()).unwrap();
    let cmyk_b = fs::read(std::env::var("RC_CMYK").unwrap()).unwrap();
    let sc = scene();
    sc.validate(1_000_000).unwrap();

    // Conversion table: one entry per distinct effective RGB (alpha is carried separately).
    let mut uniq: Vec<[u8; 3]> = Vec::new();
    for c in sc
        .background
        .iter()
        .copied()
        .chain(sc.groups.iter().flat_map(|g| g.paths.iter()).flat_map(|p| {
            p.fill
                .iter()
                .map(|f| f.color)
                .chain(p.stroke.iter().map(|s| s.color))
                .collect::<Vec<_>>()
        }))
    {
        let k = [c.r, c.g, c.b];
        if !uniq.contains(&k) {
            uniq.push(k);
        }
    }
    let flat: Vec<u8> = uniq.iter().flatten().copied().collect();
    let conv = moxcms_convert(&srgb_b, &cmyk_b, 4, 1, true, 8, &flat).unwrap();
    // 8-bit integer path (bit-identical native/WASM on the patch corpus), as ink fractions.
    let paint = Paint {
        cmyk: uniq
            .iter()
            .zip(conv.chunks_exact(4))
            .map(|(k, v)| (*k, [v[0], v[1], v[2], v[3]].map(|x| x / 255.0)))
            .collect(),
    };

    let base = to_pdf(
        &sc,
        &PdfOptions {
            width: 200.0,
            unit: Unit::Mm,
            dpi: None,
        },
    )
    .unwrap();
    fs::write(format!("{out}/A-device-rgb.pdf"), &base).unwrap();
    let base_tokens = geometry_tokens(&inflate_object_stream(&base, "4 0 obj"));
    let mut variants =
        vec![json!({ "variant": "A-device-rgb", "bytes": base.len(), "writer": "production to_pdf (unmodified)" })];
    for (name, mode) in [
        ("A2-device-rgb-group", Mode::DeviceRgbGroup),
        ("B-icc-rgb", Mode::IccRgb),
        ("B2-icc-rgb-group", Mode::IccRgbGroup),
        ("C-cmyk", Mode::Cmyk),
        ("D-cmyk-spot", Mode::CmykSpot),
        ("E-plate-spot", Mode::Plate),
    ] {
        let (bytes, art) = write_variant(&sc, mode, &paint, &srgb_b, &cmyk_b);
        fs::write(format!("{out}/{name}.pdf"), &bytes).unwrap();
        let toks = geometry_tokens(&art);
        // C/D extend the background rect into the bleed: compare everything after it too.
        let same = toks == base_tokens;
        let diff_at = toks.iter().zip(&base_tokens).position(|(a, b)| a != b);
        let differing = toks.iter().zip(&base_tokens).filter(|(a, b)| a != b).count();
        variants.push(json!({
            "variant": name, "bytes": bytes.len(),
            "artworkGeometryTokensEqualToProduction": same,
            "geometryTokenCount": toks.len(), "productionTokenCount": base_tokens.len(),
            "firstDifferenceAt": diff_at,
            "differingTokens": differing,
            "firstDifference": diff_at.map(|i| format!("{} vs {}", toks[i], base_tokens[i])),
        }));
    }

    // Transparency: composite each translucent overlap in sRGB (what DeviceRGB/preview does)
    // and in CMYK (what a DeviceCMYK page group does), then compare in Lab.
    let srgb = Profile::new_icc(&srgb_b).unwrap();
    let cmyk = Profile::new_icc(&cmyk_b).unwrap();
    let lab = Profile::new_lab4_context(
        lcms2::GlobalContext::new(),
        &CIExyY {
            x: 0.3457,
            y: 0.3585,
            Y: 1.0,
        },
    )
    .unwrap();
    let rgb_lab: Transform<[f32; 3], [f64; 3]> = Transform::new(
        &srgb,
        PixelFormat::RGB_FLT,
        &lab,
        PixelFormat::Lab_DBL,
        Intent::RelativeColorimetric,
    )
    .unwrap();
    let cmyk_lab: Transform<[f32; 4], [f64; 3]> = Transform::new(
        &cmyk,
        PixelFormat::CMYK_FLT,
        &lab,
        PixelFormat::Lab_DBL,
        Intent::RelativeColorimetric,
    )
    .unwrap();
    let bg = [0xee, 0xe8, 0xd8];
    let layers: [(&str, &[[u8; 3]]); 4] = [
        ("red-over-ivory", &[[255, 0, 0]]),
        ("red+green", &[[255, 0, 0], [0, 255, 0]]),
        ("red+green+blue", &[[255, 0, 0], [0, 255, 0], [0, 0, 255]]),
        ("green+blue", &[[0, 255, 0], [0, 0, 255]]),
    ];
    let a = 128.0 / 255.0;
    let mut overlaps = Vec::new();
    for (name, stack) in layers {
        let mut r = bg.map(|v| f32::from(v) / 255.0);
        let mut k = paint.cmyk[&bg];
        for c in stack {
            let s = c.map(|v| f32::from(v) / 255.0);
            let kc = paint.cmyk[c];
            for i in 0..3 {
                r[i] = a * s[i] + (1.0 - a) * r[i];
            }
            for i in 0..4 {
                k[i] = a * kc[i] + (1.0 - a) * k[i];
            }
        }
        // Reference: convert the sRGB composite to CMYK (what an export that flattens in RGB
        // first would print), then to Lab.
        let rq = r.map(|v| (v * 255.0).round() as u8);
        let flat_k = moxcms_convert(&srgb_b, &cmyk_b, 4, 1, true, 8, &rq).unwrap();
        let mut l1 = [[0f64; 3]];
        let mut l2 = [[0f64; 3]];
        let mut l3 = [[0f64; 3]];
        rgb_lab.transform_pixels(&[r], &mut l1);
        cmyk_lab.transform_pixels(&[k.map(|v| v * 100.0)], &mut l2);
        cmyk_lab.transform_pixels(
            &[[flat_k[0], flat_k[1], flat_k[2], flat_k[3]].map(|v| v / 2.55)],
            &mut l3,
        );
        overlaps.push(json!({
            "overlap": name,
            "dE00_cmykComposite_vs_rgbCompositeConverted": (ciede2000(l2[0], l3[0]) * 100.0).round() / 100.0,
            "dE00_cmykComposite_vs_srgbPreview": (ciede2000(l2[0], l1[0]) * 100.0).round() / 100.0,
            "dE00_rgbCompositeConverted_vs_srgbPreview": (ciede2000(l3[0], l1[0]) * 100.0).round() / 100.0,
        }));
    }
    let table: Vec<_> = uniq
        .iter()
        .map(|k| {
            json!({ "srgb": format!("#{:02x}{:02x}{:02x}", k[0], k[1], k[2]),
        "cmykPercent": paint.cmyk[k].map(|v| (f64::from(v) * 1000.0).round() / 10.0) })
        })
        .collect();
    let report = json!({
        "scene": { "width": sc.width, "height": sc.height, "groups": sc.groups.len(),
                   "paths": sc.groups.iter().map(|g| g.paths.len()).sum::<usize>(), "distinctColours": uniq.len() },
        "conversion": "moxcms 0.9.2, sRGB -> CMYK profile, relative colorimetric, 8-bit integer path",
        "conversionTable": table,
        "variants": variants,
        "translucentOverlaps": overlaps,
        "raster": raster(&out, &sc, &srgb_b, &cmyk_b),
    });
    fs::write(
        format!("{out}/pdf-proto.json"),
        serde_json::to_string_pretty(&report).unwrap() + "\n",
    )
    .unwrap();
}
