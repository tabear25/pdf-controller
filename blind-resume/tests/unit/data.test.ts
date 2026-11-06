import { describe, expect, it } from "vitest";
import { BundledDataFactory, bundledFileNames, decodeBase64 } from "../../src/pdf/data";

describe("同梱データ", () => {
  const factory = new BundledDataFactory();

  it("base64 を正しく復元する", () => {
    expect([...decodeBase64("AAEC/w==")]).toEqual([0, 1, 2, 255]);
  });

  it("日本語の cMap を含む、すべての cMap を同梱している", () => {
    const names = bundledFileNames("cMapUrl");
    expect(names).toContain("UniJIS-UCS2-H.bcmap");
    expect(names).toContain("Adobe-Japan1-UCS2.bcmap");
    expect(names).toContain("90ms-RKSJ-H.bcmap");
    expect(names.length).toBeGreaterThan(150);
  });

  it("cMap、標準フォント、WASM を返す", async () => {
    const cmap = await factory.fetch({ kind: "cMapUrl", filename: "UniJIS-UCS2-H.bcmap" });
    expect(cmap.byteLength).toBeGreaterThan(1000);
    const symbol = await factory.fetch({ kind: "standardFontDataUrl", filename: "FoxitSymbol.pfb" });
    expect(symbol.byteLength).toBeGreaterThan(1000);
    const wasm = await factory.fetch({ kind: "wasmUrl", filename: "jbig2.wasm" });
    expect([...wasm.subarray(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]);
    const jpx = await factory.fetch({ kind: "wasmUrl", filename: "openjpeg.wasm" });
    expect([...jpx.subarray(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]);
  });

  it("同梱していないファイルや、想定外の名前は返さない", async () => {
    await expect(factory.fetch({ kind: "wasmUrl", filename: "qcms_bg.wasm" })).rejects.toThrow("同梱データが見つかりません");
    await expect(factory.fetch({ kind: "cMapUrl", filename: "__proto__" })).rejects.toThrow("同梱データが見つかりません");
    await expect(factory.fetch({ kind: "iccUrl", filename: "x.icc" })).rejects.toThrow("同梱データが見つかりません");
    await expect(factory.fetch({ kind: "standardFontDataUrl", filename: "LiberationSans-Regular.ttf" })).rejects.toThrow("同梱データが見つかりません");
  });
});
