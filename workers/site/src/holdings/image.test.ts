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
  });
});
