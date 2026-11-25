// Minimal W3C WebDriver client for real Safari (safaridriver), with no dependencies.
// Real Safari is driven only by this harness; Playwright WebKit is not Safari.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

export class Safari {
  /** Starts safaridriver on `port` (or reuses one already listening) and opens a session. */
  static async open({ port = 4444 } = {}) {
    const base = `http://127.0.0.1:${port}`;
    let driver = null;
    const alive = () =>
      fetch(`${base}/status`).then(
        (r) => r.ok,
        () => false,
      );
    if (!(await alive())) {
      driver = spawn("safaridriver", ["--port", String(port)], { stdio: "ignore" });
      for (let i = 0; i < 50 && !(await alive()); i++) await sleep(100);
    }
    const s = new Safari(base, driver);
    const r = await s.#raw("POST", "/session", {
      capabilities: { alwaysMatch: { browserName: "safari" } },
    });
    s.id = r.sessionId;
    s.capabilities = r.capabilities;
    await s.cmd("POST", "/timeouts", { script: 300_000, pageLoad: 120_000, implicit: 0 });
    return s;
  }

  constructor(base, driver) {
    this.base = base;
    this.driver = driver;
    this.id = null;
  }

  async #raw(method, path, body) {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json();
    if (json.value && json.value.error)
      throw new Error(`WebDriver ${method} ${path}: ${json.value.error}: ${json.value.message}`);
    return json.value;
  }
  cmd(method, path, body) {
    return this.#raw(method, `/session/${this.id}${path}`, body);
  }

  navigate(url) {
    return this.cmd("POST", "/url", { url });
  }
  /** Runs `fn(...args)` in the page (a function's source, not a string of statements). */
  exec(fn, ...args) {
    return this.cmd("POST", "/execute/sync", {
      script: `return (${fn}).apply(null, arguments)`,
      args,
    });
  }
  /** Runs an async `fn(...args)` in the page and returns its resolved value. */
  async execAsync(fn, ...args) {
    const v = await this.cmd("POST", "/execute/async", {
      script: `const done = arguments[arguments.length - 1];
        Promise.resolve().then(() => (${fn}).apply(null, Array.prototype.slice.call(arguments, 0, -1)))
          .then((v) => done({ ok: v }), (e) => done({ error: String(e && e.stack || e) }));`,
      args,
    });
    if (v && "error" in v) throw new Error(`page: ${v.error}`);
    return v?.ok;
  }
  /** Polls `fn(...args)` in the page until it returns a truthy value. */
  async waitFor(fn, { timeout = 60_000, interval = 100, args = [], label = "condition" } = {}) {
    const t0 = Date.now();
    let last;
    while (Date.now() - t0 < timeout) {
      try {
        last = await this.exec(fn, ...args);
        if (last) return last;
      } catch (e) {
        last = String(e); // e.g. during a navigation
      }
      await sleep(interval);
    }
    throw new Error(`timed out waiting for ${label} (last: ${JSON.stringify(last)})`);
  }
  newTab() {
    return this.cmd("POST", "/window/new", { type: "tab" }).then((v) => v.handle);
  }
  handles() {
    return this.cmd("GET", "/window/handles");
  }
  switchTo(handle) {
    return this.cmd("POST", "/window", { handle });
  }
  closeWindow() {
    return this.cmd("DELETE", "/window");
  }
  setWindowRect(width, height) {
    return this.cmd("POST", "/window/rect", { width, height });
  }
  async screenshot() {
    return Buffer.from(await this.cmd("GET", "/screenshot"), "base64");
  }
  async quit() {
    try {
      if (this.id) await this.#raw("DELETE", `/session/${this.id}`);
    } finally {
      this.driver?.kill();
    }
  }
}
