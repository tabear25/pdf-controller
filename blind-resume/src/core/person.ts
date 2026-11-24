import { FIELD_WORDS, KANA_LABELS, NAME_LABELS } from "../config/entities";

export interface PersonName {
  readonly tokens: readonly string[];
  readonly japanese: boolean;
}

export interface PersonFields {
  readonly names: readonly PersonName[];
  readonly kanas: readonly string[];
}

const JAPANESE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const NAME_TOKEN = /^(?:[\p{Script=Han}々〆ヶ]+|[\p{Script=Hiragana}\p{Script=Katakana}ー・]+|[A-Za-z'.-]+)$/u;
const KANA_ONLY = /^[\p{Script=Hiragana}\p{Script=Katakana}ー・ ]+$/u;
const MARKS = new Set(["印", "㊞", "(印)", "様", "殿", "さん"]);
const NOT_NAMES = new Set(["記入例", "自署", "署名", "氏名", "名前", "姓名", "ふりがな", "フリガナ", "本人", "同上", "未記入", "なし", "性別", "男", "女"]);

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function labelPattern(label: string): string {
  if (/^[A-Za-z ]+$/.test(label)) return `(?<![A-Za-z])${escape(label).replace(/ /g, " ?")}(?![A-Za-z])`;
  return [...label].map(escape).join(" ?");
}

function labelRegex(labels: readonly string[]): RegExp {
  const sorted = [...labels].sort((a, b) => b.length - a.length);
  return new RegExp(sorted.map(labelPattern).join("|"), "gu");
}

const NAME_LABEL = labelRegex(NAME_LABELS);
const KANA_LABEL = labelRegex(KANA_LABELS);
const STOP = new RegExp(`(?:^| )(?:${[...FIELD_WORDS].sort((a, b) => b.length - a.length).map(escape).join("|")})(?= |$)|\\d`, "u");

function valueAfter(text: string, from: number): string {
  if (from < text.length && !/[ \n:(]/.test(text[from]!)) return "";
  let j = from;
  const paren = /^ ?\([^)\n]{0,24}\)/u.exec(text.slice(j, j + 32));
  if (paren) j += paren[0].length;
  const sep = /^ *:? *\n? */u.exec(text.slice(j));
  if (sep) j += sep[0].length;
  const lineEnd = text.indexOf("\n", j);
  return text.slice(j, lineEnd < 0 ? text.length : lineEnd);
}

function tokensOf(value: string): string[] {
  const stop = STOP.exec(value);
  const head = stop ? value.slice(0, stop.index) : value;
  let tokens = head.trim().split(/ +/).filter((t) => t.length > 0 && !MARKS.has(t));
  if (tokens.length >= 2 && tokens.every((t) => [...t].length === 1)) tokens = [tokens.join("")];
  return tokens;
}

function parenthesized(value: string): { before: string; inner: string | null } {
  const open = value.indexOf("(");
  if (open < 0) return { before: value, inner: null };
  const close = value.indexOf(")", open);
  return { before: value.slice(0, open), inner: close > open ? value.slice(open + 1, close).trim() : null };
}

export function parseName(value: string): { name: PersonName | null; kana: string | null } {
  const { before, inner } = parenthesized(value);
  const kana = inner && KANA_ONLY.test(inner) ? parseKana(inner) : null;
  const raw = tokensOf(before);
  const japanese = raw.some((t) => JAPANESE.test(t));
  const tokens = raw.slice(0, japanese ? 2 : 3);
  if (tokens.length === 0 || !tokens.every((t) => NAME_TOKEN.test(t))) return { name: null, kana };
  const compact = tokens.join("");
  const count = [...compact].length;
  if (count < 2 || count > (japanese ? 12 : 40) || NOT_NAMES.has(compact)) return { name: null, kana };
  if (!japanese && !tokens.every((t) => /^[A-Z]/.test(t))) return { name: null, kana };
  return { name: { tokens, japanese }, kana };
}

export function parseKana(value: string): string | null {
  const tokens = tokensOf(parenthesized(value).before).slice(0, 3);
  const joined = tokens.join(" ");
  const count = [...joined.replace(/ /g, "")].length;
  if (tokens.length === 0 || !KANA_ONLY.test(joined) || count < 2 || count > 24 || NOT_NAMES.has(joined.replace(/ /g, ""))) return null;
  return joined;
}

export function findPersonFields(text: string): PersonFields {
  const names: PersonName[] = [];
  const kanas: string[] = [];
  const kanaLabels: [number, number][] = [];
  for (const m of text.matchAll(KANA_LABEL)) {
    const start = m.index ?? 0;
    kanaLabels.push([start, start + m[0].length]);
    const kana = parseKana(valueAfter(text, start + m[0].length));
    if (kana) kanas.push(kana);
  }
  for (const m of text.matchAll(NAME_LABEL)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (kanaLabels.some(([s, e]) => start < e && s < end)) continue;
    const parsed = parseName(valueAfter(text, end));
    if (parsed.name) names.push(parsed.name);
    if (parsed.kana) kanas.push(parsed.kana);
  }
  return { names, kanas };
}
