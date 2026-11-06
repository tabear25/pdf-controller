import type { Candidate } from "../core/candidates";
import type { EditorStore } from "../core/editor";
import { clampRect, moveWithin, rectFromCorners, type Rect, type Size } from "../core/geometry";
import { MIN_RECT_SIZE, type Redaction } from "../core/redactions";
import { h } from "./dom";
import type { PageView, Viewer } from "./viewer";

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

type Interaction =
  | { kind: "create"; view: PageView; pointerId: number; origin: readonly [number, number]; draft: HTMLDivElement; rect: Rect }
  | { kind: "move"; view: PageView; pointerId: number; id: string; start: readonly [number, number]; base: Rect }
  | { kind: "resize"; view: PageView; pointerId: number; id: string; handle: Handle; base: Rect };

export interface RedactionLayerActions {
  applyToAll(id: string): void;
  created?(redaction: Redaction): void;
}

function fmt(value: number): string {
  return value.toFixed(3);
}

function resizeRect(base: Rect, handle: Handle, x: number, y: number, bounds: Size): Rect {
  let x0 = base.x;
  let y0 = base.y;
  let x1 = base.x + base.width;
  let y1 = base.y + base.height;
  if (handle.includes("w")) x0 = x;
  if (handle.includes("e")) x1 = x;
  if (handle.includes("n")) y0 = y;
  if (handle.includes("s")) y1 = y;
  const rect = clampRect(rectFromCorners(x0, y0, x1, y1), bounds);
  return {
    x: rect.x,
    y: rect.y,
    width: Math.max(rect.width, Math.min(MIN_RECT_SIZE, bounds.width - rect.x)),
    height: Math.max(rect.height, Math.min(MIN_RECT_SIZE, bounds.height - rect.y)),
  };
}

export class RedactionLayer {
  private interaction: Interaction | null = null;
  private readonly elements = new WeakMap<HTMLElement, Map<string, HTMLDivElement>>();
  private readonly candidateElements = new WeakMap<HTMLElement, Map<string, HTMLDivElement>>();
  private readonly attached = new WeakSet<HTMLElement>();

  constructor(
    private readonly viewer: Viewer,
    private readonly store: EditorStore,
    private readonly actions: RedactionLayerActions,
  ) {
    store.subscribe(() => this.render());
    viewer.onLayout(() => {
      for (const view of viewer.pageViews) this.attach(view);
      this.render();
    });
  }

  get busy(): boolean {
    return this.interaction !== null;
  }

  cancelInteraction(): void {
    const current = this.interaction;
    if (!current) return;
    this.interaction = null;
    if (current.kind === "create") current.draft.remove();
    else this.store.cancelPreview();
    if (current.view.overlay.hasPointerCapture(current.pointerId)) current.view.overlay.releasePointerCapture(current.pointerId);
  }

  private attach(view: PageView): void {
    if (this.attached.has(view.overlay)) return;
    this.attached.add(view.overlay);
    view.overlay.addEventListener("pointerdown", (e) => this.onPointerDown(e, view));
    view.overlay.addEventListener("pointermove", (e) => this.onPointerMove(e));
    view.overlay.addEventListener("pointerup", (e) => this.onPointerUp(e));
    view.overlay.addEventListener("pointercancel", () => this.cancelInteraction());
    view.overlay.addEventListener("lostpointercapture", () => {
      if (this.interaction?.view === view) this.onPointerUpInternal();
    });
  }

  private toDisplay(event: PointerEvent, view: PageView): readonly [number, number] {
    const box = view.overlay.getBoundingClientRect();
    const scale = this.viewer.currentScale;
    const x = Math.min(Math.max((event.clientX - box.left) / scale, 0), view.model.width);
    const y = Math.min(Math.max((event.clientY - box.top) / scale, 0), view.model.height);
    return [x, y];
  }

  private sizeOf(view: PageView): Size {
    return { width: view.model.width, height: view.model.height };
  }

  private onPointerDown(event: PointerEvent, view: PageView): void {
    if (event.button !== 0 || this.interaction) return;
    const target = event.target as HTMLElement;
    if (target.closest(".rect-actions")) return;
    const rectEl = target.closest<HTMLElement>(".redaction");
    const handleEl = target.closest<HTMLElement>(".handle");
    const point = this.toDisplay(event, view);
    event.preventDefault();
    view.overlay.setPointerCapture(event.pointerId);
    const id = rectEl?.dataset["id"];
    const existing = id ? this.store.redactions.find((r) => r.id === id) : undefined;
    if (existing && handleEl) {
      this.interaction = { kind: "resize", view, pointerId: event.pointerId, id: existing.id, handle: handleEl.dataset["handle"] as Handle, base: existing };
      return;
    }
    if (existing) {
      this.store.select(existing.id);
      this.interaction = { kind: "move", view, pointerId: event.pointerId, id: existing.id, start: point, base: existing };
      return;
    }
    this.store.select(null);
    const draft = h("div", { className: "redaction draft" });
    view.overlay.append(draft);
    const rect = { x: point[0], y: point[1], width: 0, height: 0 };
    this.interaction = { kind: "create", view, pointerId: event.pointerId, origin: point, draft, rect };
    this.position(draft, rect);
  }

  private onPointerMove(event: PointerEvent): void {
    const current = this.interaction;
    if (!current || event.pointerId !== current.pointerId) return;
    const [x, y] = this.toDisplay(event, current.view);
    const bounds = this.sizeOf(current.view);
    if (current.kind === "create") {
      current.rect = clampRect(rectFromCorners(current.origin[0], current.origin[1], x, y), bounds);
      this.position(current.draft, current.rect);
    } else if (current.kind === "move") {
      this.store.preview(current.id, moveWithin(current.base, x - current.start[0], y - current.start[1], bounds));
    } else {
      this.store.preview(current.id, resizeRect(current.base, current.handle, x, y, bounds));
    }
  }

  private onPointerUp(event: PointerEvent): void {
    const current = this.interaction;
    if (!current || event.pointerId !== current.pointerId) return;
    this.onPointerMove(event);
    this.onPointerUpInternal();
  }

  private onPointerUpInternal(): void {
    const current = this.interaction;
    if (!current) return;
    this.interaction = null;
    if (current.view.overlay.hasPointerCapture(current.pointerId)) current.view.overlay.releasePointerCapture(current.pointerId);
    if (current.kind === "create") {
      current.draft.remove();
      if (current.rect.width >= MIN_RECT_SIZE && current.rect.height >= MIN_RECT_SIZE) {
        const created = this.store.add(current.view.model.index, current.rect, "manual");
        this.actions.created?.(created);
      }
      return;
    }
    this.store.finishPreview();
  }

  private position(el: HTMLElement, rect: Rect): void {
    const scale = this.viewer.currentScale;
    el.style.left = `${rect.x * scale}px`;
    el.style.top = `${rect.y * scale}px`;
    el.style.width = `${rect.width * scale}px`;
    el.style.height = `${rect.height * scale}px`;
  }

  render(): void {
    const byPage = new Map<number, Redaction[]>();
    for (const r of this.store.redactions) {
      const list = byPage.get(r.page) ?? [];
      list.push(r);
      byPage.set(r.page, list);
    }
    const candidatesByPage = new Map<number, Candidate[]>();
    for (const c of this.store.pendingCandidates) {
      const list = candidatesByPage.get(c.page) ?? [];
      list.push(c);
      candidatesByPage.set(c.page, list);
    }
    for (const view of this.viewer.pageViews) {
      this.renderPage(view, byPage.get(view.model.index) ?? []);
      this.renderCandidates(view, candidatesByPage.get(view.model.index) ?? []);
    }
  }

  flashCandidate(id: string): void {
    for (const view of this.viewer.pageViews) {
      for (const el of view.overlay.querySelectorAll<HTMLElement>(".candidate-rect")) {
        if (el.dataset["candidateId"] !== id) continue;
        el.classList.remove("flash");
        void el.offsetWidth;
        el.classList.add("flash");
      }
    }
  }

  private renderCandidates(view: PageView, candidates: readonly Candidate[]): void {
    let map = this.candidateElements.get(view.overlay);
    if (!map) {
      map = new Map();
      this.candidateElements.set(view.overlay, map);
    }
    const alive = new Set<string>();
    for (const c of candidates) {
      c.rects.forEach((rect, k) => {
        const key = `${c.id}:${k}`;
        alive.add(key);
        let el = map.get(key);
        if (!el) {
          el = h("div", { className: "candidate-rect", dataset: { candidateId: c.id, page: String(c.page) }, attrs: { "aria-hidden": "true", "data-testid": "candidate-rect" } });
          map.set(key, el);
          view.overlay.prepend(el);
        }
        this.position(el, rect);
        el.dataset["x"] = fmt(rect.x);
        el.dataset["y"] = fmt(rect.y);
        el.dataset["w"] = fmt(rect.width);
        el.dataset["h"] = fmt(rect.height);
      });
    }
    for (const [key, el] of map) {
      if (!alive.has(key)) {
        el.remove();
        map.delete(key);
      }
    }
  }

  private renderPage(view: PageView, redactions: readonly Redaction[]): void {
    let map = this.elements.get(view.overlay);
    if (!map) {
      map = new Map();
      this.elements.set(view.overlay, map);
    }
    const alive = new Set(redactions.map((r) => r.id));
    for (const [id, el] of map) {
      if (!alive.has(id)) {
        el.remove();
        map.delete(id);
      }
    }
    for (const r of redactions) {
      let el = map.get(r.id);
      if (!el) {
        el = h("div", {
          className: "redaction",
          dataset: { id: r.id, page: String(r.page) },
          attrs: { role: "img", "aria-label": `${r.page + 1} ページの塗る範囲`, "data-testid": "redaction" },
        });
        map.set(r.id, el);
        view.overlay.append(el);
      }
      this.position(el, r);
      el.dataset["x"] = fmt(r.x);
      el.dataset["y"] = fmt(r.y);
      el.dataset["w"] = fmt(r.width);
      el.dataset["h"] = fmt(r.height);
      el.dataset["source"] = r.source;
      const selected = this.store.selectedId === r.id;
      el.classList.toggle("selected", selected);
      if (selected && el.childElementCount === 0) this.decorate(el, r.id);
      if (!selected && el.childElementCount > 0) el.replaceChildren();
    }
  }

  private decorate(el: HTMLDivElement, id: string): void {
    for (const handle of HANDLES) {
      el.append(h("div", { className: `handle handle-${handle}`, dataset: { handle } }));
    }
    const applyButton = h("button", {
      className: "button small",
      text: "全ページの同じ位置に適用",
      attrs: { type: "button", "data-testid": "apply-all" },
    });
    const deleteButton = h("button", {
      className: "button small danger",
      text: "削除",
      attrs: { type: "button", "data-testid": "delete-rect" },
    });
    applyButton.addEventListener("click", () => this.actions.applyToAll(id));
    deleteButton.addEventListener("click", () => this.store.remove(id));
    el.append(h("div", { className: "rect-actions" }, applyButton, deleteButton));
  }
}
