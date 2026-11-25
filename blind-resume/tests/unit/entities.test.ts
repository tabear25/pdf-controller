import { describe, expect, it } from "vitest";
import { detectDrafts, type DetectorId } from "../../src/core/detectors";
import { findAddresses, findOrganizations, findSchools, findStations, organizationCore, type TextRange } from "../../src/core/entities";
import { displayTransform } from "../../src/core/geometry";
import { normalizeUnits } from "../../src/core/normalize";
import { findPersonFields } from "../../src/core/person";
import { romajiNamePattern } from "../../src/core/romaji";
import { buildPageIndex, type RawTextItem } from "../../src/core/text-index";

function plain(raw: string): string {
  return normalizeUnits([...raw], { keepSpaces: true, keepLineBreaks: true, preserveCase: true, preserveKana: true }).text;
}

function texts(raw: string, find: (text: string) => readonly TextRange[]): string[] {
  const text = plain(raw);
  return find(text).map((r) => text.slice(r.start, r.end));
}

describe("会社・団体名", () => {
  it("法人の種類の前後にある名前を取る", () => {
    expect(texts("2013年4月　株式会社見本商事　入社", findOrganizations)).toEqual(["株式会社見本商事"]);
    expect(texts("株式会社見本商事での経験を生かし", findOrganizations)).toEqual(["株式会社見本商事"]);
    expect(texts("見本商事株式会社に入社", findOrganizations)).toEqual(["見本商事株式会社"]);
    expect(texts("平成25年4月見本商事株式会社入社", findOrganizations)).toEqual(["見本商事株式会社"]);
    expect(texts("勤務先：見本商事株式会社", findOrganizations)).toEqual(["見本商事株式会社"]);
    expect(texts("一般社団法人見本協会", findOrganizations)).toEqual(["一般社団法人見本協会"]);
    expect(texts("株式会社 見本商事", findOrganizations)).toEqual(["株式会社 見本商事"]);
  });

  it("略称、英語の社名、ひらがなを含む社名", () => {
    expect(texts("(株)見本商事", findOrganizations)).toEqual(["(株)見本商事"]);
    expect(texts("見本商事㈱にて", findOrganizations)).toEqual(["見本商事(株)"]);
    expect(texts("I worked at Acme Widgets Inc. as", findOrganizations)).toEqual(["Acme Widgets Inc."]);
    expect(texts("Example Co., Ltd.", findOrganizations)).toEqual(["Example Co., Ltd."]);
    expect(texts("前職はみずほ証券株式会社で", findOrganizations)).toEqual(["みずほ証券株式会社"]);
    expect(texts("株式会社みずほ銀行", findOrganizations)).toEqual(["株式会社みずほ銀行"]);
    expect(texts("株式会社ぐるなびでの経験", findOrganizations)).toEqual(["株式会社ぐるなび"]);
  });

  it("一般的な言い回しは取らない", () => {
    expect(texts("株式会社化を進め", findOrganizations)).toEqual([]);
    expect(texts("株式会社を設立", findOrganizations)).toEqual([]);
    expect(texts("有限会社勤務", findOrganizations)).toEqual([]);
    expect(texts("株式会社と有限会社の違い", findOrganizations)).toEqual([]);
  });

  it("文書全体で探す名前は、業種の言葉だけのものを除く", () => {
    expect(organizationCore("見本商事")).toBe("見本商事");
    expect(organizationCore("証券")).toBeNull();
    expect(organizationCore("日本銀行")).toBeNull();
    expect(organizationCore("X")).toBeNull();
  });
});

describe("学校名", () => {
  it("学校の種類の前にある名前を取る", () => {
    expect(texts("2009年3月　見本高等学校　卒業", findSchools)).toEqual(["見本高等学校"]);
    expect(texts("2013年3月　見本大学　経済学部　卒業", findSchools)).toEqual(["見本大学"]);
    expect(texts("見本大学では統計を学び", findSchools)).toEqual(["見本大学"]);
    expect(texts("見本大学大学院修了", findSchools)).toEqual(["見本大学大学院"]);
    expect(texts("見本大学附属高等学校", findSchools)).toEqual(["見本大学附属高等学校"]);
    expect(texts("平成25年3月見本大学卒業", findSchools)).toEqual(["見本大学"]);
    expect(texts("お茶の水女子大学", findSchools)).toEqual(["お茶の水女子大学"]);
    expect(texts("私立見本中学校", findSchools)).toEqual(["私立見本中学校"]);
  });

  it("一般的な言い回しは取らない", () => {
    for (const phrase of ["大学時代は", "県立高校", "女子大学", "有名大学を出て", "同大学で", "高校生のとき", "大学院生"]) expect(texts(phrase, findSchools), phrase).toEqual([]);
  });
});

describe("住所・最寄り駅", () => {
  it("都道府県から始まる住所と、「住所」欄の値", () => {
    expect(texts("〒000-0001　東京都見本区見本町1-2-3", findAddresses)).toEqual(["東京都見本区見本町1-2-3"]);
    expect(texts("現住所 〒000-0001 東京都見本区見本町1-2-3", findAddresses)).toEqual(["〒000-0001 東京都見本区見本町1-2-3"]);
    expect(texts("東京都千代田区丸の内1-1-1 見本ビル5階", findAddresses)).toEqual(["東京都千代田区丸の内1-1-1 見本ビル5階"]);
    expect(texts("埼玉県さいたま市見本区1-2", findAddresses)).toEqual(["埼玉県さいたま市見本区1-2"]);
    expect(texts("住所：見本市見本町3-4-5", findAddresses)).toEqual(["見本市見本町3-4-5"]);
  });

  it("住所でないものは取らない", () => {
    for (const phrase of ["東京都内の企業", "東京都で働く", "住所：同上", "大阪府立大学"]) expect(texts(phrase, findAddresses), phrase).toEqual([]);
  });

  it("駅名と路線名、「最寄り駅」欄の値", () => {
    expect(texts("最寄り駅 見本線 見本駅", findStations)).toEqual(["見本線 見本駅"]);
    expect(texts("見本駅から徒歩5分", findStations)).toEqual(["見本駅"]);
    expect(texts("最寄駅：見本駅", findStations)).toEqual(["見本駅"]);
    for (const phrase of ["最寄り駅は", "駅伝部", "各駅停車", "乗り換え駅"]) expect(texts(phrase, findStations), phrase).toEqual([]);
  });
});

describe("氏名・ふりがな欄", () => {
  it("欄の値を読み取る", () => {
    expect(findPersonFields(plain("ふりがな みほん たろう\n氏名 見本 太郎\n生年月日"))).toEqual({ names: [{ tokens: ["見本", "太郎"], japanese: true }], kanas: ["みほん たろう"] });
    expect(findPersonFields(plain("氏名：見本 太郎（みほん たろう）"))).toEqual({ names: [{ tokens: ["見本", "太郎"], japanese: true }], kanas: ["みほん たろう"] });
    expect(findPersonFields(plain("氏名 見本 太郎 ㊞")).names).toEqual([{ tokens: ["見本", "太郎"], japanese: true }]);
    expect(findPersonFields(plain("氏 名　見本　太郎")).names).toEqual([{ tokens: ["見本", "太郎"], japanese: true }]);
    expect(findPersonFields(plain("氏名\n見本 太郎\n")).names).toEqual([{ tokens: ["見本", "太郎"], japanese: true }]);
    expect(findPersonFields(plain("Name: Taro Mihon")).names).toEqual([{ tokens: ["Taro", "Mihon"], japanese: false }]);
    expect(findPersonFields(plain("氏名(カナ) ミホン タロウ"))).toEqual({ names: [], kanas: ["ミホン タロウ"] });
  });

  it("1 文字ずつ離れた氏名とふりがなをつなげる", () => {
    expect(findPersonFields(plain("氏名(1 文字ずつ別々に配置) 見 本 太 郎\nフリガナ(1 文字ずつ) ミ ホ ン タ ロ ウ"))).toEqual({
      names: [{ tokens: ["見本太郎"], japanese: true }],
      kanas: ["ミホンタロウ"],
    });
  });

  it("氏名らしくない値は取らない", () => {
    expect(findPersonFields(plain("氏名欄には記入しないでください"))).toEqual({ names: [], kanas: [] });
    expect(findPersonFields(plain("氏名 記入例"))).toEqual({ names: [], kanas: [] });
  });
});

describe("ローマ字表記", () => {
  const matches = (kana: string, text: string): boolean => new RegExp(romajiNamePattern(kana)!, "u").test(text);

  it("姓名の順、長音、撥音の書き方の違いを区別しない", () => {
    for (const text of ["taro mihon", "mihon taro", "mihon, tarou", "taroh mihon", "mihon"]) expect(matches("みほん たろう", text), text).toBe(true);
    for (const text of ["ohno shohei", "ono shohei", "shohei ohno"]) expect(matches("おおの しょうへい", text), text).toBe(true);
    for (const text of ["shimbo makoto", "shinbo makoto"]) expect(matches("しんぼ まこと", text), text).toBe(true);
    expect(matches("ミホンタロウ", "mihon taro")).toBe(true);
  });

  it("ほかの単語の一部には一致しない", () => {
    expect(matches("いとう ゆうこ", "itochu")).toBe(false);
    expect(matches("いとう ゆうこ", "kito")).toBe(false);
    expect(matches("みほん たろう", "mihontarot")).toBe(false);
  });
});

describe("自動の候補（文書全体）", () => {
  const m = displayTransform([0, 0, 595.28, 841.89], 0);
  const size = { width: 595.28, height: 841.89 };
  const styles = { f: { ascent: 0.88, descent: -0.12, vertical: false } };
  const item = (str: string, x: number, y: number, fontSize = 10): RawTextItem => ({ str, transform: [fontSize, 0, 0, fontSize, x, y], width: [...str].length * fontSize, height: fontSize, fontName: "f", hasEOL: false });
  const enabled = (...ids: DetectorId[]) => new Set<DetectorId>(ids);

  it("「氏名」欄の値を、ほかのページのヘッダーや本文からも探す", () => {
    const first = buildPageIndex(0, [item("氏名", 50, 700), item("見本 太郎", 120, 700), item("ふりがな", 50, 680), item("みほん たろう", 120, 680)], styles, m, size);
    const second = buildPageIndex(1, [item("履歴書 見本 太郎", 50, 800), item("英語では Taro Mihon と名乗る", 50, 600), item("見本です", 50, 580)], styles, m, size);
    const drafts = detectDrafts([first, second], enabled("person"));
    expect(drafts.map((d) => `${d.page}:${d.text}`)).toEqual(["0:見本 太郎", "0:みほん たろう", "1:見本 太郎", "1:Taro Mihon", "1:見本"]);
    expect(drafts.every((d) => d.source.kind === "detector" && d.source.label === "氏名・ふりがな")).toBe(true);
  });

  it("会社名を見つけたら、法人の種類のない書き方も探す。重なる候補は外側の 1 つにする", () => {
    const page = buildPageIndex(0, [item("2013年4月 株式会社見本商事 入社", 50, 700), item("見本商事では営業を担当", 50, 680)], styles, m, size);
    const drafts = detectDrafts([page], enabled("organization"));
    expect(drafts.map((d) => d.text)).toEqual(["株式会社見本商事", "見本商事"]);
  });

  it("別の種類の候補に含まれる候補は除く", () => {
    const page = buildPageIndex(0, [item("氏名", 50, 700), item("見本 太郎", 120, 700), item("見本大学 卒業", 50, 680)], styles, m, size);
    expect(detectDrafts([page], enabled("person", "school")).map((d) => d.text)).toEqual(["見本 太郎", "見本大学"]);
    expect(detectDrafts([page], enabled("person")).map((d) => d.text)).toEqual(["見本 太郎", "見本"]);
  });
});

describe("職務経歴書らしい文章", () => {
  const sheet = [
    "職務経歴書",
    "2026年11月1日現在",
    "氏名 見本 太郎",
    "■職務要約",
    "株式会社見本商事にて法人営業に5年間従事し、大手通信会社向けのシステム導入提案を担当してきました。",
    "■職務経歴",
    "2013年4月～現在 株式会社見本商事",
    "事業内容：システムインテグレーション 資本金：1億円 従業員数：500名",
    "営業部 法人営業課",
    "■学歴",
    "2013年3月 見本大学 経済学部 卒業",
    "■自己PR",
    "前職の見本商事では新規開拓に注力しました。大学時代はゼミで統計を学びました。",
    "最寄り駅は見本線の見本駅です。東京都内の顧客を中心に担当しました。住所は非公開です。",
    "株式会社化の支援や、子会社の設立にも関わりました。",
  ].join("\n");

  it("名前のあるものだけを取り、一般的な言い回しは取らない", () => {
    expect(texts(sheet, findOrganizations)).toEqual(["株式会社見本商事", "株式会社見本商事"]);
    expect(texts(sheet, findSchools)).toEqual(["見本大学"]);
    expect(texts(sheet, findAddresses)).toEqual([]);
    expect(texts(sheet, findStations)).toEqual(["見本線の見本駅"]);
    expect(findPersonFields(plain(sheet))).toEqual({ names: [{ tokens: ["見本", "太郎"], japanese: true }], kanas: [] });
  });
});
