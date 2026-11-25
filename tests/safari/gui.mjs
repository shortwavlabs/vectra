#!/usr/bin/env node
// Real Safari qualification of the G-UI workspace (production build, production CSP):
//   pnpm build && node tests/safari/gui.mjs
// Mirrors tests/browser/ui-shell.spec.ts and the component tests of ui-document.spec.ts with
// W3C WebDriver actions (real key and pointer events). Instrumentation, disclosed: WebDriver has
// no init scripts and no console access, so the served workspace.html gets one same-origin
// classic <script src="/__probe.js"> as the first element of <head> (allowed by script-src
// 'self'; the CSP header is not changed). It records securitypolicyviolation events, errors,
// unhandled rejections and console.error from the start of the load, and defines the
// accessible-name helpers the checks use.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { DIST, ROOT, serve } from "./support.mjs";
import { Safari } from "./webdriver.mjs";

const OUT = join(ROOT, "tests/output/safari");
const FIXTURES = join(ROOT, "tests/fixtures/procedural");
const K = {
  Tab: "",
  Enter: "",
  Escape: "",
  Shift: "",
  Alt: "",
  Meta: "",
  Left: "",
  Up: "",
  Right: "",
  Down: "",
  Space: "",
  F2: "",
};

const PROBE = `(() => {
  const p = (window.__probe = { csp: [], errors: [] });
  document.addEventListener("securitypolicyviolation", (e) =>
    p.csp.push({ directive: e.effectiveDirective, blocked: e.blockedURI, source: e.sourceFile, sample: e.sample }));
  addEventListener("error", (e) =>
    p.errors.push("error: " + (e.message || (e.target && (e.target.src || e.target.href)) || "unknown")), true);
  addEventListener("unhandledrejection", (e) =>
    p.errors.push("unhandledrejection: " + String((e.reason && e.reason.stack) || e.reason)));
  const ce = console.error;
  console.error = function (...a) { p.errors.push("console.error: " + a.map(String).join(" ")); return ce.apply(this, a); };
  const SEL = {
    button: 'button,[role="button"]',
    dialog: '[role="dialog"],[role="alertdialog"]',
    separator: '[role="separator"]',
    slider: '[role="slider"],input[type="range"]',
    textbox: 'input:not([type]),input[type="text"],input[type="search"],textarea,[role="textbox"]',
    radio: '[role="radio"],input[type="radio"]',
    menuitem: '[role="menuitem"]',
    complementary: 'aside,[role="complementary"]',
    navigation: 'nav,[role="navigation"]',
  };
  const name = (el) => {
    const l = el.getAttribute("aria-label");
    if (l) return l.trim();
    const lb = el.getAttribute("aria-labelledby");
    if (lb) return lb.split(/\\s+/).map((id) => (document.getElementById(id) || {}).textContent || "").join(" ").trim();
    if (el.labels && el.labels.length) return [...el.labels].map((x) => x.textContent).join(" ").trim();
    return (el.textContent || "").trim();
  };
  const match = (n, want) => want == null || (typeof want === "string" ? n === want : new RegExp(want.re).test(n));
  const vis = (el) => !!el && el.isConnected &&
    (el.checkVisibility ? el.checkVisibility({ visibilityProperty: true }) : el.getClientRects().length > 0);
  window.__name = name;
  window.__vis = vis;
  window.__role = (role, want, root) => [...(root || document).querySelectorAll(SEL[role])].filter((e) => match(name(e), want));
  window.__one = (role, want) => {
    const r = window.__role(role, want).filter(vis);
    if (r.length !== 1) throw new Error(role + " " + JSON.stringify(want) + ": " + r.length + " visible matches");
    return r[0];
  };
  window.__box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  window.__active = () => { const a = document.activeElement; return a ? { name: name(a), tag: a.tagName, inDialog: !!a.closest('[role="dialog"]'), hasFocus: document.hasFocus() } : null; };
  // Any CSS colour string to 8-bit sRGB through a canvas (independent of how it is serialized).
  window.__srgb = (c) => {
    const x = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    x.fillStyle = "#000"; x.fillStyle = c; x.fillRect(0, 0, 1, 1);
    return [...x.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  };
})();
`;

let commit = process.env.VECTRA_COMMIT ?? "";
try {
  commit ||= execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
} catch {
  commit = "unknown";
}
const report = {
  commit,
  loadavgStart: loadavg(),
  instrumentation:
    'workspace.html is served with <script src="/__probe.js"> first in <head> (same-origin, allowed by the unchanged CSP)',
  scenarios: [],
  findings: [],
  environment: [
    "Neither Safari's 'Press Tab to highlight each item on a webpage' nor macOS keyboard navigation (AppleKeyboardUIMode) is set on this machine, yet plain Tab reaches buttons in the WebDriver session: Safari automation sessions enable full keyboard access, so plain-Tab results do not show stock Safari. Stock Safari reaches buttons with Option-Tab, which every keyboard check here also runs.",
  ],
  notRun: [
    "Reduced-motion emulation (WebDriver has none; the system setting was not changed)",
    "Export download bytes (Safari download prompt; engine output is covered by the Playwright suites and bundle v1)",
    "VoiceOver smoke test",
  ],
};

const site = await serve(DIST);
writeFileSync(join(site.root, "__probe.js"), PROBE);
site.rewrite = (path, body) =>
  path === "/workspace.html"
    ? Buffer.from(String(body).replace("<head>", '<head><script src="/__probe.js"></script>'))
    : body;

let s;
const x = (fn, ...a) => s.exec(fn, ...a);
const until = (fn, label, args = [], timeout = 30_000) =>
  s.waitFor(fn, { label, args, timeout, interval: 50 });

async function keys(...seq) {
  const actions = [];
  for (const k of seq) {
    if (Array.isArray(k)) {
      for (const m of k) actions.push({ type: "keyDown", value: m });
      for (const m of [...k].reverse()) actions.push({ type: "keyUp", value: m });
    } else
      for (const ch of k)
        actions.push({ type: "keyDown", value: ch }, { type: "keyUp", value: ch });
  }
  await s.cmd("POST", "/actions", { actions: [{ type: "key", id: "kbd", actions }] });
}
const mouse = (actions) =>
  s.cmd("POST", "/actions", {
    actions: [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions }],
  });
const move = (px, py, duration = 0) => ({
  type: "pointerMove",
  origin: "viewport",
  x: Math.round(px),
  y: Math.round(py),
  duration,
});
const DOWN = { type: "pointerDown", button: 0 };
const UP = { type: "pointerUp", button: 0 };
const clickAt = (px, py) => mouse([move(px, py), DOWN, UP]);
async function click(role, name) {
  const b = await x((r, n) => __box(__one(r, n)), role, name);
  await clickAt(b.x + b.w / 2, b.y + b.h / 2);
}
const focus = (role, name) => x((r, n) => void __one(r, n).focus(), role, name);
const active = () => x(() => __active());
/** Polls (like Playwright's toBeFocused) until the focused element's name matches `re`. */
const focusedOn = (re) =>
  s
    .waitFor((r) => new RegExp(r).test(__active()?.name ?? ""), {
      args: [re],
      timeout: 5000,
      interval: 50,
    })
    .then(
      () => true,
      () => false,
    );
const attr = (role, name, a) => x((r, n, k) => __one(r, n).getAttribute(k), role, name, a);
const testid = (id) =>
  x((i) => {
    const e = document.querySelector(`[data-testid="${i}"]`);
    return e ? { text: e.textContent, visible: __vis(e) } : null;
  }, id);
const count = (id) => x((i) => document.querySelectorAll(`[data-testid="${i}"]`).length, id);

async function open(query = "") {
  await s.navigate(`${site.origin}/workspace.html${query}`);
  await until(() => {
    const n = window.__role?.("navigation", "Tools").filter(__vis);
    return n?.length === 1;
  }, "the Tools rail");
}
const drain = () => x(() => ({ csp: __probe.csp.splice(0), errors: __probe.errors.splice(0) }));

async function scenario(name, fn) {
  const checks = [];
  const t0 = Date.now();
  const ok = (label, pass, detail) => {
    checks.push({ label, pass: Boolean(pass), ...(detail === undefined ? {} : { detail }) });
    if (!pass) throw new Error(`${label}: ${JSON.stringify(detail)}`);
  };
  const finding = (label, detail) => report.findings.push({ scenario: name, label, detail });
  const before = report.findings.length;
  try {
    await fn(ok, finding);
    const d = await drain();
    ok("no CSP violations or page errors", d.csp.length === 0 && d.errors.length === 0, d);
    const partial = report.findings.length > before;
    report.scenarios.push({
      name,
      result: partial ? "PARTIAL" : "PASS",
      ms: Date.now() - t0,
      checks,
    });
    console.log(`${partial ? "PARTIAL" : "PASS"} ${name}`);
  } catch (e) {
    report.scenarios.push({
      name,
      result: "FAIL",
      ms: Date.now() - t0,
      checks,
      error: String(e.stack ?? e),
    });
    console.log(`FAIL ${name}: ${e.message}`);
  } finally {
    await s.cmd("DELETE", "/actions").catch(() => {});
  }
}

/** Tab and Option-Tab, forwards then backwards: every step must leave focus in the dialog (and in
 * the document, when Safari reports document focus at all). */
async function trapped(n, forwards) {
  const escaped = [];
  const base = (await active())?.hasFocus;
  for (const nav of [[K.Tab], [K.Alt, K.Tab]]) {
    for (let i = 0; i < n; i++) {
      await keys(i < forwards ? nav : [K.Shift, ...nav]);
      await sleep(80);
      const a = await active();
      if (!a?.inDialog || (base && !a.hasFocus))
        escaped.push({ key: nav.length > 1 ? "Option-Tab" : "Tab", i, a });
    }
  }
  return escaped;
}

/** Imports a fixture through the real file input (WebDriver Element Send Keys). */
async function importFixture(file, preset) {
  if (preset) {
    await clickAt(600, 400);
    await keys("t");
    await click("radio", preset);
    await click("button", "Select");
  }
  const el = await s.cmd("POST", "/element", {
    using: "css selector",
    value: '[data-testid="import-input"]',
  });
  await s.cmd("POST", `/element/${Object.values(el)[0]}/value`, {
    text: join(FIXTURES, file),
  });
  await until(
    (f) => document.querySelector('[data-testid="status"]')?.textContent.includes(`Traced ${f}`),
    `Traced ${file}`,
    [file],
    90_000,
  );
  await until(
    () =>
      __vis(document.querySelector('[data-testid="canvas-host"]')) &&
      document.querySelector('[data-testid="canvas-state"]')?.dataset.state === "ready",
    "canvas ready",
  );
}
async function selectOnCanvas() {
  const art = await x(() => __box(document.querySelector('[data-testid="artboard"]')));
  for (const [fx, fy] of [
    [0.7, 0.62],
    [0.55, 0.5],
    [0.3, 0.7],
    [0.8, 0.85],
    [0.2, 0.3],
    [0.5, 0.8],
  ]) {
    await clickAt(art.x + art.w * fx, art.y + art.h * fy);
    await sleep(100);
    const name = await x(
      () => document.querySelector('[data-testid="selection-name"]')?.textContent ?? "",
    );
    if (/^Path \d+$/.test(name)) return;
  }
  throw new Error("no path under any probe point");
}
const order = () =>
  x(() =>
    [...document.querySelectorAll('[data-testid="layer-row"]')]
      .filter((r) => r.closest("ul")?.getAttribute("aria-label") === "Layers")
      .map((r) => r.querySelector("button[aria-pressed] span").textContent),
  );

// WCAG 2.x relative luminance and contrast ratio.
const lum = (rgb) => {
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [p, q] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (p + 0.05) / (q + 0.05);
};

try {
  s = await Safari.open();
  report.safari = {
    version: s.capabilities.browserVersion,
    platform:
      `${s.capabilities.platformName} ${s.capabilities["safari:platformVersion"] ?? ""}`.trim(),
  };
  await s.setWindowRect(1440, 1000);

  await scenario(
    "CSP: the shell loads clean; the detector fires on an injected <style>",
    async (ok) => {
      const res = await fetch(`${site.origin}/workspace.html`);
      report.servedCsp = res.headers.get("content-security-policy");
      await open();
      await sleep(500);
      const load = await drain();
      ok(
        "no violations or errors during the load",
        load.csp.length === 0 && load.errors.length === 0,
        load,
      );
      ok("probe loaded first", await x(() => Array.isArray(window.__probe?.csp)));
      ok(
        "no inline <style> elements",
        (await x(() => document.querySelectorAll("style").length)) === 0,
      );
      ok(
        "Base UI ScrollArea is on screen",
        await x(() => document.querySelector(".base-ui-disable-scrollbar") !== null),
      );
      // Negative control: an injected inline <style> must be blocked and reported.
      await x(() => {
        const st = document.createElement("style");
        st.textContent = "b{color:red}";
        document.head.append(st);
      });
      await until(() => __probe.csp.length > 0, "a violation for the injected <style>");
      const ctl = await drain();
      ok(
        "the injected <style> is reported as style-src",
        /^style-src/.test(ctl.csp[0].directive),
        ctl.csp,
      );
      await x(() => document.querySelectorAll("style").forEach((e) => e.remove()));
    },
  );

  await scenario(
    "positive control: without CSPProvider, Base UI's inline <style> is blocked",
    async (ok) => {
      await open("?csp=default");
      await sleep(500);
      const d = await drain();
      ok("violations reported", d.csp.length > 0, d);
      ok(
        "all are style-src",
        d.csp.every((v) => /^style-src/.test(v.directive)),
        d.csp,
      );
      report.positiveControl = d;
    },
  );

  await scenario(
    "tool rail: names, pressed state, unavailable tools, keyboard and tooltips",
    async (ok) => {
      await open();
      const names = await x(() =>
        [...__one("navigation", "Tools").querySelectorAll("button")].map((b) =>
          b.getAttribute("aria-label"),
        ),
      );
      ok(
        "names",
        JSON.stringify(names) ===
          JSON.stringify([
            "Select",
            "Trace",
            "Smooth, not available yet",
            "Simplify, not available yet",
            "Cleanup, not available yet",
            "Recolor",
          ]),
        names,
      );
      ok("Select pressed", (await attr("button", "Select", "aria-pressed")) === "true");
      for (const n of ["Smooth", "Simplify", "Cleanup"]) {
        const nm = `${n}, not available yet`;
        ok(`${n} aria-disabled`, (await attr("button", nm, "aria-disabled")) === "true");
        ok(`${n} not pressed`, (await attr("button", nm, "aria-pressed")) === null);
      }
      ok("Recolor shortcut", (await attr("button", "Recolor", "aria-keyshortcuts")) === "R");
      // Keyboard: plain Tab (what this automation session does) and Option-Tab (stock Safari's
      // every-item key), each from a fresh page.
      const tip = () =>
        x(
          () =>
            document.querySelector('[data-slot="tooltip-content"][data-open]')?.textContent ?? null,
        );
      for (const { label, nav } of [
        { label: "Tab", nav: [K.Tab] },
        { label: "Option-Tab", nav: [K.Alt, K.Tab] },
      ]) {
        await open();
        await focus("button", "Select");
        await keys(nav);
        await sleep(150);
        if (label === "Tab") report.plainTabFromSelect = await active();
        ok(`${label}: focus on Trace`, (await active())?.name === "Trace", await active());
        await until(
          () => document.querySelector('[data-slot="tooltip-content"][data-open]'),
          "tooltip on focus",
        );
        ok(`${label}: tooltip names Trace`, (await tip())?.includes("Trace"), await tip());
        await keys(K.Enter);
        ok(
          `${label}: Enter selects Trace`,
          (await attr("button", "Trace", "aria-pressed")) === "true",
        );
        await keys(nav);
        await sleep(300);
        ok(
          `${label}: tooltip explains Smooth`,
          (await tip())?.includes("Smooth, not available yet"),
          await tip(),
        );
        await keys(K.Enter);
        ok(
          `${label}: the unavailable tool does nothing`,
          (await attr("button", "Trace", "aria-pressed")) === "true",
        );
      }
    },
  );

  await scenario(
    "shortcuts dialog: key and button, focus trap, inert shortcuts, focus return",
    async (ok) => {
      await open();
      await clickAt(600, 400);
      await keys([K.Shift, "?"]);
      await until(
        () => __role("dialog", "Keyboard shortcuts").filter(__vis).length === 1,
        "dialog by key",
      );
      await keys(K.Escape);
      await until(
        () => __role("dialog", "Keyboard shortcuts").filter(__vis).length === 0,
        "dialog closed",
      );
      await focus("button", "Keyboard shortcuts");
      await keys(K.Enter);
      await until(
        () => __role("dialog", "Keyboard shortcuts").filter(__vis).length === 1,
        "dialog by button",
      );
      await until(() => __active()?.inDialog, "initial focus inside the dialog");
      const escaped = await trapped(6, 3);
      ok(
        "focus stays in the dialog (Tab and Option-Tab, both directions)",
        escaped.length === 0,
        escaped,
      );
      await keys("r");
      ok(
        "global shortcut inert inside the dialog",
        (await attr("button", "Select", "aria-pressed")) === "true",
      );
      await keys(K.Escape);
      await until(
        () => __role("dialog", "Keyboard shortcuts").filter(__vis).length === 0,
        "dialog closed",
      );
      ok("focus returns to the trigger", await focusedOn("^Keyboard shortcuts$"), await active());
    },
  );

  await scenario("global shortcuts: fire on the page, not in form controls", async (ok) => {
    await open();
    await clickAt(600, 400);
    await keys("t");
    ok("t selects Trace", (await attr("button", "Trace", "aria-pressed")) === "true");
    await focus("radio", "Full Colour");
    await keys("r");
    ok("ignored in the radio group", (await attr("button", "Trace", "aria-pressed")) === "true");
    await clickAt(600, 400);
    await keys("r");
    ok("r selects Recolor", (await attr("button", "Recolor", "aria-pressed")) === "true");
    await keys("v");
    ok("v selects Select", (await attr("button", "Select", "aria-pressed")) === "true");
  });

  await scenario("resizable panels: keyboard and pointer, inspector 288–336 px", async (ok) => {
    await open();
    const side = () => x(() => __box(__one("complementary", "Inspector")));
    const w0 = (await side()).w;
    await focus("separator", "Resize inspector");
    for (let i = 0; i < 4; i++) await keys(K.Right);
    const wk = (await side()).w;
    ok("keyboard narrows within bounds", wk < w0 && wk >= 287.5, { w0, wk });
    const hb = await x(() => __box(__one("separator", "Resize inspector")));
    const cx = hb.x + hb.w / 2;
    const cy = hb.y + hb.h / 2;
    await mouse([
      move(cx, cy),
      DOWN,
      ...Array.from({ length: 8 }, (_, i) => move(cx - (i + 1) * 10, cy + 40, 16)),
      UP,
    ]);
    const wp = (await side()).w;
    ok("pointer widens within bounds", wp > wk && wp <= 336.5, { wk, wp });
    const h0 = (await side()).h;
    await focus("separator", "Resize layers");
    for (let i = 0; i < 4; i++) await keys(K.Down);
    ok("layers separator resizes", (await side()).h > h0);
    report.inspectorWidths = { initial: w0, keyboard: wk, pointer: wp };
  });

  await scenario("tokens: contrast from the running build; dual focus ring", async (ok) => {
    await open();
    const t = await x(() => {
      const names = [
        "background",
        "panel",
        "elevated",
        "canvas-surround",
        "paper",
        "foreground",
        "muted-foreground",
        "border",
        "control-border",
        "primary",
        "primary-foreground",
        "destructive",
        "warning",
      ];
      const probe = document.createElement("i");
      document.body.append(probe);
      const out = {};
      for (const n of names) {
        probe.style.color = `var(--${n})`;
        const c = getComputedStyle(probe).color;
        out[n] = { computed: c, srgb: __srgb(c) };
      }
      probe.remove();
      return out;
    });
    const rgb = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.srgb]));
    const rows = [];
    const add = (fg, bg, need) => {
      const r = Math.round(ratio(rgb[fg], rgb[bg]) * 100) / 100;
      rows.push({ pair: `${fg} on ${bg}`, ratio: r, need, pass: r >= need });
    };
    for (const sfc of ["background", "panel", "elevated", "canvas-surround"]) {
      for (const f of ["foreground", "muted-foreground", "primary", "destructive", "warning"])
        add(f, sfc, 4.5);
      add("control-border", sfc, 3);
      add("primary", sfc, 3);
    }
    add("primary-foreground", "primary", 4.5);
    add("background", "paper", 3);
    add("background", "primary", 3);
    report.tokens = t;
    report.contrast = rows;
    ok(
      "every pair meets its threshold",
      rows.every((r) => r.pass),
      rows.filter((r) => !r.pass),
    );
    // The ring as rendered on a keyboard-focused button (Option-Tab: Safari's every-item key).
    await focus("button", "Select");
    await keys([K.Alt, K.Tab]);
    await sleep(400);
    const ring = await x(() => {
      const cs = getComputedStyle(document.activeElement);
      const colours = (cs.boxShadow.match(/(rgba?|oklch|oklab|lab|lch|color)\([^)]*\)/g) ?? []).map(
        __srgb,
      );
      return {
        name: __name(document.activeElement),
        focusVisible: document.activeElement.matches(":focus-visible"),
        outline: `${cs.outlineStyle} ${cs.outlineWidth}`,
        outlineColour: cs.outlineColor,
        outlineSrgb: __srgb(cs.outlineColor),
        offset: cs.outlineOffset,
        shadow: cs.boxShadow,
        shadowSrgb: colours,
      };
    });
    report.focusRing = ring;
    ok("focus-visible", ring.focusVisible, ring);
    ok(
      "solid 2px lime outline",
      ring.outline === "solid 2px" && ring.outlineSrgb.join() === "185,232,123",
      ring,
    );
    ok("2px offset", ring.offset === "2px", ring);
    ok(
      "dark inner ring",
      ring.shadowSrgb.some((c) => c.join() === "25,26,28"),
      ring,
    );
  });

  await scenario("import: file input, local trace, same-origin requests only", async (ok) => {
    await open();
    await importFixture("adjacent_colors.png");
    ok("one layer", (await count("layer-row")) === 1);
    ok("title", (await testid("document-title"))?.text.includes("Untitled artwork · Edited"));
    ok("complexity", (await testid("complexity"))?.text.includes("paths"));
    const foreign = await x(() =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((u) => !u.startsWith(location.origin) && !/^(blob|data):/.test(u)),
    );
    ok("no off-origin requests", foreign.length === 0, foreign);
  });

  await scenario("slider (Scale): keyboard steps coalesce into one undo entry", async (ok) => {
    await open();
    await importFixture("adjacent_colors.png");
    const v = () => attr("slider", "Scale", "aria-valuenow");
    ok("value 100", (await v()) === "100");
    ok(
      "range",
      (await attr("slider", "Scale", "min")) === "10" &&
        (await attr("slider", "Scale", "max")) === "400",
    );
    ok("one slider", (await x(() => __role("slider").filter(__vis).length)) === 1);
    await focus("slider", "Scale");
    for (let i = 0; i < 5; i++) await keys(K.Right);
    ok("105 after five steps", (await v()) === "105", await v());
    await click("button", "Undo");
    ok("one undo restores 100", (await v()) === "100", await v());
    ok("trace still there", (await count("layer-row")) === 1);
    await click("button", "Redo");
    ok("redo 105", (await v()) === "105");
  });

  await scenario(
    "numeric field: Enter commits, Escape reverts, arrow steps coalesce",
    async (ok) => {
      await open();
      await importFixture("adjacent_colors.png");
      const val = () => x(() => __one("textbox", "X (px)").value);
      const x0 = Number(await val());
      const fill = async (text) => {
        await x(() => {
          const e = __one("textbox", "X (px)");
          e.focus();
          e.select();
        });
        await keys(text);
      };
      await fill(String(x0 + 20));
      await keys(K.Enter);
      ok("Enter commits", (await val()) === String(x0 + 20), await val());
      await fill("999");
      await keys(K.Escape);
      ok("Escape reverts", (await val()) === String(x0 + 20), await val());
      for (let i = 0; i < 3; i++) await keys(K.Up);
      ok("arrows step", (await val()) === String(x0 + 23), await val());
      await click("button", "Undo");
      ok("one undo for the arrow steps", (await val()) === String(x0 + 20), await val());
      await click("button", "Undo");
      ok("undo the Enter commit", (await val()) === String(x0), await val());
    },
  );

  await scenario(
    "colour picker: keyboard area, hue, hex draft, Apply once, Escape cancels",
    async (ok) => {
      await open();
      await importFixture("adjacent_colors.png", "Limited Palette");
      await selectOnCanvas();
      const trig = { re: "^Fill colour: #" };
      const hexOf = async () => /#[0-9a-f]{6}/.exec(await attr("button", trig, "aria-label"))[0];
      const original = await hexOf();
      await focus("button", trig);
      await keys(K.Enter);
      await until(() => __active()?.name === "Saturation and brightness", "area focused on open");
      const t0 = await attr("slider", "Saturation and brightness", "aria-valuetext");
      await keys(K.Left, K.Down);
      ok(
        "area moves by keyboard",
        (await attr("slider", "Saturation and brightness", "aria-valuetext")) !== t0,
      );
      await focus("slider", "Hue");
      const h0 = Number(await attr("slider", "Hue", "aria-valuenow"));
      await keys(K.Right);
      ok("hue steps", Number(await attr("slider", "Hue", "aria-valuenow")) === (h0 + 1) % 360);
      await focus("textbox", "Hex");
      await keys([K.Meta, "a"]);
      const typed = [];
      for (const ch of "#3366cc") {
        await keys(ch);
        typed.push(await x(() => __one("textbox", "Hex").value));
      }
      ok("hex draft kept key by key", typed.join() === "#,#3,#33,#336,#3366,#3366c,#3366cc", typed);
      await keys(K.Enter);
      ok("draft colour", (await testid("color-draft"))?.text === "#3366cc");
      await click("button", "Apply");
      await until((r) => __one("button", { re: r }), "applied", ["^Fill colour: #3366cc\\."]);
      ok("focus back on the trigger", await focusedOn("^Fill colour: #3366cc"), await active());
      await click("button", "Undo");
      ok("one undo restores", (await hexOf()) === original);
      await click("button", "Redo");
      ok("redo", (await hexOf()) === "#3366cc");
      await click("button", trig);
      await until(() => __role("textbox", "Hex").filter(__vis).length === 1, "picker open");
      await x(() => {
        const e = __one("textbox", "Hex");
        e.focus();
        e.select();
      });
      await keys("#ff0000", K.Enter, K.Escape);
      await until(
        () => __role("slider", "Saturation and brightness").filter(__vis).length === 0,
        "picker closed",
      );
      ok("Escape cancels", (await hexOf()) === "#3366cc");
      ok(
        "focus back on the trigger after Escape",
        await focusedOn("^Fill colour:"),
        await active(),
      );
    },
  );

  await scenario(
    "layers: visibility, lock, rename, keyboard reorder with live region",
    async (ok) => {
      await open();
      await importFixture("adjacent_colors.png");
      await importFixture("nested_rings.png");
      ok("order", (await order()).join() === "nested_rings,adjacent_colors", await order());
      await click("button", "Hide nested_rings");
      await until(() => __role("button", "Show nested_rings").length === 1, "hidden");
      await click("button", "Undo");
      await until(() => __role("button", "Hide nested_rings").length === 1, "visible again");
      await click("button", "Lock nested_rings");
      ok(
        "locked: reorder disabled",
        await x(() => __one("button", "Reorder nested_rings").disabled),
      );
      await click("button", "More actions for nested_rings");
      await until(() => __role("menuitem", "Rename").filter(__vis).length === 1, "menu open");
      const dis = await x(() =>
        ["Rename", "Move up", "Move down", "Duplicate", "Delete"].map(
          (n) => __one("menuitem", n).getAttribute("aria-disabled") === "true",
        ),
      );
      ok("menu items disabled while locked", dis.every(Boolean), dis);
      await keys(K.Escape);
      await click("button", "Unlock nested_rings");
      const nameBtn = () =>
        x(() => {
          const row = [...document.querySelectorAll('[data-testid="layer-row"]')].find(
            (r) => r.querySelector("button[aria-pressed] span")?.textContent === "adjacent_colors",
          );
          row.querySelector("button[aria-pressed]").focus();
        });
      await nameBtn();
      await keys(K.F2, "x", K.Escape);
      ok(
        "Escape cancels rename",
        (await order()).join() === "nested_rings,adjacent_colors",
        await order(),
      );
      await nameBtn();
      await keys(K.F2, [K.Meta, "a"], "Colours", K.Enter);
      await until(() => document.body.textContent.includes("Colours"), "renamed");
      ok("Enter commits rename", (await order()).join() === "nested_rings,Colours", await order());
      await click("button", "Undo");
      ok("undo rename", (await order()).join() === "nested_rings,adjacent_colors", await order());
      await focus("button", "Reorder nested_rings");
      await keys(K.Space);
      await sleep(150);
      await keys(K.Down);
      await sleep(150);
      await keys(K.Space);
      await until(
        () =>
          [...document.querySelectorAll('[data-testid="layer-row"]')]
            .filter((r) => r.closest("ul")?.getAttribute("aria-label") === "Layers")
            .map((r) => r.querySelector("button[aria-pressed] span").textContent)
            .join() === "adjacent_colors,nested_rings",
        "keyboard reorder",
      );
      const live = await x(() =>
        [...document.querySelectorAll('[aria-live="assertive"]')]
          .map((e) => e.textContent)
          .join(" "),
      );
      ok(
        "live region announces the drop",
        live.includes("nested_rings dropped at position 2 of 2"),
        live,
      );
      await click("button", "Undo");
      ok(
        "one undo for the reorder",
        (await order()).join() === "nested_rings,adjacent_colors",
        await order(),
      );
    },
  );

  await scenario("export dialog: keyboard open, focus trap, Escape returns focus", async (ok) => {
    await open();
    await importFixture("nested_rings.png");
    await focus("button", "Export");
    await keys(K.Enter);
    await until(
      () => __role("dialog", "Export artwork").filter(__vis).length === 1,
      "export dialog",
    );
    await until(() => __active()?.inDialog, "focus inside");
    const escaped = await trapped(8, 5);
    ok("focus stays in the dialog", escaped.length === 0, escaped);
    await keys(K.Escape);
    await until(() => __role("dialog", "Export artwork").filter(__vis).length === 0, "closed");
    ok("focus returns to Export", await focusedOn("^Export$"), await active());
  });

  await scenario("reduced motion and colour scheme as Safari reports them", async (ok) => {
    await open();
    const m = await x(() => ({
      reduce: matchMedia("(prefers-reduced-motion: reduce)").matches,
      dark: matchMedia("(prefers-color-scheme: dark)").matches,
      transition: getComputedStyle(__one("button", "Select")).transitionDuration,
    }));
    report.media = m;
    ok(
      "transitions present when reduced motion is off",
      m.reduce || parseFloat(m.transition) > 0.05,
      m,
    );
  });

  // Screenshots at desktop and laptop window sizes (kept in tests/output, not committed).
  for (const [w, h] of [
    [1920, 1080],
    [1366, 768],
  ]) {
    await s.setWindowRect(w, h);
    await open();
    await importFixture("nested_rings.png");
    // A WebDriver capture taken as the DOM turns ready can show an earlier frame (measured at
    // G-UI), so settle before capturing; screenshot timing is never used as evidence.
    await s.execAsync(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    await sleep(1500);
    const vp = await x(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }));
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `gui-${w}.png`), await s.screenshot());
    (report.screenshots ??= []).push({
      window: [w, h],
      viewport: vp,
      file: `tests/output/safari/gui-${w}.png`,
    });
    await drain();
  }
} catch (e) {
  report.scenarios.push({ name: "harness ran", result: "FAIL", error: String(e.stack ?? e) });
  console.log(`FAIL harness: ${e.stack ?? e}`);
} finally {
  await s?.quit().catch(() => {});
  site.close();
}
report.loadavgEnd = loadavg();
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "gui.json"), JSON.stringify(report, null, 2));
const by = (r) => report.scenarios.filter((x) => x.result === r).length;
console.log(
  `PASS ${by("PASS")} PARTIAL ${by("PARTIAL")} FAIL ${by("FAIL")} of ${report.scenarios.length} (Safari ${report.safari?.version}); findings ${report.findings.length}`,
);
process.exitCode = by("FAIL") ? 1 : 0;
