import { CHECKLIST_LEAD, CHECKS_SCOPE_NOTE, LEAK_CHECKLIST } from "../config/checklist";
import { sourceLabel, type Candidate } from "../core/candidates";
import { DEFAULT_DPI, DPI_OPTIONS, PREVIEW_WIDTH_PX } from "../config/export";
import { defaultFileName, formatBytes, sanitizeFileName } from "../core/export-plan";
import type { Rect } from "../core/geometry";
import type { ExportProgress, ExportResult } from "../export/pipeline";
import { createCanvas, freeCanvas } from "../pdf/canvas";
import type { OpenedPdf, PageModel } from "../pdf/document";
import { RENDER_SETTINGS } from "../pdf/settings";
import { h } from "./dom";

export function askExportSettings(host: HTMLElement, rectCount: number): Promise<{ dpi: number } | null> {
  return new Promise((resolve) => {
    const radios = DPI_OPTIONS.map((option) => {
      const input = h("input", { attrs: { type: "radio", name: "dpi", value: String(option.dpi), "data-testid": `dpi-${option.dpi}` } });
      input.checked = option.dpi === DEFAULT_DPI;
      return h("label", { className: "radio" }, input, ` ${option.label}`);
    });
    const warning = rectCount === 0
      ? h("p", { className: "warning-text", text: "⚠️ 塗る範囲がまだありません。このまま書き出すと、何も伏せていない PDF になります。" })
      : null;
    const cancel = h("button", { className: "button", text: "やめる", attrs: { type: "button" } });
    const ok = h("button", { className: "button primary", text: "書き出す", attrs: { type: "submit", "data-testid": "export-start" } });
    const form = h(
      "form",
      { attrs: { method: "dialog" } },
      h("p", { text: "ページを画像にして、塗る範囲を黒く塗り、新しい PDF を作ります。処理はすべてこの PC の中で行います。" }),
      h("fieldset", { className: "dpi-options" }, h("legend", { text: "解像度" }), ...radios),
      warning,
      h("div", { className: "dialog-actions" }, cancel, ok),
    );
    const dialog = h(
      "dialog",
      { className: "dialog export-settings", attrs: { "aria-label": "書き出しの設定" } },
      h("h2", { className: "dialog-title", text: "書き出しの設定" }),
      form,
    );
    let settled = false;
    const finish = (value: { dpi: number } | null): void => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const selected = radios.map((label) => label.querySelector("input")!).find((input) => input.checked);
      finish({ dpi: Number(selected?.value ?? DEFAULT_DPI) });
    });
    cancel.addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", () => finish(null));
    host.append(dialog);
    dialog.showModal();
    ok.focus();
  });
}

export class ProgressDialog {
  private readonly dialog: HTMLDialogElement;
  private readonly text: HTMLElement;
  private readonly bar: HTMLProgressElement;

  constructor(host: HTMLElement, onCancel: () => void) {
    this.text = h("p", { attrs: { "data-testid": "progress-text", "aria-live": "polite" }, text: "準備しています…" });
    this.bar = h("progress", { attrs: { max: "1", value: "0" } });
    const cancel = h("button", { className: "button", text: "中止", attrs: { type: "button", "data-testid": "export-cancel" } });
    this.dialog = h(
      "dialog",
      { className: "dialog progress-dialog", attrs: { "aria-label": "書き出しの進み具合", "data-testid": "progress" } },
      h("h2", { className: "dialog-title", text: "書き出しています" }),
      this.text,
      this.bar,
      h("div", { className: "dialog-actions" }, cancel),
    );
    cancel.addEventListener("click", () => {
      cancel.disabled = true;
      this.text.textContent = "中止しています…";
      onCancel();
    });
    this.dialog.addEventListener("cancel", (event) => event.preventDefault());
    host.append(this.dialog);
    this.dialog.showModal();
  }

  update(progress: ExportProgress): void {
    const { phase, done, total } = progress;
    const label =
      phase === "render"
        ? `ページを画像にして、黒く塗っています（${Math.min(done + 1, total)} / ${total} ページ）`
        : phase === "assemble"
          ? "PDF を組み立てています"
          : `書き出した PDF を検査しています（${done} / ${total} ページ）`;
    this.text.textContent = label;
    const weight = phase === "render" ? 0 : phase === "assemble" ? 0.5 : 0.55;
    const span = phase === "render" ? 0.5 : phase === "assemble" ? 0.05 : 0.45;
    this.bar.value = weight + (total > 0 ? (done / total) * span : 0);
  }

  close(): void {
    this.dialog.close();
    this.dialog.remove();
  }
}

export interface ReviewOptions {
  readonly host: HTMLElement;
  readonly source: OpenedPdf;
  readonly result: ExportResult;
  readonly requestedDpi: number;
  readonly onClosed: () => void;
}

interface PreviewSlot {
  readonly row: HTMLElement;
  readonly original: PageModel;
  readonly output: PageModel | null;
  readonly rects: readonly Rect[];
  readonly originalCell: HTMLElement;
  readonly outputCell: HTMLElement;
  rendered: boolean;
}

export class ReviewDialog {
  private readonly dialog: HTMLDialogElement;
  private readonly observer: IntersectionObserver;
  private readonly slots: PreviewSlot[] = [];
  private readonly canvases = new Set<HTMLCanvasElement>();
  private closed = false;

  constructor(private readonly options: ReviewOptions) {
    const { result } = options;
    const verification = result.verification;
    const passed = verification.passed;
    const status = h("p", {
      className: `review-status ${passed ? "ok" : "ng"}`,
      attrs: { "data-testid": "review-status" },
      text: passed
        ? "✅ 自動の検査にすべて合格しました。プレビューで、伏せた箇所を目で確かめてください。"
        : "❌ 合格しなかった検査があります。この PDF はダウンロードできません。",
    });
    const checks = h(
      "ul",
      { className: "checks" },
      ...verification.results.map((r) =>
        h(
          "li",
          { className: `check ${r.ok ? "ok" : "ng"}`, attrs: { "data-testid": `check-${r.id}`, "data-ok": String(r.ok) } },
          h("span", { className: "check-label", text: `${r.ok ? "✅" : "❌"} ${r.label}` }),
          h("span", { className: "check-detail", text: r.detail }),
        ),
      ),
    );
    const reduced = result.plans
      .map((plan, k) => ({ plan, page: result.includedPages[k]! }))
      .filter((x) => x.plan.reduced);
    const reducedNote = reduced.length > 0
      ? h("p", {
          className: "warning-text",
          attrs: { "data-testid": "dpi-reduced" },
          text: `⚠️ 大きいページがあるため、${reduced.map((x) => `${x.page + 1} ページを ${x.plan.dpi} dpi`).join("、")} に下げて書き出しました（ブラウザの描画の上限を超えないようにするため）。`,
        })
      : null;
    const summary = h("p", {
      className: "summary",
      attrs: { "data-testid": "output-summary" },
      text: `${result.includedPages.length} ページ ・ ${formatBytes(result.bytes.byteLength)} ・ ${options.requestedDpi} dpi`,
    });
    const confirm = h("input", { attrs: { type: "checkbox", "data-testid": "confirm" } });
    const fileName = defaultFileName(new Date());
    const nameInput = h("input", {
      className: "text-input",
      attrs: { type: "text", spellcheck: "false", autocomplete: "off", "data-testid": "filename", "aria-label": "ファイル名" },
    });
    nameInput.value = fileName;
    const back = h("button", { className: "button", text: "戻って直す", attrs: { type: "button", "data-testid": "review-back" } });
    const download = h("button", { className: "button primary", text: "⬇ ダウンロード", attrs: { type: "button", "data-testid": "download", disabled: "" } });
    const downloadNote = h("p", { className: "note", attrs: { "data-testid": "download-note", "aria-live": "polite" } });
    const updateDownload = (): void => {
      download.disabled = !(passed && confirm.checked);
    };
    confirm.addEventListener("change", updateDownload);
    download.addEventListener("click", () => {
      if (!passed || !confirm.checked) return;
      const name = sanitizeFileName(nameInput.value, fileName);
      nameInput.value = name;
      this.download(name);
      downloadNote.textContent = `「${name}」をダウンロードしました。保存先と渡し先の管理に気をつけてください。`;
    });
    back.addEventListener("click", () => this.close());

    const side = h(
      "section",
      { className: "review-side" },
      status,
      h("h3", { text: "自動の検査" }),
      checks,
      h("p", { className: "note", text: CHECKS_SCOPE_NOTE }),
      reducedNote,
      summary,
      h("h3", { text: "目で確かめる箇所" }),
      h("p", { className: "note", text: CHECKLIST_LEAD }),
      h("ul", { className: "checklist", attrs: { "data-testid": "checklist" } }, ...LEAK_CHECKLIST.map((item) => h("li", { text: item }))),
      h("label", { className: "confirm" }, confirm, " プレビューを見て、上の箇所が伏せられていることを確かめました"),
      h("label", { className: "filename" }, h("span", { text: "ファイル名" }), nameInput),
      h("div", { className: "dialog-actions" }, back, download),
      downloadNote,
    );

    const previewHead = h(
      "div",
      { className: "preview-head" },
      h("span", { text: "" }),
      h("span", { text: "元の PDF（赤い枠が塗る範囲）" }),
      h("span", { text: "書き出した PDF" }),
    );
    const previewList = h("div", { className: "preview-list" });
    const preview = h("section", { className: "review-preview", attrs: { "data-testid": "review-preview" } }, previewHead, previewList);
    result.includedPages.forEach((pageIndex, k) => {
      const original = options.source.pages[pageIndex]!;
      const output = verification.pdf?.pages[k] ?? null;
      const originalCell = h("div", { className: "preview-cell" });
      const outputCell = h("div", { className: "preview-cell", attrs: { "data-testid": `preview-output-${k}` } });
      const row = h(
        "div",
        { className: "preview-row", dataset: { index: String(k) } },
        h("div", { className: "preview-label", text: `${pageIndex + 1} ページ` }),
        originalCell,
        outputCell,
      );
      previewList.append(row);
      this.slots.push({ row, original, output, rects: result.rects[k] ?? [], originalCell, outputCell, rendered: false });
    });

    this.dialog = h(
      "dialog",
      { className: "dialog review", attrs: { "aria-label": "書き出しの確認", "data-testid": "review" } },
      h("h2", { className: "dialog-title", text: "書き出しの確認" }),
      h("div", { className: "review-body" }, side, preview),
    );
    this.dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.close();
    });
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const slot = this.slots.find((s) => s.row === entry.target);
        if (slot && !slot.rendered) {
          slot.rendered = true;
          void this.renderSlot(slot);
        }
      }
    }, { root: preview, rootMargin: "400px 0px" });
    options.host.append(this.dialog);
    this.dialog.showModal();
    for (const slot of this.slots) this.observer.observe(slot.row);
    updateDownload();
  }

  private async renderPage(page: PageModel, cell: HTMLElement, rects: readonly Rect[] | null): Promise<void> {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const available = Math.max(160, Math.min(PREVIEW_WIDTH_PX, cell.clientWidth || PREVIEW_WIDTH_PX));
    const cssScale = available / Math.max(page.width, page.height * 0.75);
    const scale = cssScale * dpr;
    const viewport = page.proxy.getViewport({ scale });
    const { canvas, context } = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
    this.canvases.add(canvas);
    canvas.className = "preview-canvas";
    canvas.style.width = `${page.width * cssScale}px`;
    await page.proxy.render({ canvas, canvasContext: context, viewport, ...RENDER_SETTINGS }).promise;
    if (rects) {
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.strokeStyle = "rgba(220, 38, 38, 0.95)";
      context.lineWidth = Math.max(2, 2 * dpr);
      context.setLineDash([6 * dpr, 4 * dpr]);
      for (const r of rects) context.strokeRect(r.x * scale, r.y * scale, r.width * scale, r.height * scale);
      context.restore();
    }
    if (this.closed) {
      freeCanvas(canvas);
      return;
    }
    cell.replaceChildren(canvas);
  }

  private async renderSlot(slot: PreviewSlot): Promise<void> {
    try {
      await this.renderPage(slot.original, slot.originalCell, slot.rects);
      if (slot.output) await this.renderPage(slot.output, slot.outputCell, null);
      else slot.outputCell.replaceChildren(h("p", { className: "note", text: "書き出した PDF を表示できませんでした。" }));
      slot.row.dataset["rendered"] = "true";
    } catch (error) {
      if (!this.closed) console.error("プレビューの描画に失敗しました", error);
    }
  }

  private download(name: string): void {
    const blob = new Blob([this.options.result.bytes as BlobPart], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.rel = "noopener";
    this.dialog.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.observer.disconnect();
    for (const canvas of this.canvases) freeCanvas(canvas);
    this.canvases.clear();
    this.dialog.close();
    this.dialog.remove();
    void this.options.result.verification.pdf?.close();
    this.options.onClosed();
  }
}

export function askPendingDecision(host: HTMLElement, pending: readonly Candidate[]): Promise<"apply" | "skip" | "back"> {
  return new Promise((resolve) => {
    const rows = pending.slice(0, 100).map((c) => h("li", { text: `${c.page + 1} ページ：${c.text}（${sourceLabel(c.source)}）` }));
    if (pending.length > 100) rows.push(h("li", { className: "note", text: `ほかに ${pending.length - 100} 件あります。` }));
    const back = h("button", { className: "button", text: "戻って 1 件ずつ確かめる", attrs: { type: "button", "data-testid": "pending-back" } });
    const skip = h("button", { className: "button", text: "すべて塗らずに進む", attrs: { type: "button", "data-testid": "pending-skip" } });
    const apply = h("button", { className: "button primary", text: "すべて塗ってから進む", attrs: { type: "button", "data-testid": "pending-apply" } });
    const dialog = h(
      "dialog",
      { className: "dialog pending-dialog", attrs: { "aria-label": "未確認の候補", "data-testid": "pending-dialog" } },
      h("h2", { className: "dialog-title", text: `未確認の候補が ${pending.length} 件あります` }),
      h("p", { text: "書き出す前に、次の候補を塗るかどうかを決めてください。" }),
      h("ul", { className: "pending-list" }, ...rows),
      h("div", { className: "dialog-actions" }, back, skip, apply),
    );
    let settled = false;
    const finish = (value: "apply" | "skip" | "back"): void => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    back.addEventListener("click", () => finish("back"));
    skip.addEventListener("click", () => finish("skip"));
    apply.addEventListener("click", () => finish("apply"));
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish("back");
    });
    host.append(dialog);
    dialog.showModal();
    back.focus();
  });
}
