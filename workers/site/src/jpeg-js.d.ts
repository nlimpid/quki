declare module "jpeg-js" {
  export function decode(
    data: Uint8Array,
    options?: {
      useTArray?: boolean;
      tolerantDecoding?: boolean;
      formatAsRGBA?: boolean;
      maxResolutionInMP?: number;
      maxMemoryUsageInMB?: number;
    },
  ): { width: number; height: number; data: Uint8Array };
  export function encode(
    image: { data: Uint8Array; width: number; height: number },
    quality?: number,
  ): { data: Uint8Array };
}
