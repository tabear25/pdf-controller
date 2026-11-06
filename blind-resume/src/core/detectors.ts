import { draftFromMatch, type CandidateDraft } from "./candidates";
import type { PageTextIndex, RawMatch } from "./text-index";

export type DetectorId = "email" | "phone" | "postal" | "url" | "age" | "date";

export interface Detector {
  readonly id: DetectorId;
  readonly label: string;
  readonly defaultEnabled: boolean;
  readonly find: (text: string) => readonly [number, number][];
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

export const DETECTORS: readonly Detector[] = [
  { id: "email", label: "メールアドレス", defaultEnabled: true, find: (t) => scan(t, EMAIL) },
  { id: "phone", label: "電話番号", defaultEnabled: true, find: (t) => findPhones(t) },
  { id: "postal", label: "郵便番号", defaultEnabled: true, find: (t) => scan(t, POSTAL) },
  {
    id: "url",
    label: "URL",
    defaultEnabled: true,
    find: (t) => dropContained([...scan(t, URL_WITH_SCHEME), ...scan(t, URL_BARE_PATH)]),
  },
  { id: "age", label: "年齢", defaultEnabled: true, find: (t) => scan(t, AGE) },
  { id: "date", label: "日付・年号", defaultEnabled: false, find: (t) => scan(t, DATE) },
];

function trimRange(text: string, [start, end]: readonly [number, number]): [number, number] {
  let s = start;
  let e = end;
  while (s < e && text[s] === " ") s++;
  while (e > s && /[ .,、。]/.test(text[e - 1]!)) e--;
  return [s, e];
}

export function detectDrafts(indexes: readonly (PageTextIndex | null)[], enabled: ReadonlySet<DetectorId>): CandidateDraft[] {
  const drafts: CandidateDraft[] = [];
  for (const index of indexes) {
    if (!index) continue;
    const text = index.loose.text;
    for (const detector of DETECTORS) {
      if (!enabled.has(detector.id)) continue;
      for (const range of detector.find(text)) {
        const [s, e] = trimRange(text, range);
        if (e <= s) continue;
        const match: RawMatch = { rawStart: index.loose.starts[s]!, rawEnd: index.loose.ends[e - 1]! };
        const draft = draftFromMatch(index, match, { kind: "detector", detector: detector.id, label: detector.label });
        if (draft) drafts.push(draft);
      }
    }
  }
  return drafts;
}
