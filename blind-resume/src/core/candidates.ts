import { coveredBy, type Rect } from "./geometry";
import { normalizeQuery } from "./normalize";
import type { Redaction } from "./redactions";
import { findAll, rangeRects, rawText, type PageTextIndex, type RawMatch } from "./text-index";

export type Decision = "pending" | "apply" | "skip";

export type CandidateSource =
  | { readonly kind: "search"; readonly query: string }
  | { readonly kind: "detector"; readonly detector: string; readonly label: string };

export interface CandidateDraft {
  readonly key: string;
  readonly page: number;
  readonly rects: readonly Rect[];
  readonly cores: readonly Rect[];
  readonly text: string;
  readonly source: CandidateSource;
}

export interface Candidate extends CandidateDraft {
  readonly id: string;
  readonly decision: Decision;
}

export function draftFromMatch(index: PageTextIndex, match: RawMatch, source: CandidateSource): CandidateDraft | null {
  const rects = rangeRects(index, match.rawStart, match.rawEnd, true);
  if (rects.length === 0) return null;
  return {
    key: `${index.page}:${match.rawStart}:${match.rawEnd}`,
    page: index.page,
    rects,
    cores: rangeRects(index, match.rawStart, match.rawEnd, false),
    text: rawText(index, match),
    source,
  };
}

export function searchDrafts(indexes: readonly (PageTextIndex | null)[], query: string): CandidateDraft[] {
  const needle = normalizeQuery(query);
  if (needle.length === 0) return [];
  const drafts: CandidateDraft[] = [];
  for (const index of indexes) {
    if (!index) continue;
    for (const match of findAll(index.search, needle)) {
      const draft = draftFromMatch(index, match, { kind: "search", query });
      if (draft) drafts.push(draft);
    }
  }
  return drafts;
}

export function isCovered(candidate: CandidateDraft, redactions: readonly Redaction[]): boolean {
  const onPage = redactions.filter((r) => r.page === candidate.page);
  if (onPage.length === 0) return false;
  const targets = candidate.cores.length > 0 ? candidate.cores : candidate.rects;
  return targets.every((r) => coveredBy(r, onPage));
}

export function sourceLabel(source: CandidateSource): string {
  return source.kind === "search" ? `検索「${source.query}」` : source.label;
}
