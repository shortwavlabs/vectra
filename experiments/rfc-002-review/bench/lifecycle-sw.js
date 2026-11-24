// Harness service worker: precaches the lifecycle harness and the engine so workers can be
// recreated offline (mirrors the role of the P0 versioned service worker).
const CACHE = "rfc002-lifecycle-v1";
const FILES = ["/bench/lifecycle.html", "/bench/lifecycle.js", "/bench/lifecycle-worker.js", "/bench/scheduler.mjs",
  "/bench/packet.mjs", "/pkg/vector_engine_wasm.js", "/pkg/vector_engine_wasm_bg.wasm"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r ?? fetch(e.request)));
});
