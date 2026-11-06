import { searchDrafts, sourceLabel, type Candidate, type CandidateDraft } from "../core/candidates";
import { DETECTORS, detectDrafts, type DetectorId } from "../core/detectors";
import type { EditorStore } from "../core/editor";
import { normalizeQuery } from "../core/normalize";
import { formatPageList } from "../core/redactions";
import type { TextIndexes } from "../pdf/text";
import { h, setText } from "./dom";

const LIST_LIMIT = 200;

export interface CandidatePanelHost {
  reveal(candidate: Candidate): void;
}

export class CandidatePanel {
  readonly element: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly runButton: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly availability: HTMLElement;
  private readonly count: HTMLElement;
  private readonly list: HTMLElement;
  private readonly applyAll: HTMLButtonElement;
  private readonly skipAll: HTMLButtonElement;
  private readonly detectorBoxes = new Map<DetectorId, HTMLInputElement>();
  private readonly detectRun: HTMLButtonElement;
  private readonly detectStatus: HTMLElement;
  private text: TextIndexes | null = null;
  private autoFilled = true;
  private autoDetected = false;

  constructor(private readonly store: EditorStore, private readonly host: CandidatePanelHost) {
    this.input = h("input", {
      className: "text-input",
      attrs: { type: "search", spellcheck: "false", autocomplete: "off", placeholder: "例：氏名、ふりがな、ローマ字表記、学校名", "data-testid": "search-input", "aria-label": "検索語" },
    });
    this.runButton = h("button", { className: "button", text: "🔎 検索", attrs: { type: "submit", "data-testid": "search-run" } });
    const form = h("form", { className: "search-form", attrs: { role: "search" } }, this.input, this.runButton);
    this.status = h("p", { className: "note", attrs: { "data-testid": "search-status", "aria-live": "polite" } });
    this.availability = h("p", { className: "note", attrs: { "data-testid": "text-availability" } });
    this.count = h("p", { className: "rect-count", attrs: { "data-testid": "candidate-count" } });
    this.applyAll = h("button", { className: "button small", text: "すべて塗る", attrs: { type: "button", "data-testid": "apply-all-candidates" } });
    this.skipAll = h("button", { className: "button small", text: "すべて塗らない", attrs: { type: "button", "data-testid": "skip-all-candidates" } });
    this.list = h("ul", { className: "candidate-list", attrs: { "data-testid": "candidate-list" } });
    const options = DETECTORS.map((d) => {
      const box = h("input", { attrs: { type: "checkbox", "data-testid": `detector-${d.id}` } });
      box.checked = d.defaultEnabled;
      this.detectorBoxes.set(d.id, box);
      return h("label", { className: "detector-option" }, box, ` ${d.label}`);
    });
    this.detectRun = h("button", { className: "button small", text: "この設定で探す", attrs: { type: "button", "data-testid": "detect-run" } });
    this.detectStatus = h("p", { className: "note", attrs: { "data-testid": "detect-status", "aria-live": "polite" } });
    const detectors = h(
      "div",
      { className: "detectors" },
      h("p", { className: "panel-subtitle", text: "自動で見つける候補" }),
      h("p", { className: "note", text: "開いたときに、メールアドレス、電話番号、郵便番号、URL、年齢を自動で探します。日付・年号は候補が多くなるので、必要なときだけ選んでください。" }),
      h("div", { className: "detector-options" }, ...options),
      this.detectRun,
      this.detectStatus,
    );
    this.element = h(
      "section",
      { className: "panel-section", attrs: { "data-testid": "candidate-panel" } },
      h("h2", { className: "panel-title", text: "同じ文字列を探す" }),
      h("p", { className: "hint", text: "範囲を作ると、範囲の中の文字がここに入ります。必要なら直してから「検索」を押すと、文書全体から同じ文字列を探して、未確認の候補として示します。ふりがなやローマ字表記、学校名などを直接入力して探すこともできます。" }),
      form,
      h("p", { className: "note", text: "全角と半角、空白の有無、英字の大文字と小文字、ひらがなとカタカナ、ハイフンの種類の違いは区別しません。" }),
      this.availability,
      this.status,
      detectors,
      this.count,
      h("div", { className: "button-row" }, this.applyAll, this.skipAll),
      this.list,
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.runSearch();
    });
    this.input.addEventListener("input", () => {
      this.autoFilled = false;
    });
    this.detectRun.addEventListener("click", () => this.runDetection(false));
    this.applyAll.addEventListener("click", () => this.decideAll("apply"));
    this.skipAll.addEventListener("click", () => this.decideAll("skip"));
    store.subscribe(() => this.render());
    this.setText(null, false);
  }

  setText(text: TextIndexes | null, loading: boolean): void {
    this.text = text;
    const usable = text?.indexes.some((i) => i?.hasText) ?? false;
    this.input.disabled = !usable;
    this.runButton.disabled = !usable;
    this.detectRun.disabled = !usable;
    for (const box of this.detectorBoxes.values()) box.disabled = !usable;
    if (loading) {
      setText(this.availability, "文字の情報を読み取っています…");
    } else if (!text) {
      setText(this.availability, "");
    } else if (!usable) {
      setText(this.availability, "⚠️ この PDF には文字の情報がないため（スキャンした PDF など）、同じ文字列の検索は使えません。伏せたい範囲は、手でドラッグして指定してください。");
    } else {
      const notes: string[] = [];
      if (text.pagesWithoutText.length > 0) notes.push(`${formatPageList(text.pagesWithoutText)} ページには文字の情報がないため、検索の対象になりません。`);
      if (text.unverifiedPages.length > 0) notes.push(`${formatPageList(text.unverifiedPages)} ページは座標の変換を確かめられなかったため、検索の対象から外しました。`);
      setText(this.availability, notes.join(""));
    }
    if (!text) {
      this.input.value = "";
      this.autoFilled = true;
      this.autoDetected = false;
      setText(this.status, "");
      setText(this.detectStatus, "");
    } else if (usable && !this.autoDetected) {
      this.autoDetected = true;
      this.runDetection(true);
    }
    this.render();
  }

  private runDetection(seed: boolean): void {
    if (!this.text) return;
    const enabled = new Set<DetectorId>([...this.detectorBoxes].filter(([, box]) => box.checked).map(([id]) => id));
    if (enabled.size === 0) {
      setText(this.detectStatus, "探す種類を 1 つ以上選んでください。");
      return;
    }
    const drafts = detectDrafts(this.text.indexes, enabled);
    const result = seed ? this.store.seedCandidates(drafts) : this.store.addCandidates(drafts);
    const counts = new Map<string, number>();
    for (const d of drafts as CandidateDraft[]) {
      const label = sourceLabel(d.source);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const found = [...counts].map(([label, n]) => `${label} ${n} 件`).join("、");
    const parts = [found ? `${found}を見つけました。` : "該当するものは見つかりませんでした。"];
    if (result.added > 0) parts.push(`${result.added} 件を未確認の候補に加えました。`);
    if (result.covered > 0) parts.push(`すでに塗る範囲に含まれている ${result.covered} 件は除きました。`);
    setText(this.detectStatus, parts.join(""));
  }

  suggest(text: string): void {
    if (!text || this.input.disabled) return;
    if (!this.autoFilled && this.input.value.trim().length > 0) return;
    this.input.value = text;
    this.autoFilled = true;
    setText(this.status, `選んだ範囲の文字「${text}」を検索語に入れました。必要なら直してから「検索」を押してください。`);
  }

  private runSearch(): void {
    const query = this.input.value.trim();
    if (!this.text || query.length === 0) return;
    if (normalizeQuery(query).length === 0) {
      setText(this.status, "検索語に、探せる文字がありません。");
      return;
    }
    const drafts = searchDrafts(this.text.indexes, query);
    const result = this.store.addCandidates(drafts);
    const parts = [`「${query}」は ${drafts.length} 件見つかりました。`];
    if (result.added > 0) parts.push(`${result.added} 件を未確認の候補に加えました。`);
    if (result.covered > 0) parts.push(`すでに塗る範囲に含まれている ${result.covered} 件は、候補から除きました。`);
    if (result.duplicates > 0) parts.push(`${result.duplicates} 件は、すでに候補にあります。`);
    setText(this.status, parts.join(""));
  }

  private decideAll(decision: "apply" | "skip"): void {
    const ids = this.store.pendingCandidates.map((c) => c.id);
    if (ids.length > 0) this.store.decide(ids, decision);
  }

  private render(): void {
    const pending = this.store.pendingCandidates;
    const decided = this.store.candidates.filter((c) => c.decision !== "pending");
    const applied = decided.filter((c) => c.decision === "apply").length;
    const skipped = decided.length - applied;
    setText(
      this.count,
      `未確認の候補：${pending.length} 件` + (decided.length > 0 ? `（塗った ${applied} 件、塗らない ${skipped} 件）` : ""),
    );
    this.applyAll.disabled = pending.length === 0;
    this.skipAll.disabled = pending.length === 0;
    const items = pending.slice(0, LIST_LIMIT).map((c) => {
      const label = h("button", { className: "link-button candidate-text", text: c.text || "（空白）", attrs: { type: "button", title: "この候補の位置を表示" } });
      const apply = h("button", { className: "button small", text: "塗る", attrs: { type: "button", "data-testid": "candidate-apply" } });
      const skip = h("button", { className: "button small", text: "塗らない", attrs: { type: "button", "data-testid": "candidate-skip" } });
      label.addEventListener("click", () => this.host.reveal(c));
      apply.addEventListener("click", () => this.store.decide([c.id], "apply"));
      skip.addEventListener("click", () => this.store.decide([c.id], "skip"));
      return h(
        "li",
        { className: "candidate", dataset: { id: c.id, page: String(c.page) }, attrs: { "data-testid": "candidate" } },
        label,
        h("span", { className: "candidate-meta", text: `${c.page + 1} ページ ・ ${sourceLabel(c.source)}` }),
        h("span", { className: "candidate-actions" }, apply, skip),
      );
    });
    if (pending.length > LIST_LIMIT) {
      items.push(h("li", { className: "note", text: `ほかに ${pending.length - LIST_LIMIT} 件あります。` }));
    }
    this.list.replaceChildren(...items);
  }
}
