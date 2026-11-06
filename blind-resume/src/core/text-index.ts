import { applyMatrix, boundingRect, clampRect, expandRect, intersects, type Matrix, type Point, type Rect, type Size } from "./geometry";
import { normalizeUnits, type Normalized } from "./normalize";

export interface RawTextItem {
  readonly str: string;
  readonly transform: readonly number[];
  readonly width: number;
  readonly height: number;
  readonly fontName: string;
  readonly hasEOL: boolean;
}

export interface FontMetrics {
  readonly ascent: number;
  readonly descent: number;
  readonly vertical: boolean;
}

interface ItemFrame {
  readonly origin: Point;
  readonly along: Point;
  readonly across: Point;
  readonly length: number;
  readonly above: number;
  readonly below: number;
  readonly fontSize: number;
}

interface CharRef {
  readonly item: number;
  readonly start: number;
  readonly end: number;
  readonly slackBefore: number;
  readonly slackAfter: number;
}

export interface CharSpan {
  readonly start: number;
  readonly end: number;
  readonly slackBefore: number;
  readonly slackAfter: number;
}

export interface PageTextIndex {
  readonly page: number;
  readonly units: readonly string[];
  readonly refs: readonly (CharRef | null)[];
  readonly frames: readonly (ItemFrame | null)[];
  readonly search: Normalized;
  readonly loose: Normalized;
  readonly toDisplay: Matrix;
  readonly size: Size;
  readonly hasText: boolean;
}

const DEFAULT_METRICS: FontMetrics = { ascent: 0.8, descent: -0.2, vertical: false };

export function charWeight(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (ch === " ") return 0.3;
  if (cp >= 0xff61 && cp <= 0xff9f) return 0.5;
  if (cp < 0x0100) return 0.55;
  if (cp < 0x2e80) return 0.8;
  return 1;
}

const NARROW_SCALE_LIMITS = Object.freeze({ min: 0.5, max: 1.5 });
const FIXED_PITCH_NARROW_EM = 0.5;
const FIXED_PITCH_TOLERANCE_EM = 0.001;
const NARROW_SLACK_EM = 0.06;

export function layoutItem(chars: readonly string[], emLength: number): CharSpan[] {
  const nominal = chars.map(charWeight);
  const narrowFlags = nominal.map((w) => w < 1);
  const narrowCount = narrowFlags.filter(Boolean).length;
  const wideCount = chars.length - narrowCount;
  const narrowNominal = nominal.reduce((sum, w, k) => (narrowFlags[k] ? sum + w : sum), 0);
  const measurable = Number.isFinite(emLength) && emLength > 0;
  let weights = nominal;
  let fixedPitch = false;
  if (measurable && narrowCount > 0) {
    const average = (emLength - wideCount) / narrowCount;
    if (Math.abs(average - FIXED_PITCH_NARROW_EM) <= FIXED_PITCH_TOLERANCE_EM) {
      fixedPitch = true;
      weights = nominal.map((w, k) => (narrowFlags[k] ? FIXED_PITCH_NARROW_EM : w));
    } else if (wideCount > 0 && narrowNominal > 0) {
      const scale = Math.min(Math.max((emLength - wideCount) / narrowNominal, NARROW_SCALE_LIMITS.min), NARROW_SCALE_LIMITS.max);
      weights = nominal.map((w, k) => (narrowFlags[k] ? w * scale : w));
    }
  }
  const total = weights.reduce((sum, w) => sum + w, 0) || 1;
  const slack = (before: number): number =>
    !measurable || fixedPitch || narrowCount === 0 ? 0 : (NARROW_SLACK_EM * Math.min(before, narrowCount - before)) / emLength;
  const spans: CharSpan[] = [];
  let acc = 0;
  let narrowBefore = 0;
  chars.forEach((_, k) => {
    const w = weights[k]!;
    const narrowAfter = narrowBefore + (narrowFlags[k] ? 1 : 0);
    spans.push({ start: acc / total, end: (acc + w) / total, slackBefore: slack(narrowBefore), slackAfter: slack(narrowAfter) });
    acc += w;
    narrowBefore = narrowAfter;
  });
  return spans;
}

function frameOf(item: RawTextItem, metrics: FontMetrics): ItemFrame | null {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = item.transform;
  const lenU = Math.hypot(a, b);
  const lenV = Math.hypot(c, d);
  if (lenU === 0 || lenV === 0) return null;
  const u: Point = [a / lenU, b / lenU];
  const v: Point = [c / lenV, d / lenV];
  if (metrics.vertical) {
    return { origin: [e, f], along: [-v[0], -v[1]], across: u, length: item.height, above: lenU / 2, below: lenU / 2, fontSize: lenU };
  }
  const ascent = Number.isFinite(metrics.ascent) && metrics.ascent > 0 ? metrics.ascent : DEFAULT_METRICS.ascent;
  const descent = Number.isFinite(metrics.descent) && metrics.descent < 0 ? -metrics.descent : -DEFAULT_METRICS.descent;
  return { origin: [e, f], along: u, across: v, length: item.width, above: ascent * lenV, below: descent * lenV, fontSize: lenV };
}

export function buildPageIndex(
  page: number,
  items: readonly RawTextItem[],
  styles: Readonly<Record<string, Partial<FontMetrics>>>,
  toDisplay: Matrix,
  size: Size,
): PageTextIndex {
  const units: string[] = [];
  const refs: (CharRef | null)[] = [];
  const frames: (ItemFrame | null)[] = [];
  let hasText = false;
  items.forEach((item, index) => {
    const style = styles[item.fontName] ?? {};
    const metrics: FontMetrics = {
      ascent: style.ascent ?? DEFAULT_METRICS.ascent,
      descent: style.descent ?? DEFAULT_METRICS.descent,
      vertical: style.vertical ?? false,
    };
    const frame = frameOf(item, metrics);
    frames.push(frame);
    const chars = [...item.str];
    const spans = layoutItem(chars, frame ? frame.length / frame.fontSize : Number.NaN);
    chars.forEach((ch, k) => {
      units.push(ch);
      refs.push(frame ? { item: index, ...spans[k]! } : null);
      if (ch.trim().length > 0) hasText = true;
    });
    units.push("\n");
    refs.push(null);
  });
  return {
    page,
    units,
    refs,
    frames,
    search: normalizeUnits(units),
    loose: normalizeUnits(units, { keepSpaces: true }),
    toDisplay,
    size,
    hasText,
  };
}

function segmentRect(frame: ItemFrame, from: number, to: number, toDisplay: Matrix): Rect {
  const s0 = from * frame.length;
  const s1 = to * frame.length;
  const corner = (s: number, t: number): Point =>
    applyMatrix(toDisplay, frame.origin[0] + s * frame.along[0] + t * frame.across[0], frame.origin[1] + s * frame.along[1] + t * frame.across[1]);
  return boundingRect([corner(s0, -frame.below), corner(s1, -frame.below), corner(s0, frame.above), corner(s1, frame.above)]);
}

export function rangeRects(index: PageTextIndex, rawStart: number, rawEnd: number, expand = true): Rect[] {
  const rects: Rect[] = [];
  let current: { item: number; from: number; to: number; fromSlack: number; toSlack: number } | null = null;
  const flush = (): void => {
    if (!current) return;
    const frame = index.frames[current.item];
    if (frame) {
      const margin = expand ? Math.max(2, frame.fontSize * 0.2) : 0;
      const segment = segmentRect(frame, current.from - current.fromSlack, current.to + current.toSlack, index.toDisplay);
      const rect = clampRect(expandRect(segment, margin), index.size);
      if (rect.width > 0.5 && rect.height > 0.5) rects.push(rect);
    }
    current = null;
  };
  for (let i = rawStart; i < rawEnd; i++) {
    const ref = index.refs[i];
    if (!ref) {
      flush();
      continue;
    }
    if (index.units[i]!.trim().length === 0 && (!current || current.item !== ref.item)) continue;
    if (current && current.item === ref.item && Math.abs(current.to - ref.start) < 1e-9) {
      current.to = ref.end;
      current.toSlack = ref.slackAfter;
    } else {
      flush();
      current = { item: ref.item, from: ref.start, to: ref.end, fromSlack: ref.slackBefore, toSlack: ref.slackAfter };
    }
  }
  flush();
  return expand ? mergeLineRects(rects) : rects;
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function mergeable(a: Rect, b: Rect): boolean {
  const vertical = overlap(a.y, a.y + a.height, b.y, b.y + b.height) >= 0.6 * Math.min(a.height, b.height);
  const horizontal = overlap(a.x, a.x + a.width, b.x, b.x + b.width) >= 0.6 * Math.min(a.width, b.width);
  const gapX = Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width);
  const gapY = Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height);
  const reach = 1.5 * Math.max(a.height, b.height, Math.min(a.width, b.width));
  return (vertical && gapX <= 1.5 * Math.max(a.height, b.height)) || (horizontal && gapY <= reach);
}

export function mergeLineRects(rects: readonly Rect[]): Rect[] {
  const out: Rect[] = [];
  for (const r of rects) {
    const last = out[out.length - 1];
    if (last && mergeable(last, r)) {
      const x0 = Math.min(last.x, r.x);
      const y0 = Math.min(last.y, r.y);
      out[out.length - 1] = { x: x0, y: y0, width: Math.max(last.x + last.width, r.x + r.width) - x0, height: Math.max(last.y + last.height, r.y + r.height) - y0 };
    } else {
      out.push(r);
    }
  }
  return out;
}

export function charCenter(index: PageTextIndex, raw: number): Point | null {
  const ref = index.refs[raw];
  if (!ref) return null;
  const frame = index.frames[ref.item];
  if (!frame) return null;
  const s = ((ref.start + ref.end) / 2) * frame.length;
  const t = (frame.above - frame.below) / 2;
  return applyMatrix(index.toDisplay, frame.origin[0] + s * frame.along[0] + t * frame.across[0], frame.origin[1] + s * frame.along[1] + t * frame.across[1]);
}

export function textInRect(index: PageTextIndex, rect: Rect): string {
  let out = "";
  let pendingSpace = false;
  for (let i = 0; i < index.units.length; i++) {
    const ch = index.units[i]!;
    if (ch.trim().length === 0) {
      if (out.length > 0) pendingSpace = true;
      continue;
    }
    const center = charCenter(index, i);
    if (!center) continue;
    const inside = center[0] >= rect.x && center[0] <= rect.x + rect.width && center[1] >= rect.y && center[1] <= rect.y + rect.height;
    if (!inside) {
      if (out.length > 0) pendingSpace = true;
      continue;
    }
    if (pendingSpace) out += " ";
    out += ch;
    pendingSpace = false;
  }
  return out.trim();
}

export interface RawMatch {
  readonly rawStart: number;
  readonly rawEnd: number;
}

export function findAll(normalized: Normalized, needle: string): RawMatch[] {
  if (needle.length === 0) return [];
  const matches: RawMatch[] = [];
  let from = 0;
  while (from <= normalized.text.length - needle.length) {
    const at = normalized.text.indexOf(needle, from);
    if (at < 0) break;
    matches.push({ rawStart: normalized.starts[at]!, rawEnd: normalized.ends[at + needle.length - 1]! });
    from = at + needle.length;
  }
  return matches;
}

export function rawText(index: PageTextIndex, match: RawMatch): string {
  return index.units.slice(match.rawStart, match.rawEnd).join("").replace(/\s+/g, " ").trim();
}

export function visibleRects(rects: readonly Rect[], size: Size): Rect[] {
  const page: Rect = { x: 0, y: 0, width: size.width, height: size.height };
  return rects.filter((r) => intersects(r, page));
}
