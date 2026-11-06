import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { EXPORT_LIMITS } from "../../src/config/export";
import { defaultFileName, formatBytes, planRender, sanitizeFileName } from "../../src/core/export-plan";
import { inspectJpeg, stripJpegMetadata } from "../../src/core/jpeg";
import { checkBox, inspectBlack } from "../../src/core/pixels";
import { buildImagePdf } from "../../src/export/assemble";
import { inspectStructure } from "../../src/export/structure";

function segment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...payload];
}

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

function sampleJpeg(withMetadata: boolean): Uint8Array {
  const parts = [
    [0xff, 0xd8],
    segment(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    withMetadata ? segment(0xe1, [...ascii("Exif"), 0, 0, ...ascii("見本")]) : [],
    withMetadata ? segment(0xe2, [...ascii("ICC_PROFILE"), 0, 1, 1]) : [],
    withMetadata ? segment(0xfe, ascii("comment: Taro Mihon")) : [],
    segment(0xdb, [0, ...new Array(64).fill(1)]),
    segment(0xc0, [8, 0, 16, 0, 32, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]),
    segment(0xc4, [0, ...new Array(16).fill(0)]),
    segment(0xda, [3, 1, 0, 2, 0, 3, 0, 0, 63, 0]),
    [0x12, 0x34, 0x56, 0xff, 0xd9],
  ];
  return new Uint8Array(parts.flat());
}

describe("書き出しの解像度", () => {
  const a4 = { width: 595.28, height: 841.89 };
  const a0 = { width: 2383.94, height: 3370.39 };

  it("A4 は指定どおりの解像度で描画する", () => {
    const plan = planRender(a4, 200, EXPORT_LIMITS);
    expect(plan).toMatchObject({ dpi: 200, reduced: false, widthPx: 1654, heightPx: 2339 });
    expect(planRender(a4, 300, EXPORT_LIMITS)).toMatchObject({ dpi: 300, reduced: false, widthPx: 2481, heightPx: 3508 });
  });

  it("描画の上限を超える大きなページは解像度を下げる", () => {
    const plan = planRender(a0, 300, EXPORT_LIMITS);
    expect(plan.reduced).toBe(true);
    expect(plan.dpi).toBeLessThan(300);
    expect(plan.widthPx * plan.heightPx).toBeLessThanOrEqual(EXPORT_LIMITS.maxPixels);
    expect(Math.max(plan.widthPx, plan.heightPx)).toBeLessThanOrEqual(EXPORT_LIMITS.maxSide);
  });
});

describe("ファイル名", () => {
  it("既定の名前は元のファイル名を使わない中立な名前", () => {
    expect(defaultFileName(new Date(2026, 10, 6, 15, 30))).toBe("blind_resume_20261106_1530.pdf");
  });

  it("使えない文字を取り除き、拡張子を付ける", () => {
    expect(sanitizeFileName("候補者A", "x.pdf")).toBe("候補者A.pdf");
    expect(sanitizeFileName("a/b:c*?.PDF", "x.pdf")).toBe("abc.pdf");
    expect(sanitizeFileName("  ..  ", "x.pdf")).toBe("x.pdf");
    expect(sanitizeFileName("..\\secret\u0000.pdf", "x.pdf")).toBe("secret.pdf");
  });

  it("ファイルの大きさを読みやすく示す", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.00 MB");
  });
});

describe("黒の判定", () => {
  it("縁から内側に縮めて判定し、細い範囲でも 1px は残す", () => {
    expect(checkBox({ left: 0, top: 0, right: 10, bottom: 10 }, 2)).toEqual({ left: 2, top: 2, right: 8, bottom: 8 });
    expect(checkBox({ left: 0, top: 0, right: 3, bottom: 10 }, 2)).toEqual({ left: 1, top: 1, right: 2, bottom: 9 });
  });

  it("黒なら合格、白や灰色が混じれば不合格", () => {
    const black = new Uint8Array(4 * 100).fill(0);
    expect(inspectBlack(black, 100, { inset: 2, maxChannel: 96, maxMean: 16 }).ok).toBe(true);
    const mixed = new Uint8Array(black);
    mixed[0] = 255;
    expect(inspectBlack(mixed, 100, { inset: 2, maxChannel: 96, maxMean: 16 }).ok).toBe(false);
    const gray = new Uint8Array(4 * 100).fill(40);
    expect(inspectBlack(gray, 100, { inset: 2, maxChannel: 96, maxMean: 16 }).ok).toBe(false);
  });
});

describe("JPEG のメタデータ", () => {
  it("APP1・APP2・COM を見つけ、取り除く", () => {
    const dirty = sampleJpeg(true);
    expect(inspectJpeg(dirty).metadataMarkers).toEqual(["APP1", "APP2", "COM"]);
    const clean = stripJpegMetadata(dirty);
    expect(inspectJpeg(clean)).toMatchObject({ valid: true, metadataMarkers: [] });
    expect(Buffer.from(clean).includes(Buffer.from("Taro Mihon"))).toBe(false);
    expect(Buffer.from(clean).includes(Buffer.from("見本"))).toBe(false);
    expect(clean.length).toBe(sampleJpeg(false).length);
  });
});

describe("出力の構造の検査", () => {
  it("画像だけの PDF は合格する", async () => {
    const bytes = await buildImagePdf([{ jpeg: sampleJpeg(false), widthPt: 100, heightPt: 200 }, { jpeg: sampleJpeg(false), widthPt: 200, heightPt: 100 }]);
    const report = await inspectStructure(bytes);
    expect(report.issues).toEqual([]);
    expect(report.pageCount).toBe(2);
    expect(report.imageCount).toBe(2);
    expect(Buffer.from(bytes).includes(Buffer.from("pdf-lib"))).toBe(false);
    expect(Buffer.from(bytes).includes(Buffer.from("/Info"))).toBe(false);
  });

  it("文書情報や注釈、フォント、添付ファイルを含む PDF は不合格", async () => {
    const report = await inspectStructure(new Uint8Array(readFileSync(resolve("tests/fixtures/pdf/06_metadata_annots.pdf"))));
    const text = report.issues.join("\n");
    expect(text).toContain("文書情報（Info）");
    expect(text).toMatch(/Annots/);
    expect(text).toMatch(/Font/);
    expect(text).toMatch(/AcroForm|Names|Outlines/);
  });

  it("画像のほかに文書情報だけを足しても見つける", async () => {
    const bytes = await buildImagePdf([{ jpeg: sampleJpeg(false), widthPt: 100, heightPt: 200 }]);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    doc.setTitle("見本太郎");
    const tampered = await doc.save({ useObjectStreams: false });
    expect((await inspectStructure(tampered)).issues.join()).toContain("文書情報");
  });

  it("画像の中にメタデータがあれば見つける", async () => {
    const bytes = await buildImagePdf([{ jpeg: sampleJpeg(false), widthPt: 100, heightPt: 200 }]);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const page = doc.getPage(0);
    page.node.set(PDFName.of("Annots"), doc.context.obj([doc.context.obj({ Type: "Annot", Subtype: "Text", Contents: PDFString.of("x") })]));
    const tampered = await doc.save({ useObjectStreams: false });
    expect((await inspectStructure(tampered)).issues.join()).toMatch(/Annots/);
  });
});
