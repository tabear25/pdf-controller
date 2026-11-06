export const APP_TITLE = "ブラインドレジュメ作成ツール";

export const CSS_PX_PER_PT = 96 / 72;

export const ZOOM_LIMITS = Object.freeze({ min: 0.25, max: 4 });

export const FIT_WIDTH_MAX_SCALE = 1.6 * CSS_PX_PER_PT;

export const DISPLAY_MAX_CANVAS_PIXELS = 16_777_216;

export const LAZY_RENDER_MARGIN_PX = 1200;

export const MAX_FILE_BYTES = 300 * 1024 * 1024;

export const ZOOM_STEPS: readonly number[] = [25, 50, 75, 100, 125, 150, 200, 300, 400];
