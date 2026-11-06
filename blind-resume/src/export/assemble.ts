import { PDFDict, PDFDocument, PDFName } from "pdf-lib";

export interface ImagePage {
  readonly jpeg: Uint8Array;
  readonly widthPt: number;
  readonly heightPt: number;
}

export async function buildImagePdf(pages: readonly ImagePage[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (const source of pages) {
    const image = await doc.embedJpg(source.jpeg);
    const page = doc.addPage([source.widthPt, source.heightPt]);
    page.drawImage(image, { x: 0, y: 0, width: source.widthPt, height: source.heightPt });
    const node = page.node;
    node.delete(PDFName.of("Annots"));
    const resources = node.get(PDFName.of("Resources"));
    if (resources instanceof PDFDict) {
      for (const key of ["Font", "ExtGState", "ColorSpace", "Pattern", "Shading", "Properties", "ProcSet"]) {
        resources.delete(PDFName.of(key));
      }
    }
  }
  return doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}
