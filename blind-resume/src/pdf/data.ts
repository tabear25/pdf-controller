import { cmaps, standardFonts, wasm } from "virtual:pdfjs-data";

type DataKind = "cMapUrl" | "standardFontDataUrl" | "wasmUrl";

const TABLES: ReadonlyMap<string, ReadonlyMap<string, string>> = new Map<DataKind, ReadonlyMap<string, string>>([
  ["cMapUrl", new Map(Object.entries(cmaps))],
  ["standardFontDataUrl", new Map(Object.entries(standardFonts))],
  ["wasmUrl", new Map(Object.entries(wasm))],
]);

export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function bundledFileNames(kind: DataKind): string[] {
  return [...(TABLES.get(kind)?.keys() ?? [])];
}

export class BundledDataFactory {
  constructor(_options?: unknown) {}

  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const entry = TABLES.get(kind)?.get(filename);
    if (entry === undefined) {
      throw new Error(`同梱データが見つかりません（${kind} / ${filename}）`);
    }
    return decodeBase64(entry);
  }
}
