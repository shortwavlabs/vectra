const gl = document.createElement("canvas").getContext("webgl2") ?? document.createElement("canvas").getContext("webgl");
  const dbg = gl?.getExtension("WEBGL_debug_renderer_info");
  const frames = [];
  let last = performance.now();
  await new Promise((done) => {
    const t0 = last;
    const tick = (t) => {
      frames.push(t - last);
      last = t;
      if (t - t0 < 1000) requestAnimationFrame(tick);
      else done();
    };
    requestAnimationFrame(tick);
  });
  frames.shift();
  frames.sort((a, b) => a - b);
  window.__probe = {
    ua: navigator.userAgent,
    dpr: devicePixelRatio,
    viewport: [innerWidth, innerHeight],
    screen: [screen.width, screen.height],
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory ?? null,
    webgl: gl ? (gl instanceof WebGL2RenderingContext ? "webgl2" : "webgl1") : null,
    glVendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl?.getParameter(gl.VENDOR),
    glRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER),
    maxTextureSize: gl?.getParameter(gl.MAX_TEXTURE_SIZE),
    rafMedianMs: frames[frames.length >> 1],
    rafFrames: frames.length,
    crossOriginIsolated,
    jsHeap: performance.memory ? performance.memory.jsHeapSizeLimit : null,
  };
