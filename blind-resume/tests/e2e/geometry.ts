export type Box = readonly [number, number, number, number];

export interface FixturePage {
  readonly mediaBox: Box;
  readonly cropBox: Box;
  readonly rotate: number;
  readonly targets: readonly { readonly id: string; readonly text: string; readonly bbox: Box }[];
}

export function visibleBox(page: FixturePage): Box {
  const [m0, m1, m2, m3] = page.mediaBox;
  const [c0, c1, c2, c3] = page.cropBox;
  return [Math.max(m0, c0), Math.max(m1, c1), Math.min(m2, c2), Math.min(m3, c3)];
}

export function displaySize(page: FixturePage): { width: number; height: number } {
  const [x0, y0, x1, y1] = visibleBox(page);
  const r = ((page.rotate % 360) + 360) % 360;
  return r === 90 || r === 270 ? { width: y1 - y0, height: x1 - x0 } : { width: x1 - x0, height: y1 - y0 };
}

export function toDisplay(page: FixturePage, x: number, y: number): { x: number; y: number } {
  const [vx0, vy0, vx1, vy1] = visibleBox(page);
  switch (((page.rotate % 360) + 360) % 360) {
    case 90:
      return { x: y - vy0, y: x - vx0 };
    case 180:
      return { x: vx1 - x, y: y - vy0 };
    case 270:
      return { x: vy1 - y, y: vx1 - x };
    default:
      return { x: x - vx0, y: vy1 - y };
  }
}

export function boxToDisplay(page: FixturePage, box: Box): { x: number; y: number; width: number; height: number } {
  const corners = [
    toDisplay(page, box[0], box[1]),
    toDisplay(page, box[2], box[1]),
    toDisplay(page, box[0], box[3]),
    toDisplay(page, box[2], box[3]),
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
