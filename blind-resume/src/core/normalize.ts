export interface Normalized {
  readonly text: string;
  readonly starts: readonly number[];
  readonly ends: readonly number[];
}

export interface NormalizeOptions {
  readonly keepSpaces?: boolean;
  readonly keepLineBreaks?: boolean;
  readonly preserveCase?: boolean;
  readonly preserveKana?: boolean;
}

export interface FoldOptions {
  readonly preserveCase?: boolean;
  readonly preserveKana?: boolean;
}

const COMBINING = /^\p{M}/u;
const SPACE = /[\s​-‍⁠﻿]/u;
const DASHES = /[‐-―⁃−─━ー﹘﹣－]/g;
const KATAKANA = /[ァ-ヶヽヾ]/g;

export function isContinuation(ch: string): boolean {
  if (ch === "ﾞ" || ch === "ﾟ") return true;
  const n = ch.normalize("NFKC");
  return n.length > 0 && COMBINING.test(n);
}

export function foldCluster(cluster: string, options: FoldOptions = {}): string {
  let text = cluster.normalize("NFKC");
  if (!options.preserveCase) text = text.toLowerCase();
  if (!options.preserveKana) text = text.replace(KATAKANA, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60)).replace(DASHES, "-");
  else text = text.replace(DASHES, (ch) => (ch === "ー" ? ch : "-"));
  return text;
}

interface Cluster {
  text: string;
  readonly start: number;
  end: number;
}

function clustersOf(units: readonly string[]): Cluster[] {
  const clusters: Cluster[] = [];
  let lastBase: Cluster | null = null;
  for (let i = 0; i < units.length; i++) {
    const unit = units[i]!;
    if (lastBase && isContinuation(unit)) {
      lastBase.text += unit;
      lastBase.end = i + 1;
      continue;
    }
    const cluster: Cluster = { text: unit, start: i, end: i + 1 };
    clusters.push(cluster);
    lastBase = SPACE.test(unit.normalize("NFKC")) ? lastBase : cluster;
  }
  return clusters;
}

export function normalizeUnits(units: readonly string[], options: NormalizeOptions = {}): Normalized {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let lastWasSpace = true;
  for (const cluster of clustersOf(units)) {
    for (const ch of foldCluster(cluster.text, options)) {
      if (SPACE.test(ch)) {
        const mark = options.keepLineBreaks && ch === "\n" ? "\n" : " ";
        if (options.keepSpaces && !lastWasSpace) {
          text += mark;
          starts.push(cluster.start);
          ends.push(cluster.end);
          lastWasSpace = true;
        } else if (options.keepSpaces && mark === "\n" && text.endsWith(" ")) {
          text = `${text.slice(0, -1)}\n`;
        }
        continue;
      }
      text += ch;
      for (let k = 0; k < ch.length; k++) {
        starts.push(cluster.start);
        ends.push(cluster.end);
      }
      lastWasSpace = false;
    }
  }
  return { text, starts, ends };
}

export function normalizeQuery(query: string): string {
  return normalizeUnits([...query]).text;
}
