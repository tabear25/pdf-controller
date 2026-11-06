import { BLACK_CHECK } from "../config/export";
import type { RenderPlan } from "../core/export-plan";
import { sameSize, type Rect, type Size } from "../core/geometry";
import { checkBox, inspectBlack } from "../core/pixels";
import { createCanvas, freeCanvas } from "../pdf/canvas";
import { openPdf, type OpenedPdf } from "../pdf/document";
import { RENDER_SETTINGS } from "../pdf/settings";
import { pixelBoxes } from "./rasterize";
import { inspectStructure } from "./structure";

export type CheckId = "structure" | "pages" | "sizes" | "text" | "annotations" | "attachments" | "outline" | "scripts" | "info" | "black";

export interface CheckResult {
  readonly id: CheckId;
  readonly label: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface VerifyInput {
  readonly bytes: Uint8Array;
  readonly pageSizes: readonly Size[];
  readonly rects: readonly (readonly Rect[])[];
  readonly plans: readonly RenderPlan[];
  readonly originalInfoValues: readonly string[];
}

export interface Verification {
  readonly results: readonly CheckResult[];
  readonly passed: boolean;
  readonly pdf: OpenedPdf | null;
}

const ALLOWED_INFO_KEYS = new Set([
  "PDFFormatVersion",
  "Language",
  "EncryptFilterName",
  "IsLinearized",
  "IsAcroFormPresent",
  "IsXFAPresent",
  "IsCollectionPresent",
  "IsSignaturesPresent",
]);

function countEntries(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "object") return Object.keys(value).length;
  return 1;
}

async function checkBlack(pdf: OpenedPdf, input: VerifyInput, onPage: (done: number) => void): Promise<CheckResult> {
  const failures: string[] = [];
  let checked = 0;
  for (let i = 0; i < pdf.pages.length; i++) {
    const rects = input.rects[i] ?? [];
    const plan = input.plans[i];
    const page = pdf.pages[i]!;
    if (rects.length === 0 || !plan) {
      onPage(i + 1);
      continue;
    }
    const { canvas, context } = createCanvas(plan.widthPx, plan.heightPx);
    try {
      await page.proxy.render({ canvas, canvasContext: context, viewport: page.proxy.getViewport({ scale: plan.scale }), ...RENDER_SETTINGS }).promise;
      for (const box of pixelBoxes(rects, plan)) {
        const inner = checkBox(box, BLACK_CHECK.inset);
        if (!inner) continue;
        const w = inner.right - inner.left;
        const h = inner.bottom - inner.top;
        const data = context.getImageData(inner.left, inner.top, w, h).data;
        const result = inspectBlack(data, w * h, BLACK_CHECK);
        checked += 1;
        if (!result.ok) failures.push(`${i + 1} ページ（最大 ${result.maxChannel}、平均 ${result.mean.toFixed(1)}）`);
      }
    } finally {
      freeCanvas(canvas);
    }
    onPage(i + 1);
  }
  return {
    id: "black",
    label: "塗った範囲が黒になっている（縁から 2px 内側で判定）",
    ok: failures.length === 0,
    detail: failures.length === 0 ? `${checked} か所を確認しました` : `黒になっていない範囲：${failures.join("、")}`,
  };
}

export async function verifyOutput(input: VerifyInput, onProgress: (done: number, total: number) => void): Promise<Verification> {
  const results: CheckResult[] = [];
  const structure = await inspectStructure(input.bytes);
  results.push({
    id: "structure",
    label: "出力の中身が、ページと画像だけでできている",
    ok: structure.issues.length === 0,
    detail: structure.issues.length === 0 ? `ページ ${structure.pageCount}、画像 ${structure.imageCount}` : structure.issues.join(" / "),
  });
  let pdf: OpenedPdf;
  try {
    pdf = await openPdf(input.bytes.slice());
  } catch (error) {
    results.push({ id: "pages", label: "書き出した PDF を読み込み直せる", ok: false, detail: String(error) });
    return { results, passed: false, pdf: null };
  }
  const total = pdf.pages.length;
  const expected = input.pageSizes.length;
  results.push({ id: "pages", label: "ページ数が想定と一致している", ok: total === expected, detail: `${total} ページ（想定 ${expected} ページ）` });

  const sizeIssues: string[] = [];
  let textItems = 0;
  let annotations = 0;
  for (let i = 0; i < total; i++) {
    const page = pdf.pages[i]!;
    const want = input.pageSizes[i];
    if (!want || !sameSize(page, want) || page.rotate !== 0) sizeIssues.push(`${i + 1} ページ`);
    const text = await page.proxy.getTextContent();
    textItems += text.items.length;
    annotations += (await page.proxy.getAnnotations()).length;
  }
  results.push({
    id: "sizes",
    label: "ページの大きさと向きが、元のページの表示と同じ",
    ok: sizeIssues.length === 0,
    detail: sizeIssues.length === 0 ? "すべてのページで一致" : `一致しないページ：${sizeIssues.join("、")}`,
  });
  results.push({ id: "text", label: "全ページで、テキストが 0 件", ok: textItems === 0, detail: `${textItems} 件` });
  results.push({ id: "annotations", label: "注釈がない", ok: annotations === 0, detail: `${annotations} 件` });
  const attachments = countEntries(await pdf.doc.getAttachments());
  results.push({ id: "attachments", label: "添付ファイルがない", ok: attachments === 0, detail: `${attachments} 件` });
  const outline = countEntries(await pdf.doc.getOutline());
  results.push({ id: "outline", label: "しおりがない", ok: outline === 0, detail: `${outline} 件` });
  const scripts = countEntries(await pdf.doc.getJSActions()) + countEntries(await pdf.doc.getFieldObjects());
  results.push({ id: "scripts", label: "スクリプトとフォームがない", ok: scripts === 0, detail: `${scripts} 件` });

  const metadata = await pdf.doc.getMetadata();
  const info = (metadata.info ?? {}) as Record<string, unknown>;
  const unexpected = Object.entries(info).filter(([k, v]) => !ALLOWED_INFO_KEYS.has(k) || v === true).map(([k]) => k);
  const serialized = `${JSON.stringify(info)}${metadata.metadata ? String(metadata.metadata.getRaw()) : ""}`;
  const leaked = input.originalInfoValues.filter((v) => v.length >= 2 && serialized.includes(v));
  const infoOk = unexpected.length === 0 && metadata.metadata === null && leaked.length === 0;
  results.push({
    id: "info",
    label: "文書情報が空で、元の PDF の値が入っていない",
    ok: infoOk,
    detail: infoOk ? "文書情報なし、XMP なし" : `想定外：${[...unexpected, ...(metadata.metadata ? ["XMP"] : []), ...(leaked.length > 0 ? ["元の PDF の値"] : [])].join("、")}`,
  });

  results.push(await checkBlack(pdf, input, (done) => onProgress(done, total)));
  return { results, passed: results.every((r) => r.ok), pdf };
}
