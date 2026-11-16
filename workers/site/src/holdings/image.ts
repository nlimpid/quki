import { decode as decodeJpeg } from "jpeg-js";

/** Below the zone upload cap (100 MB on Free/Pro) and the 128 MB Worker memory cap. */
export const IMAGE_MAX_BYTES = 1_500_000;
export const IMAGE_MAX_EDGE = 4_096;
export const IMAGE_MAX_PIXELS = 2_000_000;

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export type DecodedImage = {
  mediaType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  pixels: number;
};

export async function decodeImage(bytes: Uint8Array, declaredType: string): Promise<DecodedImage> {
  if (bytes.byteLength === 0 || bytes.byteLength > IMAGE_MAX_BYTES) throw new Error("image_bytes");
  if (isPng(bytes)) {
    if (declaredType !== "image/png") throw new Error("image_type");
    return decodePng(bytes);
  }
  if (isJpeg(bytes)) {
    if (declaredType !== "image/jpeg") throw new Error("image_type");
    return decodeJpegPixels(bytes);
  }
  throw new Error("image_type");
}

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

async function decodePng(bytes: Uint8Array): Promise<DecodedImage> {
  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = -1;
  const idat: Uint8Array[] = [];
  let sawIend = false;
  let sawPlte = false;
  while (offset + 8 <= bytes.byteLength) {
    const length = readUint32(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (length < 0 || dataEnd + 4 > bytes.byteLength) throw new Error("image_truncated");
    const chunk = bytes.subarray(dataStart, dataEnd);
    const expected = crc32(bytes.subarray(offset + 4, dataEnd));
    const actual = readUint32(bytes, dataEnd);
    if (expected !== actual) throw new Error("image_crc");
    if (type === "IHDR") {
      if (length !== 13) throw new Error("image_header");
      width = readUint32(chunk, 0);
      height = readUint32(chunk, 4);
      bitDepth = chunk[8] ?? 0;
      colorType = chunk[9] ?? -1;
      interlace = chunk[12] ?? -1;
      if (chunk[10] !== 0 || chunk[11] !== 0) throw new Error("image_header");
    } else if (type === "IDAT") {
      idat.push(chunk);
    } else if (type === "PLTE") {
      sawPlte = true;
    } else if (type === "eXIf") {
      const orientation = tiffOrientation(chunk);
      if (orientation == null || orientation !== 1) throw new Error("image_orientation");
    } else if (type === "IEND") {
      sawIend = true;
    } else if (type.charCodeAt(0) >= 65 && type.charCodeAt(0) <= 90) {
      throw new Error("image_header");
    }
    offset = dataEnd + 4;
    if (sawIend) break;
  }
  if (!sawIend || width < 1 || height < 1) throw new Error("image_header");
  if (bitDepth !== 8 || interlace !== 0) throw new Error("image_unsupported");
  const samples = samplesFor(colorType);
  if (samples == null) throw new Error("image_unsupported");
  if (colorType === 3 && !sawPlte) throw new Error("image_header");
  assertBounds(width, height);
  const rowBytes = width * samples;
  const expectedBytes = height * (1 + rowBytes);
  if (expectedBytes > IMAGE_MAX_PIXELS * 5) throw new Error("image_pixels");
  const inflated = await inflateLimited(concat(idat), expectedBytes);
  if (inflated.byteLength !== expectedBytes) throw new Error("image_pixels");
  for (let row = 0; row < height; row += 1) {
    const filter = inflated[row * (1 + rowBytes)] ?? 255;
    if (filter > 4) throw new Error("image_pixels");
  }
  return { mediaType: "image/png", width, height, pixels: width * height };
}

function decodeJpegPixels(bytes: Uint8Array): DecodedImage {
  const orientation = jpegExifOrientation(bytes);
  if (orientation === "unsupported" || orientation === "unreadable") {
    throw new Error("image_orientation");
  }
  try {
    const decoded = decodeJpeg(bytes, {
      useTArray: true,
      tolerantDecoding: false,
      formatAsRGBA: true,
      maxResolutionInMP: IMAGE_MAX_PIXELS / 1_000_000,
      maxMemoryUsageInMB: 24,
    });
    assertBounds(decoded.width, decoded.height);
    const pixels = decoded.width * decoded.height;
    if (decoded.data.byteLength !== pixels * 4) throw new Error("image_pixels");
    return { mediaType: "image/jpeg", width: decoded.width, height: decoded.height, pixels };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("image_")) throw error;
    throw new Error("image_pixels", { cause: error });
  }
}

function assertBounds(width: number, height: number): void {
  if (width < 1 || height < 1 || width > IMAGE_MAX_EDGE || height > IMAGE_MAX_EDGE) {
    throw new Error("image_pixels");
  }
  if (width * height > IMAGE_MAX_PIXELS) throw new Error("image_pixels");
}

function jpegExifOrientation(bytes: Uint8Array): "missing" | "ok" | "unsupported" | "unreadable" {
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) return "missing";
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xda || marker === 0xd9) return "missing";
    const size = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    if (size < 2 || offset + 2 + size > bytes.length) return "unreadable";
    if (marker === 0xe1 && size >= 8) {
      const header = ascii(bytes, offset + 4, 6);
      if (header === "Exif\u0000\u0000") {
        const orientation = tiffOrientation(bytes.subarray(offset + 10, offset + 2 + size));
        if (orientation == null) return "unreadable";
        return orientation === 1 ? "ok" : "unsupported";
      }
    }
    offset += 2 + size;
  }
  return "missing";
}

function tiffOrientation(tiff: Uint8Array): number | null {
  if (tiff.length < 8) return null;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!little && !big) return null;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const read16 = (offset: number) => view.getUint16(offset, little);
  const read32 = (offset: number) => view.getUint32(offset, little);
  if (read16(2) !== 0x2a) return null;
  let offset = read32(4);
  if (offset < 0 || offset + 2 > tiff.length) return null;
  const count = read16(offset);
  offset += 2;
  for (let index = 0; index < count; index += 1) {
    const entry = offset + index * 12;
    if (entry + 12 > tiff.length) return null;
    if (read16(entry) === 0x0112 && read16(entry + 2) === 3) return read16(entry + 8);
  }
  return 1;
}

function samplesFor(colorType: number): number | null {
  if (colorType === 0 || colorType === 3) return 1;
  if (colorType === 2) return 3;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  return null;
}

async function inflateLimited(data: Uint8Array, expectedBytes: number): Promise<Uint8Array> {
  const stream = new Blob([Uint8Array.from(data)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > expectedBytes) {
      await reader.cancel();
      throw new Error("image_pixels");
    }
    parts.push(step.value);
  }
  return concat(parts);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let text = "";
  for (let index = 0; index < length; index += 1)
    text += String.fromCharCode(bytes[offset + index] ?? 0);
  return text;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
