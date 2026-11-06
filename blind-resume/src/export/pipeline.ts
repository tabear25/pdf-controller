import { EXPORT_LIMITS } from "../config/export";
import { planRender, type RenderPlan } from "../core/export-plan";
import type { Rect } from "../core/geometry";
import type { Redaction } from "../core/redactions";
import type { OpenedPdf } from "../pdf/document";
import { buildImagePdf } from "./assemble";
import { rasterizePage, type RasterizedPage } from "./rasterize";
import { verifyOutput, type Verification } from "./verify";

export interface ExportRequest {
  readonly dpi: number;
  readonly includedPages: readonly number[];
  readonly redactions: readonly Redaction[];
  readonly originalInfoValues: readonly string[];
}

export type ExportPhase = "render" | "assemble" | "verify";

export interface ExportProgress {
  readonly phase: ExportPhase;
  readonly done: number;
  readonly total: number;
}

export interface ExportResult {
  readonly bytes: Uint8Array;
  readonly includedPages: readonly number[];
  readonly plans: readonly RenderPlan[];
  readonly rects: readonly (readonly Rect[])[];
  readonly verification: Verification;
}

export class ExportCancelledError extends Error {
  constructor() {
    super("書き出しを中止しました。");
    this.name = "ExportCancelledError";
  }
}

export async function runExport(
  source: OpenedPdf,
  request: ExportRequest,
  onProgress: (progress: ExportProgress) => void,
  signal: AbortSignal,
): Promise<ExportResult> {
  const check = (): void => {
    if (signal.aborted) throw new ExportCancelledError();
  };
  const pages = request.includedPages.map((i) => source.pages[i]!);
  const rects = request.includedPages.map((i) => request.redactions.filter((r) => r.page === i));
  const plans = pages.map((p) => planRender(p, request.dpi, EXPORT_LIMITS));
  const rasterized: RasterizedPage[] = [];
  for (let k = 0; k < pages.length; k++) {
    check();
    onProgress({ phase: "render", done: k, total: pages.length });
    rasterized.push(await rasterizePage(pages[k]!, rects[k]!, plans[k]!));
  }
  check();
  onProgress({ phase: "assemble", done: pages.length, total: pages.length });
  const bytes = await buildImagePdf(rasterized);
  rasterized.length = 0;
  check();
  onProgress({ phase: "verify", done: 0, total: pages.length });
  const verification = await verifyOutput(
    { bytes, pageSizes: pages.map((p) => ({ width: p.width, height: p.height })), rects, plans, originalInfoValues: request.originalInfoValues },
    (done, total) => onProgress({ phase: "verify", done, total }),
  );
  if (signal.aborted) {
    await verification.pdf?.close();
    throw new ExportCancelledError();
  }
  return { bytes, includedPages: request.includedPages, plans, rects, verification };
}

export async function collectInfoValues(source: OpenedPdf): Promise<string[]> {
  const values = new Set<string>();
  const add = (v: unknown): void => {
    if (typeof v === "string" && v.trim().length >= 2) values.add(v.trim());
    else if (v && typeof v === "object") for (const inner of Object.values(v)) add(inner);
  };
  try {
    const metadata = await source.doc.getMetadata();
    const info = (metadata.info ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(info)) if (key !== "PDFFormatVersion") add(value);
    if (metadata.metadata) for (const [, value] of metadata.metadata as unknown as Iterable<[string, unknown]>) add(value);
  } catch (error) {
    console.warn("元の PDF の文書情報を読めませんでした", error);
  }
  return [...values];
}
