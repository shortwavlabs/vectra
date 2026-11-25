//! Review finding 4 (AM-1 corrective review): `bake_draw_list` must reject an over-cap draw list
//! with a typed budget error *before* copying geometry. A separate test binary, so the counting
//! allocator sees only this test.
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

use vector_engine::bake::{bake_draw_list, identity_draw_list};
use vector_engine::color::Rgba;
use vector_engine::error::EngineError;
use vector_engine::packet::{GeometryPacket, Limits, SceneMeta};
use vector_engine::scene::{Fill, FillRule, Group, Metadata, Path, SCENE_VERSION, Scene};

struct Counting;
static ALLOCATED: AtomicUsize = AtomicUsize::new(0);
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCATED.fetch_add(layout.size(), Ordering::Relaxed);
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
}
#[global_allocator]
static GLOBAL: Counting = Counting;

#[test]
fn bake_checks_the_anchor_cap_before_copying_geometry() {
    let path = Path {
        fill: Some(Fill {
            color: Rgba::rgb(0, 0, 0),
            palette_id: None,
        }),
        stroke: None,
        fill_rule: FillRule::Nonzero,
        verbs: format!("M{}", "L".repeat(999)),
        coords: (0..2000).map(|i| f64::from(i % 50)).collect(),
    };
    let scene = Scene {
        version: SCENE_VERSION,
        width: 100.0,
        height: 100.0,
        background: None,
        palette: vec![],
        groups: vec![Group {
            id: "g".into(),
            clip: None,
            paths: vec![path],
        }],
        metadata: Metadata {
            generator: "vectra".into(),
            engine_version: "0".into(),
            mode: "bw".into(),
            preset_version: 1,
            seed: 1,
            source_width: 100,
            source_height: 100,
            params: serde_json::json!({}),
        },
    };
    let packet = GeometryPacket::from_scene(&scene).unwrap();
    let meta = SceneMeta::from_scene(&scene);
    let mut list = identity_draw_list(&packet, 0);
    let item = list.items[0].clone();
    list.items = vec![item; 20_000]; // 20M anchors referenced against a 1M cap
    let before = ALLOCATED.load(Ordering::Relaxed);
    let err = bake_draw_list(&list, std::slice::from_ref(&packet), &meta, &Limits::PRODUCT).unwrap_err();
    let used = ALLOCATED.load(Ordering::Relaxed) - before;
    assert!(matches!(err, EngineError::TooManyPrimitives { .. }), "{err}");
    // Copying the referenced geometry would allocate ~320 MB; the early check allocates almost nothing.
    assert!(used < 8 << 20, "bake allocated {used} bytes before rejecting");
}
