# Packet determinism fixtures (C3 r2, AM-1 AR-3)

Each `<case>.scene.json.raw` is a native scene from the frozen G-0 regression corpus (`regression_corpus` at `main` `29432da`), byte-identical to its entry in `docs/research/p0-r-geo/artifacts/regression/a4cf172.sha256`. Each `<case>.packet.bin` is the C3.0 block that the native Rust `GeometryPacket::from_scene` produces from that scene.

**Three producers must give the same bytes from the same scene JSON:**
- Rust native (`crates/vector-engine/tests/packet.rs`);
- the built WASM `sceneToPacket` export (`tests/unit/geometry-determinism.test.ts`);
- the TypeScript `packetFromScene` (the same test).

`nested_rings-color`, `nested_rings-mosaic` and `sharp_corners-mosaic` are the three TD-PLATFORM-007 fixtures. Their native and WASM *traces* differ, but from identical scene input all three producers agree. The `.raw` suffix keeps `vp check` from reformatting the minified JSON.

Only procedural fixtures are used here, never photographic inputs.
