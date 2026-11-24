// Image intake: signature sniffing, header dimension checks before decoding, then bounded
// decode to straight RGBA. Signatures, not declared MIME types, decide the format.

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_DIMENSION = 16_384;
export const DEFAULT_MAX_PIXELS = 12_000_000;

export type ImageFormat = "png" | "jpeg" | "webp";

export interface Sniffed {
  format: ImageFormat;
  width: number;
  height: number;
  animated: boolean;
}

export type IntakeErrorCode =
  | "too_large_file"
  | "unsupported_format"
  | "malformed_header"
  | "animated"
  | "too_many_pixels"
  | "decode_failed";

export class IntakeError extends Error {
  override name = "IntakeError";
  readonly code: IntakeErrorCode;
  constructor(code: IntakeErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const u16be = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const u32be = (b: Uint8Array, i: number) => (u16be(b, i) * 65_536 + u16be(b, i + 2)) >>> 0;
const u24le = (b: Uint8Array, i: number) =>
  (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

function sniffPng(b: Uint8Array): Sniffed {
  if (ascii(b, 12, 4) !== "IHDR") throw new IntakeError("malformed_header", "PNG without IHDR");
  let animated = false;
  // Walk chunks until IDAT looking for acTL (APNG), bounded by the buffer.
  for (let i = 8; i + 8 <= b.length;) {
    const len = u32be(b, i);
    const type = ascii(b, i + 4, 4);
    if (type === "acTL") animated = true;
    if (type === "IDAT" || type === "IEND") break;
    i += 12 + len;
  }
  return { format: "png", width: u32be(b, 16), height: u32be(b, 20), animated };
}

function sniffJpeg(b: Uint8Array): Sniffed {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) throw new IntakeError("malformed_header", "JPEG marker expected");
    const marker = b[i + 1] ?? 0;
    if (marker === 0xff) {
      i++;
      continue;
    }
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof)
      return { format: "jpeg", height: u16be(b, i + 5), width: u16be(b, i + 7), animated: false };
    if (marker === 0xd9 || marker === 0xda) break;
    i += 2 + u16be(b, i + 2);
  }
  throw new IntakeError("malformed_header", "JPEG without frame header");
}

function sniffWebp(b: Uint8Array): Sniffed {
  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8X") {
    const flags = b[20] ?? 0;
    return {
      format: "webp",
      width: u24le(b, 24) + 1,
      height: u24le(b, 27) + 1,
      animated: (flags & 0x02) !== 0,
    };
  }
  if (chunk === "VP8L") {
    const bits = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24);
    return {
      format: "webp",
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
      animated: false,
    };
  }
  if (chunk === "VP8 ") {
    // Frame tag (3 bytes) + start code 9d 01 2a, then 14-bit little-endian width and height.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a)
      throw new IntakeError("malformed_header", "VP8 start code missing");
    const le14 = (i: number) => ((b[i] ?? 0) | ((b[i + 1] ?? 0) << 8)) & 0x3fff;
    return { format: "webp", width: le14(26), height: le14(28), animated: false };
  }
  throw new IntakeError("malformed_header", "unknown WebP chunk");
}

/** Identifies the format from magic bytes and reads dimensions from the header. */
export function sniffImage(b: Uint8Array): Sniffed {
  if (b.length < 30) throw new IntakeError("malformed_header", "file too short");
  let s: Sniffed;
  if (
    b[0] === 0x89 &&
    ascii(b, 1, 3) === "PNG" &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  )
    s = sniffPng(b);
  else if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) s = sniffJpeg(b);
  else if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") s = sniffWebp(b);
  else throw new IntakeError("unsupported_format", "only PNG, JPEG and WebP are accepted");
  if (s.animated) throw new IntakeError("animated", "animated images are not supported");
  return s;
}

/** Checked dimension arithmetic: integer, positive, per-side and total-pixel limits. */
export function checkDimensions(width: number, height: number, maxPixels: number): number {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
    throw new IntakeError("malformed_header", `invalid dimensions ${width}x${height}`);
  if (width > MAX_DIMENSION || height > MAX_DIMENSION)
    throw new IntakeError("too_many_pixels", `side longer than ${MAX_DIMENSION} px`);
  const pixels = width * height; // ≤ 2^28, exact in float64
  if (pixels > maxPixels)
    throw new IntakeError(
      "too_many_pixels",
      `${width}×${height} = ${pixels} px exceeds the ${maxPixels} px limit`,
    );
  return pixels;
}

export interface DecodedImage {
  rgba: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
  format: ImageFormat;
  decodeMs: number;
}

/** Validates and decodes a file to straight RGBA8 (sRGB, EXIF orientation applied). */
export async function decodeImage(
  file: Blob,
  maxPixels = DEFAULT_MAX_PIXELS,
): Promise<DecodedImage> {
  if (file.size > MAX_FILE_BYTES)
    throw new IntakeError("too_large_file", `file is larger than ${MAX_FILE_BYTES} bytes`);
  const t0 = performance.now();
  const header = new Uint8Array(
    await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer(),
  );
  const sniffed = sniffImage(header);
  checkDimensions(sniffed.width, sniffed.height, maxPixels);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
      premultiplyAlpha: "none",
      colorSpaceConversion: "default",
    });
  } catch (e) {
    throw new IntakeError("decode_failed", `browser could not decode the image: ${String(e)}`);
  }
  const { width, height } = bitmap;
  try {
    checkDimensions(width, height, maxPixels);
    const canvas: OffscreenCanvas | HTMLCanvasElement =
      typeof OffscreenCanvas === "function"
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement("canvas"), { width, height });
    const ctx = canvas.getContext("2d", { willReadFrequently: true }) as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null;
    if (!ctx) throw new IntakeError("decode_failed", "2D canvas unavailable");
    ctx.drawImage(bitmap, 0, 0);
    const rgba = ctx.getImageData(0, 0, width, height).data as Uint8ClampedArray<ArrayBuffer>;
    canvas.width = 0; // release backing store early
    return { rgba, width, height, format: sniffed.format, decodeMs: performance.now() - t0 };
  } finally {
    bitmap.close();
  }
}
