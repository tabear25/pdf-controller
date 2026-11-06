import { describe, expect, it } from "vitest";
import { isCovered, searchDrafts } from "../../src/core/candidates";
import { EditorStore } from "../../src/core/editor";
import { displayTransform, type ViewBox } from "../../src/core/geometry";
import { normalizeQuery, normalizeUnits } from "../../src/core/normalize";
import { buildPageIndex, findAll, rangeRects, textInRect, type RawTextItem } from "../../src/core/text-index";
import { toDisplay } from "../e2e/geometry";

const A4: ViewBox = [0, 0, 595.28, 841.89];
const STYLES = { f: { ascent: 0.88, descent: -0.12, vertical: false } };

function item(str: string, x: number, y: number, size: number, width: number): RawTextItem {
  return { str, transform: [size, 0, 0, size, x, y], width, height: size, fontName: "f", hasEOL: false };
}

function units(text: string): string[] {
  return [...text];
}

describe("正規化と元の位置への対応付け", () => {
  it("半角カナと濁点（2 文字）を 1 文字にまとめ、元の 2 文字に対応付ける", () => {
    const n = normalizeUnits(units("ｶﾞｸ"));
    expect(n.text).toBe("がく");
    expect(n.starts).toEqual([0, 2]);
    expect(n.ends).toEqual([2, 3]);
  });

  it("1 文字が複数の文字に展開される場合も、すべて元の 1 文字に対応付ける", () => {
    const n = normalizeUnits(units("㈱見本①ﬁ㍻"));
    expect(n.text).toBe("(株)見本1fi平成");
    expect(n.starts).toEqual([0, 0, 0, 1, 2, 3, 4, 4, 5, 5]);
    expect(n.ends).toEqual([1, 1, 1, 2, 3, 4, 5, 5, 6, 6]);
  });

  it("文字の間に空白が入っていても、半角の濁点を前の文字にまとめる", () => {
    const n = normalizeUnits(units("ｶ ﾞ ｸ"));
    expect(n.text).toBe("がく");
    expect(n.starts).toEqual([0, 4]);
    expect(n.ends).toEqual([3, 5]);
  });

  it("結合文字の濁点をまとめる", () => {
    const n = normalizeUnits(units("が"));
    expect(n.text).toBe("が");
    expect([n.starts[0], n.ends[0]]).toEqual([0, 2]);
  });

  it("空白（全角を含む）を取り除き、残りの文字を元の位置に対応付ける", () => {
    const n = normalizeUnits(units("見 本　太\n郎"));
    expect(n.text).toBe("見本太郎");
    expect(n.starts).toEqual([0, 2, 4, 6]);
  });

  it("全角英数、大文字と小文字、ひらがなとカタカナ、ハイフン類の違いを区別しない", () => {
    expect(normalizeQuery("ＴＡＲＯ Mihon")).toBe("taromihon");
    expect(normalizeQuery("ミホン")).toBe(normalizeQuery("みほん"));
    expect(normalizeQuery("ﾐﾎﾝ ﾀﾛｳ")).toBe("みほんたろう");
    expect(normalizeQuery("０９０ー１２３４−５６７８")).toBe("090-1234-5678");
    expect(normalizeQuery("090‐1234–5678")).toBe("090-1234-5678");
  });

  it("サロゲートペアの文字も 1 文字として扱う", () => {
    const n = normalizeUnits(units("𠮷野"));
    expect(n.text).toBe("𠮷野");
    expect(n.starts).toEqual([0, 0, 1]);
  });

  it("空白を残す指定では、連続する空白を 1 つにまとめる", () => {
    expect(normalizeUnits(units("a  b\nc"), { keepSpaces: true }).text).toBe("a b c");
  });
});

describe("文書の中の検索と、候補の矩形", () => {
  const m = displayTransform(A4, 0);
  const size = { width: A4[2], height: A4[3] };

  it("1 文字ずつ離れた氏名（別々の断片）に一致し、文字ごとに矩形を作る", () => {
    const items = [item("見", 260, 741.89, 16, 16), item(" ", 276, 741.89, 16, 24), item("本", 300, 741.89, 16, 16), item(" ", 316, 741.89, 16, 24), item("太", 340, 741.89, 16, 16), item(" ", 356, 741.89, 16, 24), item("郎", 380, 741.89, 16, 16)];
    const index = buildPageIndex(0, items, STYLES, m, size);
    const [match] = findAll(index.search, normalizeQuery("見本太郎"));
    expect(match).toBeDefined();
    const cores = rangeRects(index, match!.rawStart, match!.rawEnd, false);
    expect(cores).toHaveLength(4);
    const rects = rangeRects(index, match!.rawStart, match!.rawEnd);
    expect(rects).toHaveLength(1);
    const glyphTop = 841.89 - 741.89 - 0.88 * 16;
    const glyphBottom = 841.89 - 741.89 + 0.12 * 16;
    const [r] = rects;
    expect(r!.x).toBeLessThanOrEqual(260 - 2);
    expect(r!.x + r!.width).toBeGreaterThanOrEqual(380 + 16 + 2);
    expect(r!.y).toBeLessThanOrEqual(glyphTop - 2);
    expect(r!.y + r!.height).toBeGreaterThanOrEqual(glyphBottom + 2);
  });

  it("別の行にまたがる一致は、行ごとに別の矩形にする", () => {
    const index = buildPageIndex(0, [item("見本", 500, 700, 12, 24), item("太郎", 40, 680, 12, 24)], STYLES, m, size);
    const [match] = findAll(index.search, normalizeQuery("見本太郎"));
    expect(rangeRects(index, match!.rawStart, match!.rawEnd)).toHaveLength(2);
  });

  it("断片の途中の一致は、文字の幅の比で位置を近似する", () => {
    const index = buildPageIndex(0, [item("氏名：見本 太郎（内側）", 80, 880, 14, 14 * 11.3)], STYLES, displayTransform([50, 80, 645, 922], 0), { width: 595, height: 842 });
    const [match] = findAll(index.search, normalizeQuery("見本太郎"));
    const [rect] = rangeRects(index, match!.rawStart, match!.rawEnd, false);
    expect(rect!.x).toBeCloseTo(80 - 50 + 3 * 14 * (11.3 / 11.3), 0);
    expect(rect!.x + rect!.width).toBeGreaterThan(80 - 50 + 6 * 14);
  });

  it("回転したページでも、候補の矩形が文字の位置に来る", () => {
    const rotated = displayTransform(A4, 90);
    const index = buildPageIndex(0, [item("見本", 100, 700, 20, 40)], STYLES, rotated, { width: A4[3], height: A4[2] });
    const [match] = findAll(index.search, "見本");
    const [rect] = rangeRects(index, match!.rawStart, match!.rawEnd, false);
    const page = { mediaBox: A4, cropBox: A4, rotate: 90, targets: [] };
    const corners = [toDisplay(page, 100, 700 - 0.12 * 20), toDisplay(page, 140, 700 + 0.88 * 20)];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    expect(rect!.x).toBeCloseTo(Math.min(...xs), 6);
    expect(rect!.y).toBeCloseTo(Math.min(...ys), 6);
    expect(rect!.width).toBeCloseTo(Math.max(...xs) - Math.min(...xs), 6);
    expect(rect!.height).toBeCloseTo(Math.max(...ys) - Math.min(...ys), 6);
  });

  it("ページの外にある文字は候補にしない", () => {
    const index = buildPageIndex(0, [item("見本", 100, -200, 12, 24)], STYLES, m, size);
    expect(searchDrafts([index], "見本")).toEqual([]);
  });

  it("範囲の中の文字を、検索語の候補として読み取る", () => {
    const index = buildPageIndex(0, [item("氏名：", 40, 800, 10, 30), item("見本 太郎", 80, 800, 10, 45)], STYLES, m, size);
    expect(textInRect(index, { x: 78, y: 30, width: 50, height: 15 })).toBe("見本 太郎");
  });
});

describe("候補の扱い", () => {
  const m = displayTransform(A4, 0);
  const size = { width: A4[2], height: A4[3] };
  const index = buildPageIndex(0, [item("見本 太郎", 80, 800, 10, 45), item("見本太郎", 80, 700, 10, 40)], STYLES, m, size);

  it("同じ検索を繰り返しても候補は重複しない", () => {
    const store = new EditorStore();
    store.reset([size]);
    expect(store.addCandidates(searchDrafts([index], "見本太郎")).added).toBe(2);
    expect(store.addCandidates(searchDrafts([index], "見本 太郎")).duplicates).toBe(2);
    expect(store.pendingCandidates).toHaveLength(2);
  });

  it("「塗る」で範囲が増え、元に戻すと未確認に戻る", () => {
    const store = new EditorStore();
    store.reset([size]);
    store.addCandidates(searchDrafts([index], "見本太郎"));
    const [first] = store.pendingCandidates;
    store.decide([first!.id], "apply");
    expect(store.redactions).toHaveLength(1);
    expect(store.pendingCandidates).toHaveLength(1);
    store.undo();
    expect(store.redactions).toHaveLength(0);
    expect(store.pendingCandidates).toHaveLength(2);
  });

  it("すでに塗る範囲に含まれている候補は、未確認から除く", () => {
    const store = new EditorStore();
    store.reset([size]);
    store.add(0, { x: 70, y: 25, width: 80, height: 30 });
    const result = store.addCandidates(searchDrafts([index], "見本太郎"));
    expect(result.covered).toBe(1);
    expect(store.pendingCandidates).toHaveLength(1);
    const [draft] = searchDrafts([index], "見本太郎");
    expect(isCovered(draft!, store.redactions)).toBe(true);
  });
});
