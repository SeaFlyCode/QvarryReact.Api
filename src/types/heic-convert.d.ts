// src/types/heic-convert.d.ts
// Déclarations TypeScript pour heic-convert

declare module "heic-convert" {
  interface ConvertOptions {
    buffer: Buffer;
    format: "JPEG" | "PNG";
    quality?: number;
  }

  function convert(options: ConvertOptions): Promise<ArrayBuffer>;

  export = convert;
}
