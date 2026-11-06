import { describe, expect, it } from "vitest";
import { DETECTORS, detectDrafts, type DetectorId } from "../../src/core/detectors";
import { displayTransform } from "../../src/core/geometry";
import { normalizeUnits } from "../../src/core/normalize";
import { buildPageIndex } from "../../src/core/text-index";

function find(id: DetectorId, raw: string): string[] {
  const detector = DETECTORS.find((d) => d.id === id)!;
  const text = normalizeUnits([...raw], { keepSpaces: true }).text;
  return detector.find(text).map(([s, e]) => text.slice(s, e));
}

describe("正規表現による検出", () => {
  it("メールアドレス（全角を含む）", () => {
    expect(find("email", "連絡先：taro.mihon@example.com まで")).toEqual(["taro.mihon@example.com"]);
    expect(find("email", "ｔａｒｏ＠ｅｘａｍｐｌｅ．ｃｏ．ｊｐ")).toEqual(["taro@example.co.jp"]);
  });

  it("電話番号（全角数字、各種のハイフン、括弧、国番号）", () => {
    expect(find("phone", "電話：090-0000-1234")).toEqual(["090-0000-1234"]);
    expect(find("phone", "電話：０９０－００００－５６７８")).toEqual(["090-0000-5678"]);
    expect(find("phone", "TEL 03ー0000ー5678")).toEqual(["03-0000-5678"]);
    expect(find("phone", "03(0000)5678")).toEqual(["03(0000)5678"]);
    expect(find("phone", "+81-90-0000-1234")).toEqual(["+81-90-0000-1234"]);
    expect(find("phone", "09000001234")).toEqual(["09000001234"]);
    expect(find("phone", "携帯 090-0000-1234 2013年入社")).toEqual(["090-0000-1234"]);
    expect(find("phone", "自宅 03 0000 5678、携帯 090 0000 1234")).toEqual(["03 0000 5678", "090 0000 1234"]);
  });

  it("電話番号として、日付や郵便番号、短い番号を拾わない", () => {
    expect(find("phone", "2013-04-01 入社")).toEqual([]);
    expect(find("phone", "〒000-0001")).toEqual([]);
    expect(find("phone", "社員番号 0123-4567")).toEqual([]);
  });

  it("郵便番号", () => {
    expect(find("postal", "〒000-0001 東京都")).toEqual(["〒000-0001"]);
    expect(find("postal", "〒１２３－４５６７")).toEqual(["〒123-4567"]);
    expect(find("postal", "住所 123-4567 東京都")).toEqual(["123-4567"]);
    expect(find("postal", "090-0000-1234")).toEqual([]);
  });

  it("URL", () => {
    expect(find("url", "https://example.com/mihon-taro です")).toEqual(["https://example.com/mihon-taro"]);
    expect(find("url", "www.example.jp/profile")).toEqual(["www.example.jp/profile"]);
    expect(find("url", "github.com/mihon")).toEqual(["github.com/mihon"]);
    expect(find("url", "taro.mihon@example.com")).toEqual([]);
  });

  it("年齢", () => {
    expect(find("age", "1990年4月1日（満35歳）")).toEqual(["満35歳"]);
    expect(find("age", "満 25 歳")).toEqual(["満 25 歳"]);
    expect(find("age", "年齢：28")).toEqual(["年齢:28"]);
    expect(find("age", "28才")).toEqual(["28才"]);
  });

  it("日付・年号（既定では無効）", () => {
    expect(DETECTORS.find((d) => d.id === "date")!.defaultEnabled).toBe(false);
    expect(find("date", "1990年4月1日生")).toEqual(["1990年4月1日"]);
    expect(find("date", "平成2年4月1日")).toEqual(["平成2年4月1日"]);
    expect(find("date", "令和元年5月")).toEqual(["令和元年5月"]);
    expect(find("date", "2013/04/01")).toEqual(["2013/04/01"]);
    expect(find("date", "H2.4.1")).toEqual(["h2.4.1"]);
  });

  it("検出結果を候補の矩形に変換する", () => {
    const m = displayTransform([0, 0, 595.28, 841.89], 0);
    const index = buildPageIndex(0, [{ str: "メール：taro.mihon@example.com", transform: [10, 0, 0, 10, 50, 700], width: 170, height: 10, fontName: "f", hasEOL: false }], { f: { ascent: 0.88, descent: -0.12, vertical: false } }, m, { width: 595.28, height: 841.89 });
    const drafts = detectDrafts([index], new Set<DetectorId>(["email"]));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.text).toBe("taro.mihon@example.com");
    expect(drafts[0]!.source).toEqual({ kind: "detector", detector: "email", label: "メールアドレス" });
    expect(drafts[0]!.rects[0]!.x).toBeGreaterThan(50);
  });
});
