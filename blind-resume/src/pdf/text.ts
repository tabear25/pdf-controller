import type { TextItem } from "pdfjs-dist/types/src/display/api";
import { buildPageIndex, type FontMetrics, type PageTextIndex } from "../core/text-index";
import type { PageModel } from "./document";

export interface TextIndexes {
  readonly indexes: readonly (PageTextIndex | null)[];
  readonly pagesWithoutText: readonly number[];
  readonly unverifiedPages: readonly number[];
}

export async function buildTextIndexes(pages: readonly PageModel[], stillCurrent: () => boolean): Promise<TextIndexes | null> {
  const indexes: (PageTextIndex | null)[] = [];
  const pagesWithoutText: number[] = [];
  const unverifiedPages: number[] = [];
  for (const page of pages) {
    if (!stillCurrent()) return null;
    if (!page.transformVerified) {
      indexes.push(null);
      unverifiedPages.push(page.index);
      continue;
    }
    const content = await page.proxy.getTextContent();
    const items = content.items
      .filter((item): item is TextItem => "str" in item)
      .map((item) => ({
        str: item.str,
        transform: item.transform as number[],
        width: item.width,
        height: item.height,
        fontName: item.fontName,
        hasEOL: item.hasEOL,
      }));
    const styles = content.styles as unknown as Record<string, Partial<FontMetrics>>;
    const index = buildPageIndex(page.index, items, styles, page.transform, { width: page.width, height: page.height });
    indexes.push(index);
    if (!index.hasText) pagesWithoutText.push(page.index);
  }
  return stillCurrent() ? { indexes, pagesWithoutText, unverifiedPages } : null;
}
