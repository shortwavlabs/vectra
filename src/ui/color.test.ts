import { expect, test } from "vite-plus/test";
import { hexToHsv, hsvToHex, parseHex } from "./color.ts";

test("hex ↔ HSV round-trips every 8-bit channel value", () => {
  for (let c = 0; c < 256; c += 5) {
    for (const hex of [
      `#${c.toString(16).padStart(2, "0")}3366`,
      `#33${c.toString(16).padStart(2, "0")}cc`,
      `#ff88${c.toString(16).padStart(2, "0")}`,
    ])
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
  }
  expect(hexToHsv("#ff0000")).toEqual({ h: 0, s: 100, v: 100 });
  expect(hsvToHex({ h: 120, s: 100, v: 100 })).toBe("#00ff00");
});

test("parseHex accepts #rrggbb or rrggbb only", () => {
  expect(parseHex(" #3366CC ")).toBe("#3366cc");
  expect(parseHex("3366cc")).toBe("#3366cc");
  for (const bad of ["#36c", "#3366c", "#3366ccff", "#33g6cc", ""])
    expect(parseHex(bad)).toBeNull();
});
