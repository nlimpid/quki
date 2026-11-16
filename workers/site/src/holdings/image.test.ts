import { encode } from "jpeg-js";
import { describe, expect, it } from "vitest";

import { tinyPng } from "./imageFixture.js";
import { decodeImage, IMAGE_MAX_BYTES } from "./image.js";

describe("image decode", () => {
  it("checks a PNG pixel buffer and rejects a header that does not match the pixels", async () => {
    const png = await decodeImage(tinyPng(), "image/png");
    expect(png).toEqual({ mediaType: "image/png", width: 1, height: 1, pixels: 1 });
    await expect(decodeImage(tinyPng(2, 1, 1, 1), "image/png")).rejects.toThrow(/image_pixels/);
    await expect(decodeImage(tinyPng().slice(0, 20), "image/png")).rejects.toThrow(/image_/);
    await expect(decodeImage(tinyPng(), "image/jpeg")).rejects.toThrow(/image_type/);
  });

  it("decodes JPEG pixels and rejects a truncated file", async () => {
    const encoded = encode({ data: new Uint8Array([255, 0, 0, 255]), width: 1, height: 1 }, 50);
    const bytes = new Uint8Array(encoded.data);
    await expect(decodeImage(bytes, "image/jpeg")).resolves.toMatchObject({
      width: 1,
      height: 1,
      pixels: 1,
    });
    await expect(decodeImage(bytes.slice(0, 32), "image/jpeg")).rejects.toThrow(/image_/);
    const huge = new Uint8Array(IMAGE_MAX_BYTES + 1);
    huge.set(bytes.subarray(0, 3), 0);
    await expect(decodeImage(huge, "image/jpeg")).rejects.toThrow(/image_bytes/);
    const oriented = jpegWithOrientation(bytes, 6);
    await expect(decodeImage(oriented, "image/jpeg")).rejects.toThrow(/image_orientation/);
    const upright = jpegWithOrientation(bytes, 1);
    await expect(decodeImage(upright, "image/jpeg")).resolves.toMatchObject({ pixels: 1 });
  });
});

function jpegWithOrientation(jpeg: Uint8Array, orientation: number): Uint8Array {
  const tiff = new Uint8Array(26);
  tiff.set([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08], 0);
  const view = new DataView(tiff.buffer);
  view.setUint16(8, 1);
  view.setUint16(10, 0x0112);
  view.setUint16(12, 3);
  view.setUint32(14, 1);
  view.setUint16(18, orientation);
  const payload = new Uint8Array(6 + tiff.length);
  payload.set(new TextEncoder().encode("Exif\u0000\u0000"), 0);
  payload.set(tiff, 6);
  const app1 = new Uint8Array(4 + payload.length);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1[2] = (payload.length + 2) >> 8;
  app1[3] = (payload.length + 2) & 0xff;
  app1.set(payload, 4);
  const out = new Uint8Array(jpeg.length + app1.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(app1, 2);
  out.set(jpeg.subarray(2), 2 + app1.length);
  return out;
}
