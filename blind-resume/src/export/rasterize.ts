import { JPEG_QUALITY } from "../config/export";
import type { RenderPlan } from "../core/export-plan";
import { toPixelBox, type PixelBox, type Rect } from "../core/geometry";
import { stripJpegMetadata } from "../core/jpeg";
import { createCanvas, freeCanvas, resetContext } from "../pdf/canvas";
import type { PageModel } from "../pdf/document";
import { RENDER_SETTINGS } from "../pdf/settings";

export interface RasterizedPage {
  readonly jpeg: Uint8Array;
  readonly widthPt: number;
  readonly heightPt: number;
  readonly plan: RenderPlan;
}

export function pixelBoxes(rects: readonly Rect[], plan: RenderPlan): PixelBox[] {
  const limit = { width: plan.widthPx, height: plan.heightPx };
  return rects.map((r) => toPixelBox(r, plan.scale, limit)).filter((b) => b.right > b.left && b.bottom > b.top);
}

function assertPainted(context: CanvasRenderingContext2D, boxes: readonly PixelBox[]): void {
  for (const b of boxes) {
    const data = context.getImageData(b.left, b.top, b.right - b.left, b.bottom - b.top).data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0) {
        throw new Error("黒で塗りつぶせなかった範囲があります。書き出しを中止しました。");
      }
    }
  }
}

export async function rasterizePage(page: PageModel, rects: readonly Rect[], plan: RenderPlan): Promise<RasterizedPage> {
  const { canvas, context } = createCanvas(plan.widthPx, plan.heightPx);
  try {
    const viewport = page.proxy.getViewport({ scale: plan.scale });
    await page.proxy.render({ canvas, canvasContext: context, viewport, ...RENDER_SETTINGS }).promise;
    const boxes = pixelBoxes(rects, plan);
    context.save();
    resetContext(context);
    context.fillStyle = "#000000";
    for (const b of boxes) context.fillRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
    context.restore();
    assertPainted(context, boxes);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) throw new Error("ページを画像にできませんでした。");
    const jpeg = stripJpegMetadata(new Uint8Array(await blob.arrayBuffer()));
    return { jpeg, widthPt: page.width, heightPt: page.height, plan };
  } finally {
    freeCanvas(canvas);
  }
}
