import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PRECACHE_PATHS } from "./cachePolicy.js";

function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("install assets", () => {
  it("publishes a standalone manifest and the apple touch icon", () => {
    const manifest = JSON.parse(readFileSync("apps/web/public/manifest.webmanifest", "utf8")) as {
      display: string;
      start_url: string;
      scope: string;
      icons: { src: string; sizes: string }[];
    };
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.icons.map((icon) => icon.src)).toEqual(["/icons/icon-192.png", "/icons/icon-512.png"]);
    const html = readFileSync("apps/web/index.html", "utf8");
    expect(html).toContain('rel="manifest"');
    expect(html).toContain("apple-mobile-web-app-capable");
    expect(html).toContain("apple-touch-icon");
    expect(html).toContain("viewport-fit=cover");
    const offline = readFileSync("apps/web/public/offline.html", "utf8");
    expect(offline).toContain("不会在离线时用旧数据顶替");
    expect(PRECACHE_PATHS).toContain("/offline.html");
  });

  it("ships square png icons at the declared sizes", () => {
    expect(pngSize("apps/web/public/icons/icon-192.png")).toEqual({ width: 192, height: 192 });
    expect(pngSize("apps/web/public/icons/icon-512.png")).toEqual({ width: 512, height: 512 });
    expect(pngSize("apps/web/public/icons/apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
  });
});
