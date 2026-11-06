import type { Size } from "./geometry";

export interface RenderPlan {
  readonly requestedDpi: number;
  readonly dpi: number;
  readonly scale: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly reduced: boolean;
}

export interface RenderLimits {
  readonly maxPixels: number;
  readonly maxSide: number;
}

function pixelsAt(size: Size, dpi: number): { width: number; height: number } {
  const k = dpi / 72;
  return { width: Math.max(1, Math.ceil(size.width * k - 1e-6)), height: Math.max(1, Math.ceil(size.height * k - 1e-6)) };
}

export function planRender(size: Size, requestedDpi: number, limits: RenderLimits): RenderPlan {
  let dpi = requestedDpi;
  let px = pixelsAt(size, dpi);
  const fits = (p: { width: number; height: number }): boolean =>
    p.width * p.height <= limits.maxPixels && p.width <= limits.maxSide && p.height <= limits.maxSide;
  if (!fits(px)) {
    const byArea = Math.sqrt(limits.maxPixels / (size.width * size.height)) * 72;
    const bySide = Math.min(limits.maxSide / size.width, limits.maxSide / size.height) * 72;
    dpi = Math.max(1, Math.floor(Math.min(byArea, bySide, requestedDpi)));
    px = pixelsAt(size, dpi);
    while (!fits(px) && dpi > 1) {
      dpi -= 1;
      px = pixelsAt(size, dpi);
    }
  }
  return { requestedDpi, dpi, scale: dpi / 72, widthPx: px.width, heightPx: px.height, reduced: dpi < requestedDpi };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function defaultFileName(now: Date): string {
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `blind_resume_${date}_${time}.pdf`;
}

export function sanitizeFileName(input: string, fallback: string): string {
  const cleaned = input
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  const base = cleaned.replace(/\.pdf$/i, "").slice(0, 120).trim();
  return base.length > 0 ? `${base}.pdf` : fallback;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
