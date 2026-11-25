import {
  ABBREVIATED_LEGAL_FORMS,
  ADDRESS_LABELS,
  FIELD_WORDS,
  GENERIC_BUSINESS_WORDS,
  GENERIC_SCHOOL_WORDS,
  GENERIC_STATION_WORDS,
  JAPANESE_LEGAL_FORMS,
  LATIN_LEGAL_FORMS,
  ORGANIZATION_LEADING_WORDS,
  ORGANIZATION_TRAILING_WORDS,
  PREFECTURES,
  SCHOOL_SUFFIXES,
  STATION_LABELS,
} from "../config/entities";

export interface TextRange {
  readonly start: number;
  readonly end: number;
}

export interface EntityRange extends TextRange {
  readonly core: string;
}

const HAN = /[\p{Script=Han}々〆ヶヵ]/u;
const KATAKANA = /[\p{Script=Katakana}ー]/u;
const HIRAGANA = /\p{Script=Hiragana}/u;
const LATIN = /[A-Za-z0-9]/;
const LATIN_LETTER = /[A-Za-z]/;
const LATIN_WORD_START = /[A-Z0-9&]/;
const CONNECTORS = new Set(["・", "&", "'", "-", "."]);
const PARTICLES = new Set(["は", "が", "を", "に", "で", "と", "の", "へ", "も", "や"]);
const HARD_BOUNDARY = /[\s、。，,「」『』()（）【】[\]<>〈〉《》:：;；!！?？/／]/u;
const LEADING_DATE = /^(?:(?:明治|大正|昭和|平成|令和)?(?:\d{1,4}|元)年)?(?:\d{1,2}月)?(?:\d{1,2}日)?/u;
const CAREER_WORDS = /(?:卒業|入学|編入学|編入|中退|中途退学|退学|修了|満期退学|入社|退社|入職|退職|転籍|出向|在籍|在学)/gu;
const MUNICIPALITY = /[市区町村郡]/u;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function alternation(words: readonly string[]): string {
  return [...words].sort((a, b) => b.length - a.length).map(escape).join("|");
}

const JAPANESE_LEGAL = new RegExp(`(?:${alternation(JAPANESE_LEGAL_FORMS)}|\\((?:${alternation(ABBREVIATED_LEGAL_FORMS)})\\))`, "gu");
const LATIN_LEGAL = new RegExp(`(?<![A-Za-z])(?:${alternation(LATIN_LEGAL_FORMS)})(?![A-Za-z])`, "gu");
const SCHOOL = new RegExp(alternation(SCHOOL_SUFFIXES), "gu");
const PREFECTURE = new RegExp(alternation(PREFECTURES), "gu");
const ADDRESS_LABEL = new RegExp(`(?:${alternation(ADDRESS_LABELS)})`, "gu");
const STATION_LABEL = new RegExp(`(?:${alternation(STATION_LABELS)})`, "gu");
const STATION = /駅/gu;

export function isNameChar(ch: string | undefined): boolean {
  return ch !== undefined && (HAN.test(ch) || KATAKANA.test(ch) || LATIN.test(ch));
}

function isConnectorAt(text: string, j: number): boolean {
  return CONNECTORS.has(text[j]!) && isNameChar(text[j - 1]) && isNameChar(text[j + 1]);
}

function isLatinGapAt(text: string, j: number): boolean {
  return text[j] === " " && LATIN_LETTER.test(text[j - 1] ?? "") && LATIN_WORD_START.test(text[j + 1] ?? "");
}

export function forwardNameEnd(text: string, from: number): number {
  let j = from;
  while (j < text.length && HIRAGANA.test(text[j]!) && !PARTICLES.has(text[j]!)) j++;
  while (j < text.length) {
    if (isNameChar(text[j])) j++;
    else if (j > from && (isConnectorAt(text, j) || isLatinGapAt(text, j))) j++;
    else break;
  }
  return j;
}

function latinWordStart(text: string, end: number): number {
  let j = end;
  while (j > 0 && /[A-Za-z0-9&'.\-]/.test(text[j - 1]!)) j--;
  return j;
}

export function backwardNameStart(text: string, to: number): number {
  let j = to;
  while (j > 0) {
    const ch = text[j - 1]!;
    if (isNameChar(ch)) {
      j--;
      continue;
    }
    if (j < to && isConnectorAt(text, j - 1)) {
      j--;
      continue;
    }
    if (j < to && (ch === "の" || ch === "が") && HAN.test(text[j - 2] ?? "") && HAN.test(text[j] ?? "")) {
      j--;
      continue;
    }
    if (j < to && ch === " " && LATIN_LETTER.test(text[j - 2] ?? "") && LATIN.test(text[j] ?? "")) {
      const previous = latinWordStart(text, j - 1);
      if (LATIN_WORD_START.test(text[previous] ?? "")) {
        j--;
        continue;
      }
      break;
    }
    if (HIRAGANA.test(ch)) {
      let h = j - 1;
      while (h > 0 && HIRAGANA.test(text[h - 1]!)) h--;
      if (h === 0 || HARD_BOUNDARY.test(text[h - 1]!)) return h;
      let p = j - 1;
      while (p >= h && !PARTICLES.has(text[p]!)) p--;
      return p >= h ? p + 1 : j;
    }
    break;
  }
  return j;
}

function stripTrailing(name: string, words: readonly string[]): string {
  let current = name;
  for (let changed = true; changed; ) {
    changed = false;
    for (const word of words) {
      if (current.length > word.length && current.endsWith(word)) {
        current = current.slice(0, -word.length);
        changed = true;
      } else if (current === word) {
        return "";
      }
    }
  }
  return current;
}

function stripLeading(name: string, words: readonly string[]): string {
  let current = name;
  for (let changed = true; changed; ) {
    changed = false;
    for (const word of words) {
      if (current.startsWith(word)) {
        current = current.slice(word.length);
        changed = true;
      }
    }
  }
  return current;
}

function afterLastCareerWord(name: string): string {
  let cut = 0;
  for (const m of name.matchAll(CAREER_WORDS)) cut = (m.index ?? 0) + m[0].length;
  return name.slice(cut);
}

export function isGeneric(name: string, words: readonly string[]): boolean {
  const sorted = [...words].sort((a, b) => b.length - a.length);
  return stripTrailing(stripLeading(name, sorted), sorted).length === 0;
}

function cleanBackward(text: string, start: number, end: number): TextRange | null {
  const raw = text.slice(start, end);
  const afterDate = raw.replace(LEADING_DATE, "");
  const afterCareer = afterLastCareerWord(afterDate);
  const name = afterCareer.replace(/^[・&'.\-\s]+/u, "");
  if (name.length === 0) return null;
  return { start: end - name.length, end };
}

function nameCount(name: string): number {
  return [...name.replace(/\s/g, "")].length;
}

export function organizationCore(core: string): string | null {
  const name = core.trim();
  if (nameCount(name) < 2) return null;
  if (isGeneric(name, GENERIC_BUSINESS_WORDS)) return null;
  return name;
}

function forwardOrganization(text: string, ls: number, le: number): EntityRange | null {
  const from = text[le] === " " ? le + 1 : le;
  const end = forwardNameEnd(text, from);
  const name = stripTrailing(text.slice(from, end), ORGANIZATION_TRAILING_WORDS);
  if (nameCount(name) < 2 || (isGeneric(name, GENERIC_BUSINESS_WORDS) && nameCount(name) < 3)) return null;
  return { start: ls, end: from + name.length, core: name };
}

function backwardOrganization(text: string, ls: number, le: number): EntityRange | null {
  const to = text[ls - 1] === " " ? ls - 1 : ls;
  const start = backwardNameStart(text, to);
  const cleaned = cleanBackward(text, start, to);
  if (!cleaned) return null;
  const name = stripLeading(text.slice(cleaned.start, to), [...ORGANIZATION_LEADING_WORDS].sort((a, b) => b.length - a.length));
  if (nameCount(name) < 2 || (isGeneric(name, GENERIC_BUSINESS_WORDS) && nameCount(name) < 3)) return null;
  return { start: to - name.length, end: le, core: name };
}

export function findOrganizations(text: string): EntityRange[] {
  const out: EntityRange[] = [];
  for (const m of text.matchAll(JAPANESE_LEGAL)) {
    const ls = m.index ?? 0;
    const le = ls + m[0].length;
    const forward = forwardOrganization(text, ls, le);
    const backward = backwardOrganization(text, ls, le);
    const forwardAdjacent = forward !== null && text[le] !== " ";
    const backwardAdjacent = backward !== null && text[ls - 1] !== " ";
    const chosen = forwardAdjacent ? forward : backwardAdjacent ? backward : (forward ?? backward);
    if (chosen) out.push(chosen);
  }
  for (const m of text.matchAll(LATIN_LEGAL)) {
    const ls = m.index ?? 0;
    const le = ls + m[0].length;
    let to = ls;
    while (to > 0 && /[ ,]/.test(text[to - 1]!)) to--;
    const start = backwardNameStart(text, to);
    const name = text.slice(start, to).replace(/^[・&'.\-\s]+/u, "");
    if (nameCount(name) < 2) continue;
    out.push({ start: to - name.length, end: le, core: name });
  }
  return mergeEntities(out);
}

export function findSchools(text: string): EntityRange[] {
  const out: EntityRange[] = [];
  for (const m of text.matchAll(SCHOOL)) {
    const s = m.index ?? 0;
    const e = s + m[0].length;
    const cleaned = cleanBackward(text, backwardNameStart(text, s), s);
    if (!cleaned) continue;
    const name = text.slice(cleaned.start, s);
    if (isGeneric(name, GENERIC_SCHOOL_WORDS)) continue;
    out.push({ start: cleaned.start, end: e, core: text.slice(cleaned.start, e) });
  }
  return mergeEntities(out);
}

function isAddressChar(text: string, j: number): boolean {
  const ch = text[j];
  if (ch === undefined) return false;
  if (HAN.test(ch) || KATAKANA.test(ch) || LATIN.test(ch)) return true;
  if (ch === "-" && /[0-9A-Za-z\p{Script=Han}]/u.test(text[j - 1] ?? "") && /[0-9A-Za-z]/.test(text[j + 1] ?? "")) return true;
  if ((ch === "の" || ch === "が") && HAN.test(text[j - 1] ?? "") && HAN.test(text[j + 1] ?? "")) return true;
  return false;
}

function addressEnd(text: string, from: number): number {
  let j = from;
  for (;;) {
    if (isAddressChar(text, j)) {
      j++;
      continue;
    }
    if (HIRAGANA.test(text[j] ?? "")) {
      let h = j;
      while (HIRAGANA.test(text[h] ?? "")) h++;
      if (MUNICIPALITY.test(text[h] ?? "")) {
        j = h + 1;
        continue;
      }
    }
    break;
  }
  if (text[j] === " ") {
    const tokenEnd = text.slice(j + 1).search(/[\s]/u);
    const token = text.slice(j + 1, tokenEnd < 0 ? text.length : j + 1 + tokenEnd);
    if (/^[\p{Script=Han}\p{Script=Katakana}ーA-Za-z0-9\-・]{1,30}$/u.test(token) && (/\d/.test(token) || /(?:ハイツ|マンション|アパート|コーポ|レジデンス|ハウス|荘|号室|階|ビル|タワー|ヒルズ|コート|ヴィラ|メゾン|寮)/u.test(token))) {
      j = j + 1 + token.length;
    }
  }
  return j;
}

function fieldValue(text: string, from: number): TextRange | null {
  if (from < text.length && !/[ \n:(]/.test(text[from]!)) return null;
  let j = from;
  const paren = /^ ?\([^)\n]{0,24}\)/u.exec(text.slice(j, j + 32));
  if (paren) j += paren[0].length;
  const sep = /^ *:? *\n? */u.exec(text.slice(j));
  if (sep) j += sep[0].length;
  const lineEnd = text.indexOf("\n", j);
  let end = lineEnd < 0 ? text.length : lineEnd;
  const rest = text.slice(j, end);
  const stop = new RegExp(` (?:${alternation(FIELD_WORDS)})`, "u").exec(rest);
  if (stop) end = j + stop.index;
  while (end > j && /[\s、。,.]/u.test(text[end - 1]!)) end--;
  return end > j ? { start: j, end } : null;
}

export function findAddresses(text: string): TextRange[] {
  const out: TextRange[] = [];
  for (const m of text.matchAll(PREFECTURE)) {
    const s = m.index ?? 0;
    const after = s + m[0].length;
    const end = addressEnd(text, after);
    const rest = text.slice(after, end);
    if (/\d/.test(rest) || MUNICIPALITY.test(rest)) out.push({ start: s, end });
  }
  for (const m of text.matchAll(ADDRESS_LABEL)) {
    const value = fieldValue(text, (m.index ?? 0) + m[0].length);
    if (!value) continue;
    const content = text.slice(value.start, value.end);
    if (nameCount(content) >= 4 && (/\d/.test(content) || /[都道府県市区町村郡〒]/u.test(content))) out.push(value);
  }
  return mergeRanges(out);
}

export function findStations(text: string): TextRange[] {
  const out: TextRange[] = [];
  const genericStations = [...GENERIC_STATION_WORDS].sort((a, b) => b.length - a.length);
  for (const m of text.matchAll(STATION)) {
    const s = m.index ?? 0;
    const cleaned = cleanBackward(text, backwardNameStart(text, s), s);
    if (!cleaned) continue;
    const name = text.slice(cleaned.start, s);
    if (isGeneric(name, genericStations)) continue;
    let start = cleaned.start;
    if (text[start - 1] === " " && text[start - 2] === "線") {
      const lineStart = backwardNameStart(text, start - 1);
      if (lineStart < start - 2) start = lineStart;
    }
    out.push({ start, end: s + 1 });
  }
  for (const m of text.matchAll(STATION_LABEL)) {
    const value = fieldValue(text, (m.index ?? 0) + m[0].length);
    if (value && nameCount(text.slice(value.start, value.end)) >= 2) out.push(value);
  }
  return mergeRanges(out);
}

export function mergeRanges(ranges: readonly TextRange[]): TextRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: TextRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start < last.end) out[out.length - 1] = { start: last.start, end: Math.max(last.end, r.end) };
    else out.push(r);
  }
  return out;
}

function mergeEntities(ranges: readonly EntityRange[]): EntityRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: EntityRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start < last.end) {
      const core = last.end - last.start >= r.end - r.start ? last.core : r.core;
      out[out.length - 1] = { start: last.start, end: Math.max(last.end, r.end), core };
    } else {
      out.push(r);
    }
  }
  return out;
}
