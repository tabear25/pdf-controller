import { rectsClose, sameSize, type Rect, type Size } from "./geometry";

export type RedactionSource = "manual" | "copy" | "candidate";

export interface Redaction extends Rect {
  readonly id: string;
  readonly page: number;
  readonly source: RedactionSource;
}

export const MIN_RECT_SIZE = 2;

export interface ApplyToAllResult {
  readonly redactions: readonly Redaction[];
  readonly added: readonly number[];
  readonly alreadyPresent: readonly number[];
  readonly skipped: readonly number[];
}

export function applyToAllPages(
  redactions: readonly Redaction[],
  sourceId: string,
  pageSizes: readonly Size[],
  nextId: () => string,
): ApplyToAllResult {
  const source = redactions.find((r) => r.id === sourceId);
  if (!source) return { redactions, added: [], alreadyPresent: [], skipped: [] };
  const sourceSize = pageSizes[source.page];
  if (!sourceSize) return { redactions, added: [], alreadyPresent: [], skipped: [] };
  const added: number[] = [];
  const alreadyPresent: number[] = [];
  const skipped: number[] = [];
  const copies: Redaction[] = [];
  pageSizes.forEach((size, page) => {
    if (page === source.page) return;
    if (!sameSize(size, sourceSize)) {
      skipped.push(page);
      return;
    }
    if (redactions.some((r) => r.page === page && rectsClose(r, source))) {
      alreadyPresent.push(page);
      return;
    }
    copies.push({ id: nextId(), page, x: source.x, y: source.y, width: source.width, height: source.height, source: "copy" });
    added.push(page);
  });
  return { redactions: copies.length > 0 ? [...redactions, ...copies] : redactions, added, alreadyPresent, skipped };
}

export function replaceRect(redactions: readonly Redaction[], id: string, rect: Rect): readonly Redaction[] {
  return redactions.map((r) => (r.id === id ? { ...r, x: rect.x, y: rect.y, width: rect.width, height: rect.height } : r));
}

export function removeRedaction(redactions: readonly Redaction[], id: string): readonly Redaction[] {
  return redactions.filter((r) => r.id !== id);
}

export function redactionsOnPage(redactions: readonly Redaction[], page: number): Redaction[] {
  return redactions.filter((r) => r.page === page);
}

export function formatPageList(pages: readonly number[]): string {
  return pages.map((p) => String(p + 1)).join("、");
}
