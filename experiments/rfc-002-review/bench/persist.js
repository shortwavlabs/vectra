// R05-B micro-benchmark: native deflate-raw (CompressionStream) and SHA-256 (SubtleCrypto) on
// GeometryPacket bytes — the primitives a dependency-free project container needs.
const names = ["synthetic-many-1m", "architecture-street-halftone", "portrait-large-color", "concert-small-venue-bw"];
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
const out = [];
for (const name of names) {
  const bin = new Uint8Array(await fetch(`/packets/${name}.bin`).then((r) => r.arrayBuffer()));
  for (let rep = 0; rep < 3; rep++) {
    let t = performance.now();
    const z = await pipe(bin, new CompressionStream("deflate-raw"));
    const compressMs = performance.now() - t;
    t = performance.now();
    const back = await pipe(z, new DecompressionStream("deflate-raw"));
    const decompressMs = performance.now() - t;
    t = performance.now();
    await crypto.subtle.digest("SHA-256", bin);
    const sha256Ms = performance.now() - t;
    out.push({ name, rep, bytes: bin.byteLength, deflated: z.byteLength, roundTripOk: back.byteLength === bin.byteLength && back.every((v, i) => v === bin[i]), compressMs, decompressMs, sha256Ms });
  }
}
window.__done = { ok: true, results: out };
