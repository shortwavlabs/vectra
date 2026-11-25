// sRGB hex ↔ HSV for the owned colour picker (display-side only; the document stores RGBA8888).
export interface Hsv {
  /** 0–360 */ h: number;
  /** 0–100 */ s: number;
  /** 0–100 */ v: number;
}

export const HEX_RE = /^#?([0-9a-f]{6})$/i;

/** `#rrggbb` (case-insensitive, `#` optional) → normalised lowercase `#rrggbb`, or null. */
export function parseHex(text: string): string | null {
  const m = HEX_RE.exec(text.trim());
  return m ? `#${m[1]!.toLowerCase()}` : null;
}

export function hexToHsv(hex: string): Hsv {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const S = s / 100;
  const V = v / 100;
  const f = (k: number) => {
    const t = (k + h / 60) % 6;
    return Math.round((V - V * S * Math.max(0, Math.min(t, 4 - t, 1))) * 255);
  };
  return `#${[f(5), f(3), f(1)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
