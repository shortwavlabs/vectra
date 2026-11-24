import { describe, expect, test } from "vite-plus/test";
import { checkDimensions, IntakeError, sniffImage } from "../../src/vectorization/intake.ts";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === "string" ? Array.from(p, (c) => c.charCodeAt(0)) : p)),
  );
const be32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const pad = (b: Uint8Array, n = 64) => {
  const out = new Uint8Array(Math.max(n, b.length));
  out.set(b);
  return out;
};
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (w: number, h: number, extra: number[] = []) =>
  pad(
    bytes(
      PNG_SIG,
      be32(13),
      "IHDR",
      be32(w),
      be32(h),
      [8, 6, 0, 0, 0],
      [0, 0, 0, 0],
      extra,
      be32(0),
      "IDAT",
    ),
  );

describe("sniffImage", () => {
  test("reads PNG, JPEG and WebP dimensions from headers", () => {
    expect(sniffImage(png(640, 480))).toEqual({
      format: "png",
      width: 640,
      height: 480,
      animated: false,
    });
    const jpeg = pad(
      bytes(
        [0xff, 0xd8, 0xff, 0xe0, 0, 16],
        new Array(14).fill(0),
        [0xff, 0xc0, 0, 17, 8, 1, 0x2c, 0x02, 0x58],
      ),
    );
    expect(sniffImage(jpeg)).toMatchObject({ format: "jpeg", width: 600, height: 300 });
    const vp8x = pad(
      bytes(
        "RIFF",
        [0, 0, 0, 0],
        "WEBP",
        "VP8X",
        [10, 0, 0, 0],
        [0, 0, 0, 0],
        [0x1f, 0x03, 0],
        [0xdf, 0x01, 0],
      ),
    );
    expect(sniffImage(vp8x)).toMatchObject({ format: "webp", width: 800, height: 480 });
    const vp8l = pad(
      bytes("RIFF", [0, 0, 0, 0], "WEBP", "VP8L", [0, 0, 0, 0], [0x2f], [0x3f, 0x40, 0x1f, 0x00]),
    );
    expect(sniffImage(vp8l)).toMatchObject({ format: "webp", width: 64, height: 126 });
    const vp8 = pad(
      bytes(
        "RIFF",
        [0, 0, 0, 0],
        "WEBP",
        "VP8 ",
        [0, 0, 0, 0],
        [0, 0, 0],
        [0x9d, 0x01, 0x2a],
        [0x40, 0x01, 0xf0, 0x00],
      ),
    );
    expect(sniffImage(vp8)).toMatchObject({ format: "webp", width: 320, height: 240 });
  });

  test("rejects unknown, truncated, malformed and animated inputs", () => {
    const code = (b: Uint8Array) => {
      try {
        sniffImage(b);
        return "ok";
      } catch (e) {
        return (e as IntakeError).code;
      }
    };
    expect(code(pad(bytes("GIF89a")))).toBe("unsupported_format");
    expect(code(pad(bytes("<svg xmlns=")))).toBe("unsupported_format");
    expect(code(bytes(PNG_SIG))).toBe("malformed_header");
    expect(code(pad(bytes([0xff, 0xd8, 0xff, 0x12, 0x34])))).toBe("malformed_header");
    expect(
      code(
        png(10, 10, [
          ...be32(8),
          ..."acTL".split("").map((c) => c.charCodeAt(0)),
          0,
          0,
          0,
          2,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
        ]),
      ),
    ).toBe("animated");
    const animatedWebp = pad(
      bytes(
        "RIFF",
        [0, 0, 0, 0],
        "WEBP",
        "VP8X",
        [10, 0, 0, 0],
        [0x02, 0, 0, 0],
        [9, 0, 0],
        [9, 0, 0],
      ),
    );
    expect(code(animatedWebp)).toBe("animated");
  });
});

describe("checkDimensions", () => {
  test("enforces integer, side and pixel limits with exact arithmetic", () => {
    expect(checkDimensions(4000, 3000, 12_000_000)).toBe(12_000_000);
    for (const [w, h] of [
      [0, 10],
      [10.5, 10],
      [-1, 10],
      [Number.NaN, 1],
    ])
      expect(() => checkDimensions(w!, h!, 1e9)).toThrow(IntakeError);
    expect(() => checkDimensions(16_385, 1, 1e9)).toThrow(/side longer/);
    expect(() => checkDimensions(4001, 3000, 12_000_000)).toThrow(/exceeds/);
    // A PNG header claiming 2^31 px per side is rejected before any decode.
    expect(() => checkDimensions(0x7fffffff, 0x7fffffff, 12_000_000)).toThrow(IntakeError);
  });
});
