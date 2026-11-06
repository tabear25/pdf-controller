import { describe, expect, it } from "vitest";
import { EditorStore } from "../../src/core/editor";
import { History } from "../../src/core/history";
import { applyToAllPages, type Redaction } from "../../src/core/redactions";

const A4 = { width: 595.28, height: 841.89 };
const A4_LANDSCAPE = { width: 841.89, height: 595.28 };

describe("History", () => {
  it("元に戻す・やり直すができ、新しい操作でやり直しの履歴が消える", () => {
    const h = new History(0);
    h.push(1);
    h.push(2);
    expect(h.undo()).toBe(true);
    expect(h.current).toBe(1);
    expect(h.redo()).toBe(true);
    expect(h.current).toBe(2);
    h.undo();
    h.push(3);
    expect(h.canRedo).toBe(false);
    expect(h.current).toBe(3);
  });

  it("上限を超えた古い履歴は捨てる", () => {
    const h = new History(0, 2);
    h.push(1);
    h.push(2);
    h.push(3);
    expect(h.undo()).toBe(true);
    expect(h.undo()).toBe(true);
    expect(h.undo()).toBe(false);
    expect(h.current).toBe(1);
  });
});

describe("全ページへの適用", () => {
  const base: Redaction = { id: "r1", page: 1, x: 10, y: 20, width: 30, height: 40, source: "manual" };

  it("同じ大きさと向きのページにだけ写し、違うページは除外として返す", () => {
    let n = 1;
    const result = applyToAllPages([base], "r1", [A4, A4_LANDSCAPE, A4_LANDSCAPE, A4], () => `r${++n}`);
    expect(result.added).toEqual([2]);
    expect(result.skipped).toEqual([0, 3]);
    expect(result.redactions).toHaveLength(2);
    expect(result.redactions[1]).toMatchObject({ page: 2, x: 10, y: 20, width: 30, height: 40, source: "copy" });
  });

  it("すでに同じ範囲があるページには重ねない", () => {
    const existing: Redaction = { ...base, id: "r9", page: 0 };
    const result = applyToAllPages([base, existing], "r1", [A4_LANDSCAPE, A4_LANDSCAPE], () => "rx");
    expect(result.added).toEqual([]);
    expect(result.alreadyPresent).toEqual([0]);
    expect(result.redactions).toHaveLength(2);
  });
});

describe("EditorStore", () => {
  it("作成・移動・削除が履歴に残り、順に戻せる", () => {
    const store = new EditorStore();
    store.reset([A4, A4]);
    const r = store.add(0, { x: 1, y: 2, width: 3, height: 4 });
    store.preview(r.id, { x: 5, y: 6, width: 3, height: 4 });
    store.preview(r.id, { x: 7, y: 8, width: 3, height: 4 });
    expect(store.canUndo).toBe(false);
    store.finishPreview();
    store.remove(r.id);
    expect(store.redactions).toHaveLength(0);
    store.undo();
    expect(store.redactions[0]).toMatchObject({ x: 7, y: 8 });
    store.undo();
    expect(store.redactions[0]).toMatchObject({ x: 1, y: 2 });
    store.undo();
    expect(store.redactions).toHaveLength(0);
    store.redo();
    store.redo();
    expect(store.redactions[0]).toMatchObject({ x: 7, y: 8 });
  });

  it("取り消した操作の矩形が選択されたままにならない", () => {
    const store = new EditorStore();
    store.reset([A4]);
    const r = store.add(0, { x: 1, y: 2, width: 3, height: 4 });
    expect(store.selectedId).toBe(r.id);
    store.undo();
    expect(store.selectedId).toBeNull();
  });

  it("全ページへの適用は 1 回の操作として戻せる", () => {
    const store = new EditorStore();
    store.reset([A4, A4, A4]);
    const r = store.add(0, { x: 1, y: 2, width: 3, height: 4 });
    const result = store.applyToAll(r.id);
    expect(result.added).toEqual([1, 2]);
    expect(store.redactions).toHaveLength(3);
    store.undo();
    expect(store.redactions).toHaveLength(1);
  });

  it("別のファイルを開くと、範囲と履歴を捨てる", () => {
    const store = new EditorStore();
    store.reset([A4]);
    store.add(0, { x: 1, y: 2, width: 3, height: 4 });
    store.reset([A4]);
    expect(store.redactions).toHaveLength(0);
    expect(store.canUndo).toBe(false);
  });
});
