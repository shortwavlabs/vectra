//! Raster tracing adapter over VTracer 1.0.0-alpha.4 (pinned). All VTracer and visioncortex
//! types are confined to this module so the tracer can be swapped without touching the scene,
//! exporters or WASM boundary.
//!
//! Vectra owns the pre-processing policy (luminance, threshold, invert, alpha, speckle,
//! palette); VTracer's frontends are bypassed because their transparency keying only triggers
//! when ≥20 % of five sampled rows are fully transparent (see P0-G1 report). VTracer supplies
//! hierarchical colour clustering (via visioncortex), compositing, curve fitting and cleanup.

use visioncortex::color_clusters::{HIERARCHICAL_MAX, KeyingAction, Runner, RunnerConfig};
use visioncortex::{BinaryImage, Color, ColorImage, PointF64, PointI32};
use vtracer::ir::{Layer, MultiPath, Paint, PathCmd, RegionMask, Segmentation, Shape, SubPath, VectorDoc};

use crate::color::{Luma, Rgba};
use crate::error::EngineError;
use crate::image::RgbaImage;
use crate::params::{Compositing, FitMode, FitSettings};
use crate::precision;
use crate::region::Mask;
use crate::scene::PathBuilder;

/// Binary ink mask for black & white tracing.
pub fn bw_mask(img: &RgbaImage, luma: &Luma, threshold: u8, invert: bool, alpha_threshold: u8) -> Vec<bool> {
    img.data
        .chunks_exact(4)
        .map(|p| p[3] >= alpha_threshold && ((luma.luma(p[0], p[1], p[2]) < threshold) != invert))
        .collect()
}

fn binary_image(mask: &[bool], w: usize, h: usize, value: bool) -> BinaryImage {
    let mut b = BinaryImage::new_w_h(w, h);
    for y in 0..h {
        for x in 0..w {
            if mask[y * w + x] == value {
                b.set_pixel(x, y, true);
            }
        }
    }
    b
}

/// Speckle removal in both directions: enclosed background holes smaller than `area` are
/// filled here; ink components smaller than `area` are dropped in `bw_segmentation`.
/// Foreground is 4-connected, background 8-connected (dual topology).
pub fn fill_small_holes(mask: &mut [bool], w: usize, h: usize, area: usize) {
    if area == 0 {
        return;
    }
    let clusters = binary_image(mask, w, h, false).to_clusters(true);
    for c in &clusters.clusters {
        let r = c.rect;
        let touches_border = r.left == 0 || r.top == 0 || r.right as usize == w || r.bottom as usize == h;
        if c.size() < area && !touches_border {
            for p in &c.points {
                mask[p.y as usize * w + p.x as usize] = true;
            }
        }
    }
}

pub fn bw_segmentation(mask: &[bool], w: usize, h: usize, min_area: usize, ink: Rgba) -> Segmentation {
    let clusters = binary_image(mask, w, h, true).to_clusters(false);
    let mut seg = Segmentation::new(w as u32, h as u32);
    for c in &clusters.clusters {
        if c.size() < min_area.max(1) {
            continue;
        }
        let mask = RegionMask::new(
            c.to_binary_image(),
            PointI32 {
                x: c.rect.left,
                y: c.rect.top,
            },
        );
        seg.layers.push(Layer {
            paint: Paint::Solid(Color::new(ink.r, ink.g, ink.b)),
            mask,
        });
    }
    seg
}

/// Copies the image for clustering. Pixels with alpha below the threshold become a key colour
/// that does not occur among the opaque pixels (deterministic search); all other pixels become
/// fully opaque, optionally recoloured by `map` (palette quantisation).
/// Returns the image, the key (or `Color::default()` = no keying) and the count of
/// partially transparent pixels whose alpha was binarised.
pub fn keyed_image(
    img: &RgbaImage,
    alpha_threshold: u8,
    mut map: impl FnMut(u8, u8, u8) -> [u8; 3],
) -> (ColorImage, Color, u64) {
    let mut pixels = Vec::with_capacity(img.data.len());
    let mut used = vec![0u64; (1 << 24) / 64];
    let mut transparent = false;
    let mut partial = 0u64;
    for p in img.data.chunks_exact(4) {
        if p[3] > 0 && p[3] < 255 {
            partial += 1;
        }
        if p[3] < alpha_threshold {
            transparent = true;
            pixels.extend_from_slice(&[0, 0, 0, 0]);
        } else {
            let c = map(p[0], p[1], p[2]);
            let key = (usize::from(c[0]) << 16) | (usize::from(c[1]) << 8) | usize::from(c[2]);
            used[key / 64] |= 1 << (key % 64);
            pixels.extend_from_slice(&[c[0], c[1], c[2], 255]);
        }
    }
    let mut key = Color::default();
    if transparent {
        // Odd multiplier => permutation of the 24-bit cube; start at magenta, skip black.
        let k = (0u32..1 << 24)
            .map(|i| (0x00FF_00FF_u32.wrapping_add(i.wrapping_mul(0x009E_3779))) & 0x00FF_FFFF)
            .find(|&c| c != 0 && used[c as usize / 64] & (1 << (c % 64)) == 0)
            .expect("at least one unused colour exists when a pixel is transparent");
        key = Color::new((k >> 16) as u8, (k >> 8) as u8, k as u8);
        for px in pixels.chunks_exact_mut(4) {
            if px[3] == 0 {
                px.copy_from_slice(&[key.r, key.g, key.b, 255]);
            }
        }
    }
    let image = ColorImage {
        pixels,
        width: img.width as usize,
        height: img.height as usize,
    };
    (image, key, partial)
}

/// Hierarchical colour clustering (visioncortex) with the keyed background discarded.
pub fn cluster_segmentation(
    image: ColorImage,
    key: Color,
    precision_loss: i32,
    layer_difference: i32,
    min_area: usize,
) -> Segmentation {
    let (w, h) = (image.width, image.height);
    let config = RunnerConfig {
        diagonal: layer_difference == 0,
        hierarchical: HIERARCHICAL_MAX,
        batch_size: 25_600,
        good_min_area: min_area,
        good_max_area: w * h,
        is_same_color_a: precision_loss,
        is_same_color_b: 1,
        deepen_diff: layer_difference,
        hollow_neighbours: 1,
        key_color: key,
        keying_action: KeyingAction::Discard,
    };
    let clusters = Runner::new(config, image).run();
    let view = clusters.view();
    let mut seg = Segmentation::new(w as u32, h as u32);
    // clusters_output is top-to-bottom; layers are bottom-to-top.
    for &index in view.clusters_output.iter().rev() {
        let c = view.get_cluster(index);
        let mask = RegionMask::new(
            c.to_image_with_hole(view.width, false),
            PointI32 {
                x: c.rect.left,
                y: c.rect.top,
            },
        );
        seg.layers.push(Layer {
            paint: Paint::Solid(c.residue_color()),
            mask,
        });
    }
    seg
}

/// Stage timings in milliseconds, measured with the caller's clock.
#[derive(Default)]
pub struct StageTimes {
    pub color_fit: f64,
    pub compose: f64,
    pub optimize: f64,
}

/// A VTracer region mask in Vectra's own type.
pub fn region_mask(m: &RegionMask) -> Mask {
    let (w, h) = (m.image.width, m.image.height);
    let mut bits = vec![false; w * h];
    for y in 0..h {
        for x in 0..w {
            bits[y * w + x] = m.image.get_pixel(x, y);
        }
    }
    Mask {
        x0: usize::try_from(m.offset.x).unwrap_or(0),
        y0: usize::try_from(m.offset.y).unwrap_or(0),
        w,
        h,
        bits,
    }
}

/// Runs VTracer's colour fitters (palette snapping) on a segmentation in place; the same
/// fitters `fit_segmentation` selects for this palette.
pub fn fit_colors(seg: &mut Segmentation, layer_difference: i32, palette: &[Rgba]) -> Result<(), EngineError> {
    let cfg = vtracer::Config {
        layer_difference,
        palette: palette.iter().map(|c| Color::new(c.r, c.g, c.b)).collect(),
        ..vtracer::Config::default()
    };
    let pipeline = cfg.build().map_err(|e| EngineError::Tracer(e.to_string()))?;
    for fitter in &pipeline.color_fitters {
        fitter.fit(seg);
    }
    Ok(())
}

/// Source data the precision fitter reads.
pub struct PrecisionInput<'a> {
    pub img: RgbaImage<'a>,
    pub luma: &'a Luma,
    pub policy: precision::EdgePolicy,
    /// Engineering override of the precision options (evaluation tools only). `None` uses
    /// VTracer's fitting, or the production precision options when `fit.mode = precision`.
    pub options: Option<precision::Options>,
}

/// Precision compositing: every layer traced independently (stacked, paint order kept) with
/// Vectra's sub-pixel contour and G1 cubic fitter instead of VTracer's spline fitter.
fn precision_compose(seg: &Segmentation, input: &PrecisionInput, opts: &precision::Options) -> VectorDoc {
    let field = precision::Field::new(
        input.img,
        input.luma,
        input.policy,
        opts.subpixel,
        seg.layers.iter().map(|l| region_mask(&l.mask)),
    );
    let pt = |p: [f64; 2]| PointF64 { x: p[0], y: p[1] };
    let mut doc = VectorDoc::new(seg.width, seg.height);
    for layer in &seg.layers {
        let mut path = MultiPath::new();
        for c in precision::contours(&field, &region_mask(&layer.mask)) {
            let Some(l) = precision::fit_contour(&c, opts) else {
                continue;
            };
            let mut sub = SubPath::new();
            sub.commands.push(PathCmd::MoveTo(pt(l.start)));
            for s in &l.segs {
                sub.commands.push(match *s {
                    precision::Seg::Line(e) => PathCmd::LineTo(pt(e)),
                    precision::Seg::Cubic(c) => PathCmd::CubicTo(pt([c[0], c[1]]), pt([c[2], c[3]]), pt([c[4], c[5]])),
                });
            }
            sub.commands.push(PathCmd::Close);
            path.push(sub);
        }
        if !path.is_empty() {
            doc.shapes.push(Shape {
                paint: layer.paint,
                path,
            });
        }
    }
    doc
}

/// Colour fitting → compositing (curve fitting + simplification) → cleanup, via VTracer.
/// With precision options, Vectra's precision fitter replaces VTracer's compositing.
#[allow(clippy::too_many_arguments)]
pub fn fit_segmentation(
    mut seg: Segmentation,
    fit: &FitSettings,
    compositing: Compositing,
    layer_difference: i32,
    palette: &[Rgba],
    input: &PrecisionInput,
    clock: &dyn Fn() -> f64,
    times: &mut StageTimes,
) -> Result<VectorDoc, EngineError> {
    let cfg = vtracer::Config {
        hierarchical: match compositing {
            Compositing::Stacked => vtracer::Hierarchical::Stacked,
            Compositing::Mosaic => vtracer::Hierarchical::Cutout,
        },
        mode: match fit.mode {
            FitMode::Spline | FitMode::Precision => vtracer::FitMode::Spline,
            FitMode::Polygon => vtracer::FitMode::Polygon,
            FitMode::Pixel => vtracer::FitMode::Pixel,
        },
        corner_threshold: fit.corner_threshold,
        length_threshold: fit.length_threshold,
        splice_threshold: fit.splice_threshold,
        simplify: (fit.simplify > 0.0).then_some(fit.simplify),
        layer_difference,
        path_precision: Some(2),
        optimize: 1,
        palette: palette.iter().map(|c| Color::new(c.r, c.g, c.b)).collect(),
        ..vtracer::Config::default()
    };
    let pipeline = cfg.build().map_err(|e| EngineError::Tracer(e.to_string()))?;
    let t = clock();
    for fitter in &pipeline.color_fitters {
        fitter.fit(&mut seg);
    }
    let t1 = clock();
    let precision = match (&input.options, fit.mode) {
        (Some(o), _) => Some(*o),
        (None, FitMode::Precision) => Some(precision::Options::production(fit.corner_threshold)),
        (None, _) => None,
    };
    let mut doc = match &precision {
        Some(opts) => precision_compose(&seg, input, opts),
        None => pipeline.compositing.compose(&seg, &pipeline.curve_passes),
    };
    let t2 = clock();
    for pass in &pipeline.optimizers {
        pass.run(&mut doc);
    }
    let t3 = clock();
    times.color_fit += t1 - t;
    times.compose += t2 - t1;
    times.optimize += t3 - t2;
    Ok(doc)
}

/// Converts VTracer's document (absolute coordinates, paint order) into path geometry.
pub fn doc_paths(doc: &VectorDoc) -> Vec<(Rgba, PathBuilder)> {
    let mut out = Vec::with_capacity(doc.shapes.len());
    for shape in &doc.shapes {
        let c = shape.paint.color();
        let mut b = PathBuilder::default();
        for sub in &shape.path.subpaths {
            for cmd in &sub.commands {
                match *cmd {
                    PathCmd::MoveTo(p) => b.move_to(p.x, p.y),
                    PathCmd::LineTo(p) => b.line_to(p.x, p.y),
                    PathCmd::CubicTo(c1, c2, p) => b.cubic_to([c1.x, c1.y, c2.x, c2.y, p.x, p.y]),
                    PathCmd::Close => b.close(),
                }
            }
        }
        if !b.is_empty() {
            out.push((Rgba::rgb(c.r, c.g, c.b), b));
        }
    }
    out
}
