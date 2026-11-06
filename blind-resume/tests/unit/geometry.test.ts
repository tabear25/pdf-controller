import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import { describe, expect, it } from "vitest";
import {
  applyMatrix,
  boundingRect,
  clampRect,
  coveredBy,
  displaySizeOf,
  displayTransform,
  insetPixelBox,
  moveWithin,
  normalizeRotation,
  rectFromCorners,
  sameSize,
  toPixelBox,
  type ViewBox,
} from "../../src/core/geometry";
import { toDisplay } from "../e2e/geometry";

GlobalWorkerOptions.workerSrc = pathToFileURL(resolve("node_modules/pdfjs-dist/build/pdf.worker.mjs")).href;

const VIEWS: ViewBox[] = [
  [0, 0, 595.28, 841.89],
  [50, 80, 645, 922],
  [-100, -100, 495, 742],
  [10.5, 20.25, 600.75, 860.5],
];
const ROTATIONS = [0, 90, 180, 270, -90, 450];
const POINTS: [number, number][] = [
  [0, 0],
  [100, 200],
  [333.3, 777.7],
  [-50, 900],
];

describe("表示座標への変換（回転と CropBox のずれ）", () => {
  for (const view of VIEWS) {
    for (const rotation of ROTATIONS) {
      it(`view=${view.join(",")} 回転=${rotation}`, () => {
        const m = displayTransform(view, rotation);
        const page = { mediaBox: view, cropBox: view, rotate: rotation, targets: [] };
        for (const [x, y] of POINTS) {
          const [dx, dy] = applyMatrix(m, x, y);
          const expected = toDisplay(page, x, y);
          expect(dx).toBeCloseTo(expected.x, 9);
          expect(dy).toBeCloseTo(expected.y, 9);
        }
        const size = displaySizeOf(view, rotation);
        const corners = [
          applyMatrix(m, view[0], view[1]),
          applyMatrix(m, view[2], view[3]),
        ];
        const box = boundingRect(corners);
        expect(box.x).toBeCloseTo(0, 9);
        expect(box.y).toBeCloseTo(0, 9);
        expect(box.width).toBeCloseTo(size.width, 9);
        expect(box.height).toBeCloseTo(size.height, 9);
      });
    }
  }

  it("UserUnit を倍率として反映する", () => {
    const view: ViewBox = [0, 0, 100, 200];
    const m = displayTransform(view, 90, 2);
    expect(applyMatrix(m, 100, 200)).toEqual([400, 200]);
    expect(displaySizeOf(view, 90, 2)).toEqual({ width: 400, height: 200 });
  });

  it("90 度の倍数でない回転は受け付けない", () => {
    expect(() => normalizeRotation(45)).toThrow();
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(720)).toBe(0);
  });
});

describe("実際の PDF.js の viewport との一致", () => {
  for (const name of ["04_rotated_sizes.pdf", "05_cropbox.pdf", "01_embedded_resume.pdf"]) {
    it(name, async () => {
      const data = new Uint8Array(readFileSync(resolve("tests/fixtures/pdf", name)));
      const task = getDocument({ data, useSystemFonts: false, isOffscreenCanvasSupported: false });
      const doc = await task.promise;
      try {
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const viewport = page.getViewport({ scale: 1 });
          const view = page.view as unknown as ViewBox;
          const ours = displayTransform(view, page.rotate, page.userUnit);
          ours.forEach((v, k) => expect(v).toBeCloseTo(viewport.transform[k] as number, 9));
          const size = displaySizeOf(view, page.rotate, page.userUnit);
          expect(size.width).toBeCloseTo(viewport.width, 9);
          expect(size.height).toBeCloseTo(viewport.height, 9);
        }
      } finally {
        await task.destroy();
      }
    });
  }
});

describe("画素への変換（外側に丸める）", () => {
  it("塗る範囲は画素の境界まで外側に広げる", () => {
    expect(toPixelBox({ x: 10.2, y: 20.7, width: 5.1, height: 1 }, 2)).toEqual({ left: 20, top: 41, right: 31, bottom: 44 });
    expect(toPixelBox({ x: 10, y: 20, width: 5, height: 1 }, 2)).toEqual({ left: 20, top: 40, right: 30, bottom: 42 });
  });

  it("200dpi で、ちょうど境界に乗る値を余計に広げない", () => {
    const scale = 200 / 72;
    const box = toPixelBox({ x: 72, y: 36, width: 36, height: 72 }, scale);
    expect(box).toEqual({ left: 200, top: 100, right: 300, bottom: 300 });
  });

  it("画像の範囲からはみ出さない", () => {
    expect(toPixelBox({ x: -5, y: -5, width: 1000, height: 1000 }, 1, { width: 100, height: 50 })).toEqual({ left: 0, top: 0, right: 100, bottom: 50 });
  });

  it("内側に縮めた判定範囲を作る", () => {
    expect(insetPixelBox({ left: 10, top: 10, right: 20, bottom: 30 }, 2)).toEqual({ left: 12, top: 12, right: 18, bottom: 28 });
    expect(insetPixelBox({ left: 10, top: 10, right: 13, bottom: 30 }, 2)).toBeNull();
  });
});

describe("矩形の操作", () => {
  const bounds = { width: 100, height: 200 };

  it("角の順序にかかわらず矩形を作る", () => {
    expect(rectFromCorners(50, 60, 10, 20)).toEqual({ x: 10, y: 20, width: 40, height: 40 });
  });

  it("ページの外にはみ出した部分を切り取る", () => {
    expect(clampRect({ x: -10, y: 190, width: 50, height: 50 }, bounds)).toEqual({ x: 0, y: 190, width: 40, height: 10 });
  });

  it("移動してもページの外に出ない", () => {
    expect(moveWithin({ x: 80, y: 10, width: 30, height: 10 }, 50, -50, bounds)).toEqual({ x: 70, y: 0, width: 30, height: 10 });
  });

  it("複数の矩形で覆われているかを判定する", () => {
    const target = { x: 0, y: 0, width: 10, height: 10 };
    expect(coveredBy(target, [{ x: -1, y: -1, width: 6, height: 12 }, { x: 5, y: -1, width: 6, height: 12 }])).toBe(true);
    expect(coveredBy(target, [{ x: -1, y: -1, width: 6, height: 12 }, { x: 5.5, y: -1, width: 6, height: 12 }])).toBe(false);
    expect(coveredBy(target, [])).toBe(false);
  });

  it("ページの大きさの比較は 0.5pt まで許す", () => {
    expect(sameSize({ width: 595.28, height: 841.89 }, { width: 595, height: 842 })).toBe(true);
    expect(sameSize({ width: 595.28, height: 841.89 }, { width: 841.89, height: 595.28 })).toBe(false);
  });
});
