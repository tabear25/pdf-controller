export interface Normalized {
  readonly text: string;
  readonly starts: readonly number[];
  readonly ends: readonly number[];
}

export interface NormalizeOptions {
  readonly keepSpaces?: boolean;
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

export function foldCluster(cluster: string): string {
  return cluster
    .normalize("NFKC")
    .toLowerCase()
    .replace(KATAKANA, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(DASHES, "-");
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
    for (const ch of foldCluster(cluster.text)) {
      if (SPACE.test(ch)) {
        if (options.keepSpaces && !lastWasSpace) {
          text += " ";
          starts.push(cluster.start);
          ends.push(cluster.end);
          lastWasSpace = true;
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
