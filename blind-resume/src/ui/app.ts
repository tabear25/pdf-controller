import { InvalidPDFException, PasswordException } from "pdfjs-dist";
import buildInfo from "virtual:build-info";
import licenseText from "virtual:licenses";
import { APP_TITLE, MAX_FILE_BYTES } from "../config/app";
import { PRIVACY_NOTE, USAGE_STEPS, USAGE_TIPS } from "../config/help";
import { openPdf, PasswordCancelledError, type OpenedPdf } from "../pdf/document";
import { askPasswordDialog, createDialog } from "./dialogs";
import { h, setText } from "./dom";
import { Viewer } from "./viewer";

type MessageKind = "error" | "warning" | "info";

interface CurrentDocument {
  readonly pdf: OpenedPdf;
  readonly fileName: string;
}

function looksLikePdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function describeOpenError(error: unknown): string {
  if (error instanceof PasswordCancelledError) return "パスワードの入力を取り消したので、PDF を開きませんでした。";
  if (error instanceof PasswordException) return "パスワードが違うため、PDF を開けませんでした。";
  if (error instanceof InvalidPDFException) return "PDF として読み込めませんでした。ファイルが壊れていないか確かめてください。";
  return "PDF を開けませんでした。詳しい内容は、ブラウザのコンソールに出しています。";
}

export class App {
  private readonly viewer: Viewer;
  private readonly fileInput: HTMLInputElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly fileInfo: HTMLElement;
  private readonly messageEl: HTMLElement;
  private readonly messageText: HTMLElement;
  private readonly dropOverlay: HTMLElement;
  private readonly statusEl: HTMLElement;
  private current: CurrentDocument | null = null;
  private loadSeq = 0;

  constructor(private readonly root: HTMLElement) {
    this.fileInput = h("input", {
      className: "visually-hidden",
      attrs: { type: "file", accept: ".pdf,application/pdf", "aria-label": "PDF ファイルを選ぶ", "data-testid": "file-input" },
    });
    const openButton = h("button", {
      className: "button primary",
      text: "📄 PDF を開く",
      attrs: { type: "button", "data-testid": "open" },
    });
    this.clearButton = h("button", {
      className: "button",
      text: "クリア",
      attrs: { type: "button", disabled: "", "data-testid": "clear" },
    });
    this.fileInfo = h("span", { className: "file-info", attrs: { "data-testid": "file-info" } });
    this.statusEl = h("span", { className: "status", attrs: { role: "status", "aria-live": "polite" } });
    this.messageText = h("span", { className: "message-text" });
    const dismiss = h("button", { className: "button small", text: "閉じる", attrs: { type: "button" } });
    this.messageEl = h(
      "div",
      { className: "message", attrs: { role: "alert", hidden: "", "data-testid": "message" } },
      this.messageText,
      dismiss,
    );
    const empty = h(
      "div",
      { className: "empty-state" },
      h("p", { className: "empty-title", text: "ここに PDF をドラッグ＆ドロップするか、「PDF を開く」を押してください。" }),
      h("p", { className: "empty-note", text: PRIVACY_NOTE }),
    );
    this.viewer = new Viewer(empty);
    this.dropOverlay = h(
      "div",
      { className: "drop-overlay", attrs: { hidden: "" } },
      h("p", { text: "ここに PDF をドロップ" }),
    );

    const licensesPre = h("pre", { className: "license-text", text: licenseText });
    const licensesDialog = createDialog("licenses", "第三者ライセンス", licensesPre);
    const licensesButton = h("button", {
      className: "link-button",
      text: "第三者ライセンス",
      attrs: { type: "button", "data-testid": "licenses" },
    });

    const header = h(
      "header",
      { className: "app-header" },
      h("h1", { className: "app-title", text: APP_TITLE }),
      h("p", { className: "privacy", text: `🔒 ${PRIVACY_NOTE}` }),
    );
    const toolbar = h(
      "div",
      { className: "toolbar", attrs: { role: "toolbar", "aria-label": "操作" } },
      openButton,
      this.fileInput,
      this.clearButton,
      this.fileInfo,
      h("span", { className: "spacer" }),
      this.statusEl,
    );
    const side = h(
      "aside",
      { className: "side-panel", attrs: { "aria-label": "使い方" } },
      h("h2", { className: "panel-title", text: "使い方" }),
      h("ol", { className: "usage" }, ...USAGE_STEPS.map((step) => h("li", { text: step }))),
      h("ul", { className: "tips" }, ...USAGE_TIPS.map((tip) => h("li", { text: tip }))),
    );
    const footer = h(
      "footer",
      { className: "app-footer" },
      h("span", { text: `版 ${buildInfo.appVersion} ・ PDF.js ${buildInfo.pdfjsVersion}` }),
      licensesButton,
    );
    const workspace = h("main", { className: "workspace" }, this.viewer.element, side);
    this.root.append(header, toolbar, this.messageEl, workspace, footer, this.dropOverlay, licensesDialog);

    openButton.addEventListener("click", () => this.fileInput.click());
    this.fileInput.addEventListener("change", () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = "";
      if (file) void this.openFile(file);
    });
    this.clearButton.addEventListener("click", () => void this.clearAll());
    dismiss.addEventListener("click", () => this.hideMessage());
    licensesButton.addEventListener("click", () => licensesDialog.showModal());
    this.installDropTarget();
  }

  private installDropTarget(): void {
    const hasFiles = (event: DragEvent): boolean => event.dataTransfer?.types.includes("Files") ?? false;
    window.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (!hasFiles(event)) return;
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      this.dropOverlay.hidden = false;
    });
    window.addEventListener("dragleave", (event) => {
      if (event.relatedTarget === null) this.dropOverlay.hidden = true;
    });
    window.addEventListener("drop", (event) => {
      event.preventDefault();
      this.dropOverlay.hidden = true;
      const file = event.dataTransfer?.files[0];
      if (file) void this.openFile(file);
    });
  }

  private async openFile(file: File): Promise<void> {
    if (!looksLikePdf(file)) {
      this.showMessage("error", "PDF ファイルを選んでください。");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      this.showMessage("error", "ファイルが大きすぎるため開けません（上限は 300MB です）。");
      return;
    }
    const seq = ++this.loadSeq;
    await this.closeCurrent();
    this.hideMessage();
    this.setStatus("読み込んでいます…");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdf = await openPdf(bytes, (reason) => askPasswordDialog(this.root, reason));
      if (seq !== this.loadSeq) {
        await pdf.close();
        return;
      }
      this.current = { pdf, fileName: file.name };
      this.viewer.setPages(pdf.pages);
      this.updateFileInfo();
      this.setStatus("");
    } catch (error) {
      if (seq !== this.loadSeq) return;
      if (!(error instanceof PasswordCancelledError)) console.error("PDF を開けませんでした", error);
      this.setStatus("");
      this.showMessage("error", describeOpenError(error));
    }
  }

  private async clearAll(): Promise<void> {
    this.loadSeq++;
    await this.closeCurrent();
    this.hideMessage();
    this.setStatus("");
  }

  private async closeCurrent(): Promise<void> {
    const current = this.current;
    this.current = null;
    this.viewer.clear();
    this.updateFileInfo();
    if (current) await current.pdf.close();
  }

  private updateFileInfo(): void {
    const current = this.current;
    this.clearButton.disabled = current === null;
    setText(this.fileInfo, current ? `${current.fileName}（${current.pdf.pages.length} ページ）` : "");
  }

  private setStatus(text: string): void {
    setText(this.statusEl, text);
  }

  private showMessage(kind: MessageKind, text: string): void {
    this.messageEl.dataset["kind"] = kind;
    setText(this.messageText, text);
    this.messageEl.hidden = false;
  }

  private hideMessage(): void {
    this.messageEl.hidden = true;
    setText(this.messageText, "");
  }
}
