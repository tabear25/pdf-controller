import type { PixelBox } from "./geometry";

export interface BlackLimits {
  readonly inset: number;
  readonly maxChannel: number;
  readonly maxMean: number;
}

export interface BlackResult {
  readonly ok: boolean;
  readonly checkedPixels: number;
  readonly maxChannel: number;
  readonly mean: number;
}

export function checkBox(box: PixelBox, inset: number): PixelBox | null {
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  const effective = Math.min(inset, Math.max(0, Math.floor((Math.min(width, height) - 1) / 2)));
  const inner = {
    left: box.left + effective,
    top: box.top + effective,
    right: box.right - effective,
    bottom: box.bottom - effective,
  };
  return inner.right > inner.left && inner.bottom > inner.top ? inner : null;
}

export function inspectBlack(rgba: ArrayLike<number>, pixelCount: number, limits: BlackLimits): BlackResult {
  let max = 0;
  let sum = 0;
  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    const v = Math.max(rgba[o]!, rgba[o + 1]!, rgba[o + 2]!);
    if (v > max) max = v;
    sum += v;
  }
  const mean = pixelCount > 0 ? sum / pixelCount : 255;
  return {
    ok: pixelCount > 0 && max <= limits.maxChannel && mean <= limits.maxMean,
    checkedPixels: pixelCount,
    maxChannel: max,
    mean,
  };
}
