export const DPI_OPTIONS = [
  { dpi: 150, label: "150 dpi（ファイルが軽い）" },
  { dpi: 200, label: "200 dpi（標準）" },
  { dpi: 300, label: "300 dpi（細かい文字向け、ファイルが重い）" },
] as const;

export const DEFAULT_DPI = 200;

export const JPEG_QUALITY = 0.9;

export const EXPORT_LIMITS = Object.freeze({
  maxPixels: 40_000_000,
  maxSide: 16_384,
});

export const BLACK_CHECK = Object.freeze({
  inset: 2,
  maxChannel: 96,
  maxMean: 16,
});

export const PREVIEW_WIDTH_PX = 420;
