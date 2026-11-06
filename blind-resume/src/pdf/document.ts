import {
  getDocument,
  PasswordResponses,
  PDFWorker,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist";
import { DOCUMENT_SETTINGS } from "./settings";
import { createPdfWorker } from "./worker";

export type ViewBox = readonly [number, number, number, number];

export interface PageModel {
  readonly index: number;
  readonly proxy: PDFPageProxy;
  readonly width: number;
  readonly height: number;
  readonly rotate: number;
  readonly view: ViewBox;
  readonly userUnit: number;
}

export interface OpenedPdf {
  readonly doc: PDFDocumentProxy;
  readonly pages: readonly PageModel[];
  close(): Promise<void>;
}

export type PasswordPrompt = (reason: "need" | "incorrect") => Promise<string | null>;

export class PasswordCancelledError extends Error {
  constructor() {
    super("パスワードの入力が取り消されました。");
    this.name = "PasswordCancelledError";
  }
}

export async function openPdf(data: Uint8Array, askPassword?: PasswordPrompt): Promise<OpenedPdf> {
  const worker = createPdfWorker();
  const pdfWorker = new PDFWorker({ port: worker as never });
  const task = getDocument({ ...DOCUMENT_SETTINGS, data, worker: pdfWorker });
  let cancelledByUser = false;
  task.onPassword = (update: (password: string) => void, reason: number): void => {
    const kind = reason === PasswordResponses.INCORRECT_PASSWORD ? "incorrect" : "need";
    const prompt = askPassword ?? (async () => null);
    void prompt(kind).then((password) => {
      if (password === null) {
        cancelledByUser = true;
        void task.destroy();
        return;
      }
      update(password);
    });
  };
  const dispose = async (): Promise<void> => {
    await task.destroy().catch(() => undefined);
    pdfWorker.destroy();
    worker.terminate();
  };
  try {
    const doc = await task.promise;
    const pages = await collectPages(doc);
    return { doc, pages, close: dispose };
  } catch (error) {
    await dispose();
    if (cancelledByUser) throw new PasswordCancelledError();
    throw error;
  }
}

async function collectPages(doc: PDFDocumentProxy): Promise<PageModel[]> {
  const pages: PageModel[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const proxy = await doc.getPage(i);
    const viewport = proxy.getViewport({ scale: 1 });
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = proxy.view;
    pages.push({
      index: i - 1,
      proxy,
      width: viewport.width,
      height: viewport.height,
      rotate: proxy.rotate,
      view: [x0, y0, x1, y1],
      userUnit: proxy.userUnit,
    });
  }
  return pages;
}
