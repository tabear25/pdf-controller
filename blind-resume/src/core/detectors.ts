import { draftFromMatch, type CandidateDraft } from "./candidates";
import { findAddresses, findOrganizations, findSchools, findStations, organizationCore, type TextRange } from "./entities";
import { normalizeQuery, type Normalized } from "./normalize";
import { findPersonFields } from "./person";
import { romajiNamePattern } from "./romaji";
import { findAll, type PageTextIndex, type RawMatch } from "./text-index";

export type PatternId = "email" | "phone" | "postal" | "url" | "age" | "date";
export type DetectorId = "person" | "organization" | "school" | "address" | PatternId;

export interface DetectorMatch extends RawMatch {
  readonly page: number;
}

export interface Detector {
  readonly id: DetectorId;
  readonly label: string;
  readonly defaultEnabled: boolean;
  readonly detect: (indexes: readonly PageTextIndex[]) => DetectorMatch[];
}

function scan(text: string, pattern: RegExp, accept?: (m: RegExpExecArray) => boolean): [number, number][] {
  const out: [number, number][] = [];
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    if (!accept || accept(m)) out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/;
const URL_WITH_SCHEME = /(?:https?:\/\/|www\.)[^\s<>"'()（）「」、。]+/;
const URL_BARE_PATH = /(?<![@a-z0-9.-])(?:[a-z0-9-]+\.)+(?:com|net|org|jp|io|dev|me|info|biz|co|app|page|site)(?:\.[a-z]{2})?\/[^\s<>"'()（）「」、。]*/;
const PHONE_RUN = /[\d+() -]{9,}/g;
const POSTAL = /〒 ?\d{3}-? ?\d{4}|(?<![\d-])\d{3}-\d{4}(?![\d-])/;
const AGE = /満 ?\d{1,3} ?[歳才]|(?<!\d)\d{1,3} ?[歳才]|年齢 ?[:：] ?\d{1,3}/;
const DATE = new RegExp(
  [
    "\\d{4} ?年 ?\\d{1,2} ?月(?: ?\\d{1,2} ?日)?",
    "(?:明治|大正|昭和|平成|令和) ?(?:\\d{1,2}|元) ?年(?: ?\\d{1,2} ?月(?: ?\\d{1,2} ?日)?)?",
    "(?<![\\d/.-])\\d{4}[/.-]\\d{1,2}(?:[/.-]\\d{1,2})?(?![\\d/.-])",
    "(?<![a-z\\d])[mtshr]\\d{1,2}[./]\\d{1,2}(?:[./]\\d{1,2})?(?![\\d./])",
  ].join("|"),
);

function balanced(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (depth < 0 || depth > 1) return false;
  }
  return depth === 0;
}

function dropContained(ranges: [number, number][]): [number, number][] {
  return ranges.filter(([s, e], i) => !ranges.some(([s2, e2], j) => j !== i && s2 <= s && e <= e2 && (e2 - s2 > e - s || j < i)));
}

function phoneDigitsOk(match: string): boolean {
  if (!balanced(match) || /\s{2,}|--|\(\)/.test(match)) return false;
  const digits = match.replace(/\D/g, "");
  if (match.startsWith("+81")) {
    const rest = digits.slice(2).replace(/^0/, "");
    return rest.length >= 9 && rest.length <= 10;
  }
  return digits.startsWith("0") && digits.length >= 10 && digits.length <= 11;
}

function findPhones(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of text.matchAll(PHONE_RUN)) {
    const run = m[0];
    const base = m.index ?? 0;
    let i = 0;
    while (i < run.length) {
      const startsHere = run.startsWith("+81", i) || (run[i] === "0" && (i === 0 || !/[\d+]/.test(run[i - 1]!)));
      if (!startsHere) {
        i += 1;
        continue;
      }
      let end = -1;
      for (let j = run.length; j > i; j--) {
        if (!/\d/.test(run[j - 1]!)) continue;
        if (j < run.length && /\d/.test(run[j]!)) continue;
        if (phoneDigitsOk(run.slice(i, j))) {
          end = j;
          break;
        }
      }
      if (end > 0) {
        out.push([base + i, base + end]);
        i = end;
      } else {
        i += 1;
      }
    }
  }
  return out;
}

export const PATTERNS: Readonly<Record<PatternId, (text: string) => [number, number][]>> = {
  email: (t) => scan(t, EMAIL),
  phone: (t) => findPhones(t),
  postal: (t) => scan(t, POSTAL),
  url: (t) => dropContained([...scan(t, URL_WITH_SCHEME), ...scan(t, URL_BARE_PATH)]),
  age: (t) => scan(t, AGE),
  date: (t) => scan(t, DATE),
};

function trimRange(text: string, [start, end]: readonly [number, number]): [number, number] {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text[s]!)) s++;
  while (e > s && /[\s.,、。]/.test(text[e - 1]!)) e--;
  return [s, e];
}

function toMatch(page: number, view: Normalized, range: readonly [number, number]): DetectorMatch | null {
  const [s, e] = trimRange(view.text, range);
  if (e <= s) return null;
  return { page, rawStart: view.starts[s]!, rawEnd: view.ends[e - 1]! };
}

function viewMatches(indexes: readonly PageTextIndex[], view: "loose" | "plain", find: (text: string) => readonly (readonly [number, number])[]): DetectorMatch[] {
  const out: DetectorMatch[] = [];
  for (const index of indexes) {
    for (const range of find(index[view].text)) {
      const match = toMatch(index.page, index[view], range);
      if (match) out.push(match);
    }
  }
  return out;
}

function searchMatches(indexes: readonly PageTextIndex[], term: string): DetectorMatch[] {
  const needle = normalizeQuery(term);
  if ([...needle].length < 2) return [];
  return indexes.flatMap((index) => findAll(index.search, needle).map((m) => ({ page: index.page, ...m })));
}

function regexMatches(indexes: readonly PageTextIndex[], source: string): DetectorMatch[] {
  const out: DetectorMatch[] = [];
  for (const index of indexes) {
    for (const m of index.loose.text.matchAll(new RegExp(source, "gu"))) {
      const start = m.index ?? 0;
      const match = toMatch(index.page, index.loose, [start, start + m[0].length]);
      if (match) out.push(match);
    }
  }
  return out;
}

function ranges(found: readonly TextRange[]): [number, number][] {
  return found.map((r) => [r.start, r.end]);
}

function detectPersons(indexes: readonly PageTextIndex[]): DetectorMatch[] {
  const terms = new Set<string>();
  const patterns = new Set<string>();
  for (const index of indexes) {
    const fields = findPersonFields(index.plain.text);
    for (const name of fields.names) {
      terms.add(name.tokens.join(""));
      if (!name.japanese) terms.add([...name.tokens].reverse().join(""));
      if (name.japanese && name.tokens.length >= 2 && [...name.tokens[0]!].length >= 2) terms.add(name.tokens[0]!);
    }
    for (const kana of fields.kanas) {
      terms.add(kana.replace(/ /g, ""));
      const pattern = romajiNamePattern(kana);
      if (pattern) patterns.add(pattern);
    }
  }
  return [...[...terms].flatMap((term) => searchMatches(indexes, term)), ...[...patterns].flatMap((source) => regexMatches(indexes, source))];
}

function latinCorePattern(core: string): string {
  const body = core
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s?");
  return `(?<![a-z0-9])${body}(?![a-z0-9])`;
}

function detectOrganizations(indexes: readonly PageTextIndex[]): DetectorMatch[] {
  const direct: DetectorMatch[] = [];
  const cores = new Set<string>();
  for (const index of indexes) {
    for (const found of findOrganizations(index.plain.text)) {
      const match = toMatch(index.page, index.plain, [found.start, found.end]);
      if (match) direct.push(match);
      const core = organizationCore(found.core);
      if (core) cores.add(core);
    }
  }
  const spread = [...cores].flatMap((core) => (/^[A-Za-z0-9 &'.-]+$/.test(core) ? (core.replace(/[^A-Za-z]/g, "").length >= 3 ? regexMatches(indexes, latinCorePattern(core)) : []) : searchMatches(indexes, core)));
  return [...direct, ...spread];
}

export const DETECTORS: readonly Detector[] = [
  { id: "person", label: "氏名・ふりがな", defaultEnabled: true, detect: detectPersons },
  { id: "organization", label: "会社・団体名", defaultEnabled: true, detect: detectOrganizations },
  { id: "school", label: "学校名", defaultEnabled: true, detect: (ix) => viewMatches(ix, "plain", (t) => ranges(findSchools(t))) },
  { id: "address", label: "住所・最寄り駅", defaultEnabled: true, detect: (ix) => viewMatches(ix, "plain", (t) => [...ranges(findAddresses(t)), ...ranges(findStations(t))]) },
  { id: "email", label: "メールアドレス", defaultEnabled: true, detect: (ix) => viewMatches(ix, "loose", PATTERNS.email) },
  { id: "phone", label: "電話番号", defaultEnabled: true, detect: (ix) => viewMatches(ix, "loose", PATTERNS.phone) },
  { id: "postal", label: "郵便番号", defaultEnabled: true, detect: (ix) => viewMatches(ix, "loose", PATTERNS.postal) },
  { id: "url", label: "URL", defaultEnabled: true, detect: (ix) => viewMatches(ix, "loose", PATTERNS.url) },
  { id: "age", label: "年齢", defaultEnabled: true, detect: (ix) => viewMatches(ix, "loose", PATTERNS.age) },
  { id: "date", label: "日付・年号", defaultEnabled: false, detect: (ix) => viewMatches(ix, "loose", PATTERNS.date) },
];

interface Found {
  readonly detector: Detector;
  readonly match: DetectorMatch;
  readonly order: number;
}

function keepOutermost(found: readonly Found[]): Found[] {
  const byPage = new Map<number, Found[]>();
  for (const f of found) {
    const list = byPage.get(f.match.page) ?? [];
    list.push(f);
    byPage.set(f.match.page, list);
  }
  const kept: Found[] = [];
  for (const list of byPage.values()) {
    for (const f of list) {
      const { rawStart: s, rawEnd: e } = f.match;
      const inside = list.some((g) => g !== f && g.match.rawStart <= s && e <= g.match.rawEnd && (g.match.rawEnd - g.match.rawStart > e - s || g.order < f.order));
      if (!inside) kept.push(f);
    }
  }
  return kept.sort((a, b) => a.match.page - b.match.page || a.match.rawStart - b.match.rawStart);
}

export function detectDrafts(indexes: readonly (PageTextIndex | null)[], enabled: ReadonlySet<DetectorId>): CandidateDraft[] {
  const usable = indexes.filter((index): index is PageTextIndex => index !== null);
  const byPage = new Map(usable.map((index) => [index.page, index]));
  const found: Found[] = [];
  for (const detector of DETECTORS) {
    if (!enabled.has(detector.id)) continue;
    for (const match of detector.detect(usable)) found.push({ detector, match, order: found.length });
  }
  const drafts: CandidateDraft[] = [];
  for (const { detector, match } of keepOutermost(found)) {
    const index = byPage.get(match.page);
    if (!index) continue;
    const draft = draftFromMatch(index, match, { kind: "detector", detector: detector.id, label: detector.label });
    if (draft) drafts.push(draft);
  }
  return drafts;
}
