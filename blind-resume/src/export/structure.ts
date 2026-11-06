import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  type PDFObject,
} from "pdf-lib";
import { inspectJpeg } from "../core/jpeg";

export interface StructureReport {
  readonly issues: readonly string[];
  readonly pageCount: number;
  readonly imageCount: number;
}

const KEYS = {
  catalog: new Set(["Type", "Pages"]),
  pages: new Set(["Type", "Kids", "Count"]),
  page: new Set(["Type", "Parent", "MediaBox", "Resources", "Contents"]),
  resources: new Set(["XObject"]),
  image: new Set(["Type", "Subtype", "Width", "Height", "BitsPerComponent", "ColorSpace", "Filter", "Length"]),
  content: new Set(["Length", "Filter"]),
};

const CONTENT_TOKEN = /^(q|Q|cm|Do|-?\d*\.?\d+(?:[eE][-+]?\d+)?|\/[A-Za-z0-9_.+-]+)$/;

function keysOf(dict: PDFDict): string[] {
  return [...dict.keys()].map((k) => k.decodeText());
}

function nameOf(value: PDFObject | undefined): string | null {
  return value instanceof PDFName ? value.decodeText() : null;
}

function extraKeys(dict: PDFDict, allowed: Set<string>): string[] {
  return keysOf(dict).filter((k) => !allowed.has(k));
}

function checkContent(stream: PDFRawStream, label: string, issues: string[]): void {
  const extra = extraKeys(stream.dict, KEYS.content);
  if (extra.length > 0) issues.push(`${label}：想定外の項目 ${extra.join(", ")}`);
  let text: string;
  try {
    text = new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode());
  } catch {
    issues.push(`${label}：内容を読めません`);
    return;
  }
  const tokens = text.split(/\s+/).filter((t) => t.length > 0);
  const bad = tokens.filter((t) => !CONTENT_TOKEN.test(t));
  if (bad.length > 0) issues.push(`${label}：画像の描画以外の命令があります（${[...new Set(bad)].slice(0, 5).join(" ")}）`);
}

export async function inspectStructure(bytes: Uint8Array): Promise<StructureReport> {
  const issues: string[] = [];
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: false });
  } catch (error) {
    return { issues: [`PDF として読み込めません（${String(error)}）`], pageCount: 0, imageCount: 0 };
  }
  const ctx = doc.context;
  const trailer = ctx.trailerInfo;
  if (trailer.Info !== undefined) issues.push("文書情報（Info）が含まれています");
  if (trailer.Encrypt !== undefined) issues.push("暗号化の設定が含まれています");
  let pageCount = 0;
  let imageCount = 0;
  const contentRefs = new Set<string>();
  const objects = ctx.enumerateIndirectObjects();
  for (const [, obj] of objects) {
    if (obj instanceof PDFDict && nameOf(obj.get(PDFName.of("Type"))) === "Page") {
      const contents = obj.get(PDFName.of("Contents"));
      const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
      for (const r of refs) if (r instanceof PDFRef) contentRefs.add(r.toString());
    }
  }
  for (const [ref, obj] of objects) {
    const label = `オブジェクト ${ref.toString()}`;
    if (obj instanceof PDFRawStream) {
      const subtype = nameOf(obj.dict.get(PDFName.of("Subtype")));
      if (subtype === "Image") {
        imageCount += 1;
        const extra = extraKeys(obj.dict, KEYS.image);
        if (extra.length > 0) issues.push(`${label}（画像）：想定外の項目 ${extra.join(", ")}`);
        if (nameOf(obj.dict.get(PDFName.of("Filter"))) !== "DCTDecode") issues.push(`${label}（画像）：JPEG ではありません`);
        const jpeg = inspectJpeg(obj.getContents());
        if (!jpeg.valid) issues.push(`${label}（画像）：JPEG として読めません`);
        if (jpeg.metadataMarkers.length > 0) issues.push(`${label}（画像）：画像にメタデータがあります（${jpeg.metadataMarkers.join(", ")}）`);
      } else if (contentRefs.has(ref.toString())) {
        checkContent(obj, label, issues);
      } else {
        issues.push(`${label}：想定外のストリームがあります`);
      }
      continue;
    }
    if (!(obj instanceof PDFDict)) {
      issues.push(`${label}：想定外のオブジェクトがあります`);
      continue;
    }
    const type = nameOf(obj.get(PDFName.of("Type")));
    if (type === "Catalog") {
      const extra = extraKeys(obj, KEYS.catalog);
      if (extra.length > 0) issues.push(`カタログ：想定外の項目 ${extra.join(", ")}`);
    } else if (type === "Pages") {
      const extra = extraKeys(obj, KEYS.pages);
      if (extra.length > 0) issues.push(`ページツリー：想定外の項目 ${extra.join(", ")}`);
    } else if (type === "Page") {
      pageCount += 1;
      const extra = extraKeys(obj, KEYS.page);
      if (extra.length > 0) issues.push(`${pageCount} ページ目：想定外の項目 ${extra.join(", ")}`);
      const resources = obj.get(PDFName.of("Resources"));
      const resDict = resources instanceof PDFRef ? ctx.lookup(resources) : resources;
      if (resDict instanceof PDFDict) {
        const extraRes = extraKeys(resDict, KEYS.resources);
        if (extraRes.length > 0) issues.push(`${pageCount} ページ目のリソース：想定外の項目 ${extraRes.join(", ")}`);
      }
    } else {
      issues.push(`${label}：想定外の種類（${type ?? "種類なし"}）のオブジェクトがあります`);
    }
  }
  const count = ctx.lookup(doc.catalog.get(PDFName.of("Pages")));
  if (count instanceof PDFDict) {
    const n = count.get(PDFName.of("Count"));
    if (!(n instanceof PDFNumber) || n.asNumber() !== pageCount) issues.push("ページ数の記録が実際のページ数と合いません");
  }
  return { issues, pageCount, imageCount };
}
