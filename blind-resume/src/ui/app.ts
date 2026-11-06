import { InvalidPDFException, PasswordException } from "pdfjs-dist";
import buildInfo from "virtual:build-info";
import licenseText from "virtual:licenses";
import { APP_TITLE, CSS_PX_PER_PT, MAX_FILE_BYTES, ZOOM_STEPS } from "../config/app";
import { PRIVACY_NOTE, USAGE_STEPS, USAGE_TIPS } from "../config/help";
import { EditorStore } from "../core/editor";
import { moveWithin } from "../core/geometry";
import { formatPageList } from "../core/redactions";
import { textInRect } from "../core/text-index";
import { openPdf, PasswordCancelledError, type OpenedPdf } from "../pdf/document";
import { missingBrowserFeatures } from "../pdf/support";
import { buildTextIndexes, type TextIndexes } from "../pdf/text";
import { CandidatePanel } from "./candidate-panel";
import { PageControls } from "./page-controls";
import { collectInfoValues, ExportCancelledError, runExport } from "../export/pipeline";
import { askPasswordDialog, createDialog } from "./dialogs";
import { askExportSettings, askPendingDecision, ProgressDialog, ReviewDialog } from "./export-flow";
import { h, setText } from "./dom";
import { RedactionLayer } from "./redaction-layer";
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

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export class App {
  private readonly viewer: Viewer;
  private readonly store = new EditorStore();
  private readonly layer: RedactionLayer;
  private readonly candidatePanel: CandidatePanel;
  private textIndexes: TextIndexes | null = null;
  private readonly fileInput: HTMLInputElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly exportButton: HTMLButtonElement;
  private readonly zoomButtons: HTMLButtonElement[];
  private readonly zoomLevel: HTMLElement;
  private readonly usage: HTMLDetailsElement;
  private readonly fileInfo: HTMLElement;
  private readonly messageEl: HTMLElement;
  private readonly messageText: HTMLElement;
  private readonly dropOverlay: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly rectCount: HTMLElement;
  private readonly selectionBox: HTMLElement;
  private readonly selectionText: HTMLElement;
  private current: CurrentDocument | null = null;
  private loadSeq = 0;
  private exporting = false;

  constructor(private readonly root: HTMLElement) {
    this.fileInput = h("input", {
      className: "visually-hidden",
      attrs: { type: "file", accept: ".pdf,application/pdf", "aria-label": "PDF ファイルを選ぶ", "data-testid": "file-input" },
    });
    const openButton = h("button", { className: "button primary", text: "📄 PDF を開く", attrs: { type: "button", "data-testid": "open" } });
    this.clearButton = h("button", { className: "button", text: "クリア", attrs: { type: "button", disabled: "", "data-testid": "clear" } });
    this.undoButton = h("button", {
      className: "button",
      text: "↶ 元に戻す",
      attrs: { type: "button", disabled: "", title: "元に戻す（Ctrl+Z、⌘Z）", "data-testid": "undo" },
    });
    this.redoButton = h("button", {
      className: "button",
      text: "↷ やり直す",
      attrs: { type: "button", disabled: "", title: "やり直す（Ctrl+Y、Ctrl+Shift+Z、⌘⇧Z）", "data-testid": "redo" },
    });
    this.exportButton = h("button", {
      className: "button primary",
      text: "⬇ 書き出す",
      attrs: { type: "button", disabled: "", "data-testid": "export" },
    });
    const zoomOut = h("button", { className: "button", text: "−", attrs: { type: "button", title: "縮小", "aria-label": "縮小", "data-testid": "zoom-out" } });
    const zoomIn = h("button", { className: "button", text: "＋", attrs: { type: "button", title: "拡大", "aria-label": "拡大", "data-testid": "zoom-in" } });
    const zoomFit = h("button", { className: "button", text: "幅に合わせる", attrs: { type: "button", "data-testid": "zoom-fit" } });
    this.zoomLevel = h("span", { className: "zoom-level", attrs: { "data-testid": "zoom-level", "aria-live": "polite" } });
    this.zoomButtons = [zoomOut, zoomIn, zoomFit];
    zoomOut.addEventListener("click", () => this.zoomStep(-1));
    zoomIn.addEventListener("click", () => this.zoomStep(1));
    zoomFit.addEventListener("click", () => this.viewer.fitWidth());
    this.fileInfo = h("span", { className: "file-info", attrs: { "data-testid": "file-info" } });
    this.statusEl = h("span", { className: "status", attrs: { role: "status", "aria-live": "polite" } });
    this.messageText = h("span", { className: "message-text" });
    const dismiss = h("button", { className: "button small", text: "閉じる", attrs: { type: "button" } });
    this.messageEl = h("div", { className: "message", attrs: { role: "alert", hidden: "", "data-testid": "message" } }, this.messageText, dismiss);
    const empty = h(
      "div",
      { className: "empty-state" },
      h("p", { className: "empty-title", text: "ここに PDF をドラッグ＆ドロップするか、「PDF を開く」を押してください。" }),
      h("p", { className: "empty-note", text: PRIVACY_NOTE }),
    );
    this.viewer = new Viewer(empty);
    this.layer = new RedactionLayer(this.viewer, this.store, {
      applyToAll: (id) => this.applyToAll(id),
      created: (redaction) => {
        const index = this.textIndexes?.indexes[redaction.page];
        if (index) this.candidatePanel.suggest(textInRect(index, redaction));
      },
    });
    this.candidatePanel = new CandidatePanel(this.store, {
      reveal: (candidate) => {
        const first = candidate.rects[0];
        if (first) this.viewer.scrollToArea(candidate.page, first.y);
        this.layer.flashCandidate(candidate.id);
      },
    });
    this.dropOverlay = h("div", { className: "drop-overlay", attrs: { hidden: "" } }, h("p", { text: "ここに PDF をドロップ" }));

    const licensesDialog = createDialog("licenses", "第三者ライセンス", h("pre", { className: "license-text", text: licenseText }));
    const licensesButton = h("button", { className: "link-button", text: "第三者ライセンス", attrs: { type: "button", "data-testid": "licenses" } });

    this.rectCount = h("p", { className: "rect-count", attrs: { "data-testid": "rect-count" } });
    this.selectionText = h("p", { className: "selection-text" });
    const applyAll = h("button", { className: "button small", text: "全ページの同じ位置に適用", attrs: { type: "button", "data-testid": "panel-apply-all" } });
    const deleteSelected = h("button", { className: "button small danger", text: "削除", attrs: { type: "button", "data-testid": "panel-delete" } });
    this.selectionBox = h("div", { className: "selection-box", attrs: { hidden: "" } }, this.selectionText, h("div", { className: "button-row" }, applyAll, deleteSelected));

    this.usage = h(
      "details",
      { className: "panel-section usage-section", attrs: { open: "", "data-testid": "usage" } },
      h("summary", { className: "panel-title", text: "使い方" }),
      h("ol", { className: "usage" }, ...USAGE_STEPS.map((step) => h("li", { text: step }))),
      h("ul", { className: "tips" }, ...USAGE_TIPS.map((tip) => h("li", { text: tip }))),
    );
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
      h("span", { className: "separator" }),
      this.undoButton,
      this.redoButton,
      h("span", { className: "separator" }),
      zoomOut,
      this.zoomLevel,
      zoomIn,
      zoomFit,
      this.fileInfo,
      h("span", { className: "spacer" }),
      this.statusEl,
      this.exportButton,
    );
    const side = h(
      "aside",
      { className: "side-panel", attrs: { "aria-label": "操作の補助" } },
      h(
        "section",
        { className: "panel-section", attrs: { "data-testid": "rect-panel" } },
        h("h2", { className: "panel-title", text: "塗る範囲" }),
        h("p", { className: "hint", text: "ページ上をドラッグすると、塗る範囲を作れます。範囲は動かしたり、角や辺をつかんで大きさを変えたりできます。Delete キーで削除、Ctrl+Z（⌘Z）で元に戻せます。" }),
        this.rectCount,
        this.selectionBox,
      ),
      this.candidatePanel.element,
      this.usage,
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
    this.exportButton.addEventListener("click", () => void this.startExport());
    this.undoButton.addEventListener("click", () => this.store.undo());
    this.redoButton.addEventListener("click", () => this.store.redo());
    applyAll.addEventListener("click", () => {
      const id = this.store.selectedId;
      if (id) this.applyToAll(id);
    });
    deleteSelected.addEventListener("click", () => {
      const id = this.store.selectedId;
      if (id) this.store.remove(id);
    });
    dismiss.addEventListener("click", () => this.hideMessage());
    licensesButton.addEventListener("click", () => licensesDialog.showModal());
    new PageControls(this.viewer, this.store);
    this.viewer.onLayout((scale) => setText(this.zoomLevel, `${Math.round((scale / CSS_PX_PER_PT) * 100)}%`));
    this.store.subscribe(() => this.updateEditorUi());
    this.installDropTarget();
    this.installKeyboard();
    this.updateEditorUi();
    const missing = missingBrowserFeatures();
    if (missing.length > 0) {
      openButton.disabled = true;
      this.showMessage("error", `このブラウザは古いため使えません。Chrome か Edge を最新版に更新してください（足りない機能：${missing.join("、")}）。`);
    }
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

  private installKeyboard(): void {
    document.addEventListener("keydown", (event) => {
      if (isTypingTarget(event.target) || document.querySelector("dialog[open]")) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z" && !event.shiftKey) {
        event.preventDefault();
        this.layer.cancelInteraction();
        this.store.undo();
        return;
      }
      if ((mod && key === "z" && event.shiftKey) || (event.ctrlKey && key === "y")) {
        event.preventDefault();
        this.layer.cancelInteraction();
        this.store.redo();
        return;
      }
      if (event.key === "Escape") {
        this.layer.cancelInteraction();
        this.store.select(null);
        return;
      }
      const selected = this.store.selectedRedaction;
      if (!selected || this.layer.busy) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        this.store.remove(selected.id);
        return;
      }
      const step = event.shiftKey ? 10 : 1;
      const delta: Record<string, readonly [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const move = delta[event.key];
      const size = this.store.sizes[selected.page];
      if (move && size) {
        event.preventDefault();
        this.store.update(selected.id, moveWithin(selected, move[0], move[1], size));
      }
    });
  }

  private applyToAll(id: string): void {
    const result = this.store.applyToAll(id);
    const parts: string[] = [];
    if (result.added.length > 0) parts.push(`${formatPageList(result.added)} ページに、同じ位置の範囲を追加しました。`);
    if (result.alreadyPresent.length > 0) parts.push(`${formatPageList(result.alreadyPresent)} ページには、すでに同じ範囲があります。`);
    if (result.skipped.length > 0) parts.push(`サイズや向きが違うため、${formatPageList(result.skipped)} ページには適用しませんでした。`);
    if (parts.length === 0) parts.push("ほかのページがないため、適用するページがありません。");
    this.showMessage(result.skipped.length > 0 ? "warning" : "info", parts.join(""));
  }

  private zoomStep(direction: 1 | -1): void {
    const percent = (this.viewer.currentScale / CSS_PX_PER_PT) * 100;
    const steps = direction > 0 ? ZOOM_STEPS.filter((z) => z > percent + 0.5) : ZOOM_STEPS.filter((z) => z < percent - 0.5).reverse();
    const next = steps[0];
    if (next !== undefined) this.viewer.setScale((next / 100) * CSS_PX_PER_PT);
  }

  private async startExport(): Promise<void> {
    const current = this.current;
    if (!current || this.exporting) return;
    this.layer.cancelInteraction();
    const includedPages = current.pdf.pages.map((p) => p.index).filter((i) => !this.store.isExcluded(i));
    if (includedPages.length === 0) {
      this.showMessage("error", "書き出すページがありません。少なくとも 1 ページは「このページを書き出す」にチェックを入れてください。");
      return;
    }
    const pending = this.store.pendingCandidates.filter((c) => includedPages.includes(c.page));
    if (pending.length > 0) {
      const choice = await askPendingDecision(this.root, pending);
      if (choice === "back" || this.current !== current) return;
      this.store.decide(
        pending.map((c) => c.id),
        choice,
      );
    }
    const settings = await askExportSettings(this.root, this.store.redactions.length);
    if (!settings || this.current !== current) return;
    this.exporting = true;
    this.updateFileInfo();
    this.hideMessage();
    const controller = new AbortController();
    const progress = new ProgressDialog(this.root, () => controller.abort());
    try {
      const originalInfoValues = await collectInfoValues(current.pdf);
      const result = await runExport(
        current.pdf,
        { dpi: settings.dpi, includedPages, redactions: this.store.redactions, originalInfoValues },
        (p) => progress.update(p),
        controller.signal,
      );
      progress.close();
      new ReviewDialog({
        host: this.root,
        source: current.pdf,
        result,
        requestedDpi: settings.dpi,
        onClosed: () => {
          this.exporting = false;
          this.updateFileInfo();
        },
      });
    } catch (error) {
      progress.close();
      this.exporting = false;
      this.updateFileInfo();
      if (error instanceof ExportCancelledError) {
        this.showMessage("info", "書き出しを中止しました。");
      } else {
        console.error("書き出しに失敗しました", error);
        this.showMessage("error", `書き出しに失敗しました。${error instanceof Error ? error.message : ""}`);
      }
    }
  }

  private updateEditorUi(): void {
    this.undoButton.disabled = !this.store.canUndo;
    this.redoButton.disabled = !this.store.canRedo;
    const count = this.store.redactions.length;
    setText(this.rectCount, this.current ? `塗る範囲：${count} 件` : "PDF を開くと、ここに塗る範囲の数が出ます。");
    const selected = this.store.selectedRedaction;
    this.selectionBox.hidden = selected === null;
    if (selected) {
      setText(this.selectionText, `選択中：${selected.page + 1} ページの範囲（幅 ${selected.width.toFixed(1)}pt、高さ ${selected.height.toFixed(1)}pt）`);
    }
  }

  private async openFile(file: File): Promise<void> {
    if (missingBrowserFeatures().length > 0) return;
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
      this.store.reset(pdf.pages.map((p) => ({ width: p.width, height: p.height })));
      this.viewer.setPages(pdf.pages);
      this.updateFileInfo();
      this.setStatus("");
      this.candidatePanel.setText(null, true);
      this.usage.open = false;
      void this.loadText(seq, pdf);
    } catch (error) {
      if (seq !== this.loadSeq) return;
      if (!(error instanceof PasswordCancelledError)) console.error("PDF を開けませんでした", error);
      this.setStatus("");
      this.showMessage("error", describeOpenError(error));
    }
  }

  private async loadText(seq: number, pdf: OpenedPdf): Promise<void> {
    try {
      const result = await buildTextIndexes(pdf.pages, () => seq === this.loadSeq && this.current?.pdf === pdf);
      if (!result) return;
      this.textIndexes = result;
      this.candidatePanel.setText(result, false);
    } catch (error) {
      if (seq !== this.loadSeq) return;
      console.error("文字の情報を読み取れませんでした", error);
      this.candidatePanel.setText(null, false);
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
    this.layer.cancelInteraction();
    this.textIndexes = null;
    this.candidatePanel.setText(null, false);
    this.store.reset([]);
    this.viewer.clear();
    this.updateFileInfo();
    if (current) await current.pdf.close();
  }

  private updateFileInfo(): void {
    const current = this.current;
    this.clearButton.disabled = current === null || this.exporting;
    this.exportButton.disabled = current === null || this.exporting;
    for (const button of this.zoomButtons) button.disabled = current === null;
    if (!current) setText(this.zoomLevel, "");
    setText(this.fileInfo, current ? `${current.fileName}（${current.pdf.pages.length} ページ）` : "");
    this.updateEditorUi();
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
