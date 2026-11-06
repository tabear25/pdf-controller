export type Matrix = readonly [number, number, number, number, number, number];

export type ViewBox = readonly [number, number, number, number];

export type Point = readonly [number, number];

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PixelBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export type Rotation = 0 | 90 | 180 | 270;

export function normalizeRotation(rotation: number): Rotation {
  if (!Number.isFinite(rotation) || rotation % 90 !== 0) {
    throw new Error(`回転の角度が 90 度の倍数ではありません: ${rotation}`);
  }
  return ((((rotation % 360) + 360) % 360) as Rotation);
}

export function displayTransform(view: ViewBox, rotation: number, userUnit = 1): Matrix {
  const [x0, y0, x1, y1] = view;
  const s = userUnit;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const r = normalizeRotation(rotation);
  const [a, b, c, d] = r === 0 ? [1, 0, 0, -1] : r === 90 ? [0, 1, 1, 0] : r === 180 ? [-1, 0, 0, 1] : [0, -1, -1, 0];
  const offsetX = a === 0 ? Math.abs(cy - y0) * s : Math.abs(cx - x0) * s;
  const offsetY = a === 0 ? Math.abs(cx - x0) * s : Math.abs(cy - y0) * s;
  return [a * s, b * s, c * s, d * s, offsetX - a * s * cx - c * s * cy, offsetY - b * s * cx - d * s * cy];
}

export function displaySizeOf(view: ViewBox, rotation: number, userUnit = 1): Size {
  const width = (view[2] - view[0]) * userUnit;
  const height = (view[3] - view[1]) * userUnit;
  const r = normalizeRotation(rotation);
  return r === 90 || r === 270 ? { width: height, height: width } : { width, height };
}

export function applyMatrix(m: Matrix, x: number, y: number): Point {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function multiplyMatrix(first: Matrix, then: Matrix): Matrix {
  return [
    first[0] * then[0] + first[1] * then[2],
    first[0] * then[1] + first[1] * then[3],
    first[2] * then[0] + first[3] * then[2],
    first[2] * then[1] + first[3] * then[3],
    first[4] * then[0] + first[5] * then[2] + then[4],
    first[4] * then[1] + first[5] * then[3] + then[5],
  ];
}

export function matricesClose(a: Matrix, b: Matrix, tolerance = 1e-6): boolean {
  return a.every((v, i) => Math.abs(v - b[i]!) <= tolerance);
}

export function boundingRect(points: readonly Point[]): Rect {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function rectFromCorners(ax: number, ay: number, bx: number, by: number): Rect {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

export function clampRect(rect: Rect, bounds: Size): Rect {
  const x0 = Math.min(Math.max(rect.x, 0), bounds.width);
  const y0 = Math.min(Math.max(rect.y, 0), bounds.height);
  const x1 = Math.min(Math.max(rect.x + rect.width, 0), bounds.width);
  const y1 = Math.min(Math.max(rect.y + rect.height, 0), bounds.height);
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
}

export function moveWithin(rect: Rect, dx: number, dy: number, bounds: Size): Rect {
  const x = Math.min(Math.max(rect.x + dx, 0), Math.max(0, bounds.width - rect.width));
  const y = Math.min(Math.max(rect.y + dy, 0), Math.max(0, bounds.height - rect.height));
  return { x, y, width: rect.width, height: rect.height };
}

export function expandRect(rect: Rect, margin: number): Rect {
  return { x: rect.x - margin, y: rect.y - margin, width: rect.width + margin * 2, height: rect.height + margin * 2 };
}

export function toPixelBox(rect: Rect, scale: number, limit?: { width: number; height: number }): PixelBox {
  const epsilon = 1e-7;
  let left = Math.floor(rect.x * scale + epsilon);
  let top = Math.floor(rect.y * scale + epsilon);
  let right = Math.ceil((rect.x + rect.width) * scale - epsilon);
  let bottom = Math.ceil((rect.y + rect.height) * scale - epsilon);
  if (limit) {
    left = Math.max(0, Math.min(left, limit.width));
    top = Math.max(0, Math.min(top, limit.height));
    right = Math.max(0, Math.min(right, limit.width));
    bottom = Math.max(0, Math.min(bottom, limit.height));
  }
  return { left, top, right, bottom };
}

export function insetPixelBox(box: PixelBox, inset: number): PixelBox | null {
  const inner = { left: box.left + inset, top: box.top + inset, right: box.right - inset, bottom: box.bottom - inset };
  return inner.right > inner.left && inner.bottom > inner.top ? inner : null;
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function intersection(a: Rect, b: Rect): Rect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

function subtract(target: Rect, cut: Rect): Rect[] {
  const overlap = intersection(target, cut);
  if (!overlap) return [target];
  const pieces: Rect[] = [];
  const tx1 = target.x + target.width;
  const ty1 = target.y + target.height;
  const ox1 = overlap.x + overlap.width;
  const oy1 = overlap.y + overlap.height;
  if (overlap.y > target.y) pieces.push({ x: target.x, y: target.y, width: target.width, height: overlap.y - target.y });
  if (oy1 < ty1) pieces.push({ x: target.x, y: oy1, width: target.width, height: ty1 - oy1 });
  if (overlap.x > target.x) pieces.push({ x: target.x, y: overlap.y, width: overlap.x - target.x, height: overlap.height });
  if (ox1 < tx1) pieces.push({ x: ox1, y: overlap.y, width: tx1 - ox1, height: overlap.height });
  return pieces;
}

export function coveredBy(target: Rect, covers: readonly Rect[], tolerance = 0.01): boolean {
  let remaining: Rect[] = [target];
  for (const cover of covers) {
    remaining = remaining.flatMap((piece) => subtract(piece, cover));
    remaining = remaining.filter((piece) => piece.width > tolerance && piece.height > tolerance);
    if (remaining.length === 0) return true;
  }
  return remaining.length === 0;
}

export function sameSize(a: Size, b: Size, tolerance = 0.5): boolean {
  return Math.abs(a.width - b.width) <= tolerance && Math.abs(a.height - b.height) <= tolerance;
}

export function rectsClose(a: Rect, b: Rect, tolerance = 0.01): boolean {
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}
