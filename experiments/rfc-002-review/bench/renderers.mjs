// R02 renderer candidates behind one minimal port (RFC-002 §7): load / draw / camera / select /
// object transform / group visibility / style colour / invalidate / resize / release.
// Review experiment only: one file, no production structure implied.
import { C, L, M, Z } from "./packet.mjs";
import { flattenCubic, forEachSubpath } from "./hit.mjs";
import { rgba } from "./common.mjs";

const LIME = "#b9e87b";

/** SVG path data for path i (linear-time Path2D/DOM construction in every engine). */
export function dString(p, i) {
  const c = p.coords, v = p.verbs;
  let s = "", ci = p.coordOffsets[i];
  for (let k = p.verbOffsets[i]; k < p.verbOffsets[i + 1]; k++) {
    const op = v[k];
    if (op === M) { s += "M" + c[ci] + " " + c[ci + 1]; ci += 2; }
    else if (op === L) { s += "L" + c[ci] + " " + c[ci + 1]; ci += 2; }
    else if (op === C) { s += "C" + c[ci] + " " + c[ci + 1] + " " + c[ci + 2] + " " + c[ci + 3] + " " + c[ci + 4] + " " + c[ci + 5]; ci += 6; }
    else s += "Z";
  }
  return s;
}

class Base {
  constructor(stage, opts) {
    this.stage = stage;
    this.opts = opts;
    this.cam = { s: 1, tx: 0, ty: 0 };
    this.sel = -1;
    this.objT = null; // [a,b,c,d,e,f] for the selected object while dragging
    this.hidden = new Set();
    this.colorOverride = new Map(); // style index -> css colour
  }
  styleColor(si) {
    return this.colorOverride.get(si) ?? (this.p.manifest.styles[si].fill == null ? "none" : rgba(this.p.manifest.styles[si].fill));
  }
  resize(w, h, dpr) {
    this.w = w; this.h = h; this.dpr = dpr;
  }
  setStyleColor(si, css) {
    this.colorOverride.set(si, css);
  }
  memory() {
    return {};
  }
}

// ---------------------------------------------------------------- Canvas 2D (retained Path2D)
export class CanvasRenderer extends Base {
  constructor(stage, opts) {
    super(stage, opts);
    this.canvas = document.createElement("canvas");
    stage.append(this.canvas);
    this.ctx = this.canvas.getContext("2d");
  }
  resize(w, h, dpr) {
    super.resize(w, h, dpr);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }
  load(p, derived) {
    this.p = p; this.bounds = derived.bounds;
    const t = performance.now();
    const n = p.manifest.pathCount;
    this.paths = new Array(n);
    for (let i = 0; i < n; i++) this.paths[i] = new Path2D(dString(p, i));
    return { pathBuildMs: performance.now() - t };
  }
  invalidate(i) {
    this.paths[i] = new Path2D(dString(this.p, i));
  }
  draw() {
    const { ctx, p, cam, dpr } = this;
    const n = p.manifest.pathCount, b = this.bounds, gi = p.groupIndex, si = p.styleIndex;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.opts.white) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    } else ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr * cam.s, 0, 0, dpr * cam.s, dpr * cam.tx, dpr * cam.ty);
    const vx0 = -cam.tx / cam.s, vy0 = -cam.ty / cam.s, vx1 = vx0 + this.w / cam.s, vy1 = vy0 + this.h / cam.s;
    let g = -1, clipped = false, drawn = 0;
    const groups = p.manifest.groups, styles = p.manifest.styles;
    for (let i = 0; i < n; i++) {
      if (gi[i] !== g) {
        if (clipped) ctx.restore();
        g = gi[i];
        const clip = groups[g].clip;
        clipped = !!clip;
        if (clip) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(clip.x, clip.y, clip.width, clip.height);
          ctx.clip();
        }
      }
      if (this.hidden.has(g)) continue;
      const moving = i === this.sel && this.objT;
      if (!moving && (b[4 * i] > vx1 || b[4 * i + 2] < vx0 || b[4 * i + 1] > vy1 || b[4 * i + 3] < vy0)) continue;
      const st = styles[si[i]];
      if (moving) {
        ctx.save();
        ctx.transform(...this.objT);
      }
      if (st.fill != null) {
        ctx.fillStyle = this.styleColor(si[i]);
        ctx.fill(this.paths[i], st.evenOdd ? "evenodd" : "nonzero");
      }
      if (st.stroke) {
        ctx.strokeStyle = rgba(st.stroke.color);
        ctx.lineWidth = st.stroke.width;
        ctx.stroke(this.paths[i]);
      }
      if (moving) ctx.restore();
      drawn++;
    }
    if (clipped) ctx.restore();
    if (this.sel >= 0) {
      ctx.save();
      if (this.objT) ctx.transform(...this.objT);
      ctx.strokeStyle = LIME;
      ctx.lineWidth = 1.5 / cam.s;
      ctx.stroke(this.paths[this.sel]);
      ctx.restore();
    }
    return drawn;
  }
  memory() {
    return { backingStoreBytes: this.canvas.width * this.canvas.height * 4 };
  }
  release() {
    this.paths = null;
    this.canvas.width = this.canvas.height = 0;
    this.canvas.remove();
  }
}

// ---------------------------------------------------------------- SVG DOM (retained elements)
const NS = "http://www.w3.org/2000/svg";
export class SvgDomRenderer extends Base {
  constructor(stage, opts) {
    super(stage, opts);
    this.svg = document.createElementNS(NS, "svg");
    this.root = document.createElementNS(NS, "g");
    this.overlay = document.createElementNS(NS, "path");
    this.overlay.setAttribute("fill", "none");
    this.overlay.setAttribute("stroke", LIME);
    this.overlay.setAttribute("stroke-width", "1.5");
    this.overlay.setAttribute("vector-effect", "non-scaling-stroke");
    this.svg.append(this.root);
    stage.append(this.svg);
  }
  resize(w, h, dpr) {
    super.resize(w, h, dpr);
    this.svg.setAttribute("width", w);
    this.svg.setAttribute("height", h);
  }
  load(p) {
    this.p = p;
    const t = performance.now();
    const n = p.manifest.pathCount, styles = p.manifest.styles;
    const defs = document.createElementNS(NS, "defs");
    this.svg.prepend(defs);
    this.groups = p.manifest.groups.map((g, gi) => {
      const el = document.createElementNS(NS, "g");
      if (g.clip) {
        const cp = document.createElementNS(NS, "clipPath");
        cp.id = `clip${gi}`;
        const r = document.createElementNS(NS, "rect");
        for (const k of ["x", "y", "width", "height"]) r.setAttribute(k, g.clip[k]);
        cp.append(r);
        defs.append(cp);
        el.setAttribute("clip-path", `url(#clip${gi})`);
      }
      return el;
    });
    this.els = new Array(n);
    for (let i = 0; i < n; i++) {
      const el = document.createElementNS(NS, "path");
      el.setAttribute("d", dString(p, i));
      const st = styles[p.styleIndex[i]];
      el.setAttribute("fill", st.fill == null ? "none" : rgba(st.fill));
      if (st.evenOdd) el.setAttribute("fill-rule", "evenodd");
      if (st.stroke) {
        el.setAttribute("stroke", rgba(st.stroke.color));
        el.setAttribute("stroke-width", st.stroke.width);
      }
      el.__i = i;
      this.els[i] = el;
      this.groups[p.groupIndex[i]].append(el);
    }
    this.root.append(...this.groups);
    this.root.append(this.overlay);
    return { pathBuildMs: performance.now() - t, domNodes: n + this.groups.length };
  }
  invalidate(i) {
    this.els[i].setAttribute("d", dString(this.p, i));
  }
  draw() {
    const { s, tx, ty } = this.cam;
    this.root.setAttribute("transform", `matrix(${s} 0 0 ${s} ${tx} ${ty})`);
    this.groups.forEach((g, gi) => (this.hidden.has(gi) ? g.setAttribute("display", "none") : g.removeAttribute("display")));
    if (this.sel >= 0) {
      this.overlay.setAttribute("d", this.els[this.sel].getAttribute("d"));
      const t = this.objT ? `matrix(${this.objT.join(" ")})` : null;
      for (const el of [this.overlay, this.els[this.sel]]) t ? el.setAttribute("transform", t) : el.removeAttribute("transform");
    } else this.overlay.removeAttribute("d");
    return this.els.length;
  }
  setStyleColor(si, css) {
    this.colorOverride.set(si, css);
    const idx = this.p.styleIndex;
    for (let i = 0; i < this.els.length; i++) if (idx[i] === si) this.els[i].setAttribute("fill", css);
  }
  nativeHit(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    return el && el.__i !== undefined && el !== this.overlay ? el.__i : -1;
  }
  release() {
    this.svg.remove();
    this.els = null;
  }
}

// ---------------------------------------------------------------- P0 baseline: SVG as <img>
export class SvgImageRenderer extends Base {
  constructor(stage, opts) {
    super(stage, opts);
    this.img = new Image();
    this.img.className = "svgimg";
    stage.append(this.img);
  }
  async loadSvg(svgText, p) {
    this.p = p;
    const t = performance.now();
    const blob = new Blob([svgText], { type: "image/svg+xml" });
    this.url = URL.createObjectURL(blob);
    this.img.src = this.url;
    await this.img.decode();
    return { pathBuildMs: performance.now() - t, svgBytes: blob.size };
  }
  draw() {
    const { s, tx, ty } = this.cam, m = this.p.manifest;
    this.img.style.width = `${m.width}px`;
    this.img.style.height = `${m.height}px`;
    this.img.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    return 1;
  }
  release() {
    URL.revokeObjectURL(this.url);
    this.img.remove();
  }
}

// ---------------------------------------------------------------- WebGL2 stencil-then-cover
const VS = `#version 300 es
in vec2 pos; uniform vec3 m0; uniform vec3 m1; uniform vec2 vp;
void main() { vec2 s = vec2(dot(m0, vec3(pos, 1.0)), dot(m1, vec3(pos, 1.0)));
  gl_Position = vec4(s.x / vp.x * 2.0 - 1.0, 1.0 - s.y / vp.y * 2.0, 0.0, 1.0); }`;
const FS = `#version 300 es
precision mediump float; uniform vec4 color; out vec4 o; void main() { o = color; }`;

export class WebGLRenderer extends Base {
  constructor(stage, opts) {
    super(stage, opts);
    this.canvas = document.createElement("canvas");
    stage.append(this.canvas);
    this.canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
    this.canvas.addEventListener("webglcontextrestored", () => {
      const t = performance.now();
      this.initGL();
      this.upload();
      this.draw();
      this.restoreMs = performance.now() - t;
      this.restored?.();
    });
    this.initGL();
  }
  initGL() {
    const gl = (this.gl = this.canvas.getContext("webgl2", { antialias: true, stencil: true, premultipliedAlpha: true }));
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    this.u = Object.fromEntries(["m0", "m1", "vp", "color"].map((k) => [k, gl.getUniformLocation(prog, k)]));
    this.posLoc = gl.getAttribLocation(prog, "pos");
  }
  resize(w, h, dpr) {
    super.resize(w, h, dpr);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }
  load(p, derived) {
    this.p = p; this.bounds = derived.bounds;
    const t = performance.now();
    const n = p.manifest.pathCount, tol = this.opts.tol ?? 0.05;
    const verts = [], idx = [];
    this.fan = new Uint32Array(2 * n); // [firstIndex, count] per path
    this.outline = []; // per path: list of [firstVertex, count] for selection outlines (lazy)
    for (let i = 0; i < n; i++) {
      const first = idx.length;
      const outl = [];
      forEachSubpath(p, i, tol, (_s, pts) => {
        const base = verts.length / 2, m = pts.length / 2;
        outl.push(base, m);
        for (let k = 0; k < pts.length; k++) verts.push(pts[k]);
        for (let k = 1; k < m - 1; k++) idx.push(base, base + k, base + k + 1);
      });
      this.fan[2 * i] = first;
      this.fan[2 * i + 1] = idx.length - first;
      this.outline[i] = outl;
    }
    this.coverBase = verts.length / 2;
    const b = derived.bounds;
    for (let i = 0; i < n; i++) verts.push(b[4 * i], b[4 * i + 1], b[4 * i + 2], b[4 * i + 1], b[4 * i], b[4 * i + 3], b[4 * i + 2], b[4 * i + 3]);
    this.verts = Float32Array.from(verts);
    this.idx = Uint32Array.from(idx);
    const tessMs = performance.now() - t;
    const t2 = performance.now();
    this.upload();
    this.gl.finish();
    return { pathBuildMs: tessMs, uploadMs: performance.now() - t2, vertexBytes: this.verts.byteLength, indexBytes: this.idx.byteLength };
  }
  upload() {
    const gl = this.gl;
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.posLoc);
    gl.vertexAttribPointer(this.posLoc, 2, gl.FLOAT, false, 0, 0);
    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.idx, gl.STATIC_DRAW);
  }
  draw() {
    const { gl, p, cam, dpr } = this;
    if (gl.isContextLost()) return 0;
    const W = this.canvas.width, H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    gl.uniform2f(this.u.vp, W, H);
    const setM = (a, b, c, d, e, f) => {
      gl.uniform3f(this.u.m0, a, c, e);
      gl.uniform3f(this.u.m1, b, d, f);
    };
    const S = dpr * cam.s, TX = dpr * cam.tx, TY = dpr * cam.ty;
    setM(S, 0, 0, S, TX, TY);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(...(this.opts.white ? [1, 1, 1, 1] : [0, 0, 0, 0]));
    gl.clearStencil(0);
    gl.stencilMask(0xff);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.enable(gl.STENCIL_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const n = p.manifest.pathCount, b = this.bounds, gi = p.groupIndex, si = p.styleIndex, styles = p.manifest.styles;
    const vx0 = -cam.tx / cam.s, vy0 = -cam.ty / cam.s, vx1 = vx0 + this.w / cam.s, vy1 = vy0 + this.h / cam.s;
    let g = -1, drawn = 0;
    for (let i = 0; i < n; i++) {
      if (gi[i] !== g) {
        g = gi[i];
        const clip = p.manifest.groups[g].clip;
        if (clip) {
          gl.enable(gl.SCISSOR_TEST);
          const x0 = Math.floor(clip.x * S + TX), y1 = Math.ceil((clip.y + clip.height) * S + TY);
          gl.scissor(x0, H - y1, Math.ceil(clip.width * S), Math.ceil(clip.height * S));
        } else gl.disable(gl.SCISSOR_TEST);
      }
      if (this.hidden.has(g)) continue;
      const moving = i === this.sel && this.objT;
      if (!moving && (b[4 * i] > vx1 || b[4 * i + 2] < vx0 || b[4 * i + 1] > vy1 || b[4 * i + 3] < vy0)) continue;
      const st = styles[si[i]];
      if (st.fill == null) continue; // strokes are out of scope for this narrow experiment
      if (moving) {
        const [a, bb, c, d, e, f] = this.objT;
        setM(S * a, S * bb, S * c, S * d, S * e + TX, S * f + TY);
      }
      // Stencil pass: winding into the stencil buffer, colour writes off.
      gl.colorMask(false, false, false, false);
      gl.stencilFunc(gl.ALWAYS, 0, 0xff);
      if (st.evenOdd) {
        gl.stencilMask(0x01);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
      } else {
        gl.stencilMask(0xff);
        gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, gl.INCR_WRAP);
        gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.KEEP, gl.DECR_WRAP);
      }
      gl.drawElements(gl.TRIANGLES, this.fan[2 * i + 1], gl.UNSIGNED_INT, 4 * this.fan[2 * i]);
      // Cover pass: bounding quad where stencil != 0, resetting the stencil as it goes.
      gl.colorMask(true, true, true, true);
      gl.stencilMask(0xff);
      gl.stencilFunc(gl.NOTEQUAL, 0, st.evenOdd ? 0x01 : 0xff);
      gl.stencilOp(gl.ZERO, gl.ZERO, gl.ZERO);
      const col = this.colorOverride.get(si[i]) ?? st.fill;
      const a = (col & 255) / 255;
      gl.uniform4f(this.u.color, ((col >>> 24) / 255) * a, (((col >>> 16) & 255) / 255) * a, (((col >>> 8) & 255) / 255) * a, a);
      gl.drawArrays(gl.TRIANGLE_STRIP, this.coverBase + 4 * i, 4);
      if (moving) setM(S, 0, 0, S, TX, TY);
      drawn++;
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    if (this.sel >= 0) {
      if (this.objT) {
        const [a, bb, c, d, e, f] = this.objT;
        setM(S * a, S * bb, S * c, S * d, S * e + TX, S * f + TY);
      }
      gl.uniform4f(this.u.color, 0xb9 / 255, 0xe8 / 255, 0x7b / 255, 1);
      const o = this.outline[this.sel];
      for (let k = 0; k < o.length; k += 2) gl.drawArrays(gl.LINE_LOOP, o[k], o[k + 1]);
    }
    return drawn;
  }
  setStyleColor(si, css) {
    // css is "#rrggbb": store as RGBA8888 override
    this.colorOverride.set(si, ((parseInt(css.slice(1), 16) << 8) | 0xff) >>> 0);
  }
  memory() {
    const W = this.canvas.width, H = this.canvas.height;
    // Estimate: VBO + IBO + default framebuffer (RGBA8 + D24S8) × 4 MSAA samples + resolve.
    return { gpuBuffersBytes: this.verts.byteLength + this.idx.byteLength, framebufferEstimateBytes: W * H * (8 * 4 + 4) };
  }
  loseContext() {
    return new Promise((resolve) => {
      const ext = this.gl.getExtension("WEBGL_lose_context");
      if (!ext) return resolve({ supported: false });
      this.canvas.addEventListener("webglcontextlost", () => {
        const t = performance.now();
        this.restored = () => resolve({ supported: true, restoreMs: this.restoreMs, totalMs: performance.now() - t });
        setTimeout(() => ext.restoreContext(), 0);
      }, { once: true });
      ext.loseContext();
    });
  }
  release() {
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.canvas.remove();
  }
}

export const RENDERERS = { canvas: CanvasRenderer, svgdom: SvgDomRenderer, svgimg: SvgImageRenderer, webgl: WebGLRenderer };
void flattenCubic;
