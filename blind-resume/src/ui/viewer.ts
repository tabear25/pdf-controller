import { RenderingCancelledException, type RenderTask } from "pdfjs-dist";
import {
  CSS_PX_PER_PT,
  DISPLAY_MAX_CANVAS_PIXELS,
  FIT_WIDTH_MAX_SCALE,
  LAZY_RENDER_MARGIN_PX,
  ZOOM_LIMITS,
} from "../config/app";
import type { PageModel } from "../pdf/document";
import { RENDER_SETTINGS } from "../pdf/settings";
import { freeCanvas } from "../pdf/canvas";
import { h } from "./dom";

type RenderState = "pending" | "rendering" | "rendered" | "error";

export interface PageView {
  readonly model: PageModel;
  readonly root: HTMLDivElement;
  readonly overlay: HTMLDivElement;
}

interface PageSlot extends PageView {
  canvas: HTMLCanvasElement | null;
  renderedFor: number;
  task: RenderTask | null;
  visible: boolean;
  generation: number;
}

export type FitMode = "width" | "manual";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class Viewer {
  readonly element: HTMLDivElement;
  private readonly pagesEl: HTMLDivElement;
  private readonly emptyEl: HTMLElement;
  private slots: PageSlot[] = [];
  private observer: IntersectionObserver | null = null;
  private readonly resizeObserver: ResizeObserver;
  private scale = CSS_PX_PER_PT;
  private fit: FitMode = "width";
  private readonly layoutListeners = new Set<(scale: number) => void>();

  constructor(emptyContent: HTMLElement) {
    this.emptyEl = emptyContent;
    this.pagesEl = h("div", { className: "pages" });
    this.element = h(
      "div",
      { className: "viewer", attrs: { tabindex: "-1", "aria-label": "ページの表示" } },
      this.emptyEl,
      this.pagesEl,
    );
    this.resizeObserver = new ResizeObserver(() => {
      if (this.fit === "width" && this.slots.length > 0) this.setScaleInternal(this.fitWidthScale());
    });
    this.resizeObserver.observe(this.element);
  }

  get pageViews(): readonly PageView[] {
    return this.slots;
  }

  get currentScale(): number {
    return this.scale;
  }

  get fitMode(): FitMode {
    return this.fit;
  }

  onLayout(listener: (scale: number) => void): () => void {
    this.layoutListeners.add(listener);
    return () => this.layoutListeners.delete(listener);
  }

  setPages(pages: readonly PageModel[]): void {
    this.clear();
    this.emptyEl.hidden = true;
    this.slots = pages.map((model) => {
      const overlay = h("div", { className: "page-overlay" });
      const label = h("div", { className: "page-label", text: `${model.index + 1} / ${pages.length}` });
      const root = h(
        "div",
        {
          className: "page",
          dataset: {
            pageIndex: String(model.index),
            state: "pending",
            displayWidth: String(model.width),
            displayHeight: String(model.height),
          },
        },
        overlay,
        label,
      );
      return { model, root, overlay, canvas: null, renderedFor: 0, task: null, visible: false, generation: 0 };
    });
    this.pagesEl.append(...this.slots.map((s) => s.root));
    this.fit = "width";
    this.scale = this.fitWidthScale();
    this.layout();
    this.observer = new IntersectionObserver((entries) => this.onIntersect(entries), {
      root: this.element,
      rootMargin: `${LAZY_RENDER_MARGIN_PX}px 0px`,
    });
    for (const slot of this.slots) this.observer.observe(slot.root);
  }

  clear(): void {
    this.observer?.disconnect();
    this.observer = null;
    for (const slot of this.slots) this.discard(slot);
    this.slots = [];
    this.pagesEl.replaceChildren();
    this.emptyEl.hidden = false;
  }

  scrollToArea(pageIndex: number, y: number, x?: number): void {
    const slot = this.slots[pageIndex];
    if (!slot) return;
    const top = slot.root.offsetTop + y * this.scale - this.element.clientHeight / 3;
    const left = x === undefined ? this.element.scrollLeft : slot.root.offsetLeft + x * this.scale - this.element.clientWidth / 2;
    this.element.scrollTo({ top: Math.max(0, top), left: Math.max(0, left), behavior: "smooth" });
  }

  setScale(scale: number): void {
    this.fit = "manual";
    this.setScaleInternal(clamp(scale, ZOOM_LIMITS.min * CSS_PX_PER_PT, ZOOM_LIMITS.max * CSS_PX_PER_PT));
  }

  fitWidth(): void {
    this.fit = "width";
    this.setScaleInternal(this.fitWidthScale());
  }

  private fitWidthScale(): number {
    const widest = Math.max(1, ...this.slots.map((s) => s.model.width));
    const available = Math.max(200, this.element.clientWidth - 48);
    return clamp(available / widest, ZOOM_LIMITS.min * CSS_PX_PER_PT, FIT_WIDTH_MAX_SCALE);
  }

  private setScaleInternal(scale: number): void {
    if (Math.abs(scale - this.scale) < 1e-4) return;
    const ratio = this.element.scrollHeight > 0 ? this.element.scrollTop / this.element.scrollHeight : 0;
    const centerX = this.element.scrollWidth > 0 ? (this.element.scrollLeft + this.element.clientWidth / 2) / this.element.scrollWidth : 0.5;
    this.scale = scale;
    this.layout();
    this.element.scrollTop = ratio * this.element.scrollHeight;
    this.element.scrollLeft = Math.max(0, centerX * this.element.scrollWidth - this.element.clientWidth / 2);
    for (const slot of this.slots) this.invalidate(slot);
    for (const slot of this.slots) if (slot.visible) void this.render(slot);
  }

  private layout(): void {
    for (const slot of this.slots) {
      slot.root.style.width = `${slot.model.width * this.scale}px`;
      slot.root.style.height = `${slot.model.height * this.scale}px`;
    }
    for (const listener of this.layoutListeners) listener(this.scale);
  }

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const slot = this.slots.find((s) => s.root === entry.target);
      if (!slot) continue;
      slot.visible = entry.isIntersecting;
      if (slot.visible) {
        void this.render(slot);
      } else {
        this.discard(slot);
        this.setState(slot, "pending");
      }
    }
  }

  private invalidate(slot: PageSlot): void {
    slot.generation++;
    slot.task?.cancel();
    slot.task = null;
    slot.renderedFor = 0;
  }

  private discard(slot: PageSlot): void {
    this.invalidate(slot);
    if (slot.canvas) freeCanvas(slot.canvas);
    slot.canvas = null;
  }

  private setState(slot: PageSlot, state: RenderState): void {
    slot.root.dataset["state"] = state;
  }

  private async render(slot: PageSlot): Promise<void> {
    if (slot.task !== null || slot.renderedFor === this.scale) return;
    const generation = slot.generation;
    const target = this.scale;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const area = slot.model.width * slot.model.height;
    let deviceScale = target * dpr;
    if (area * deviceScale * deviceScale > DISPLAY_MAX_CANVAS_PIXELS) {
      deviceScale = Math.sqrt(DISPLAY_MAX_CANVAS_PIXELS / area);
    }
    const viewport = slot.model.proxy.getViewport({ scale: deviceScale });
    const canvas = h("canvas", { className: "page-canvas", attrs: { "aria-hidden": "true" } });
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      this.setState(slot, "error");
      return;
    }
    if (!slot.canvas) this.setState(slot, "rendering");
    const task = slot.model.proxy.render({ canvas, canvasContext: context, viewport, ...RENDER_SETTINGS });
    slot.task = task;
    try {
      await task.promise;
      if (generation !== slot.generation) {
        freeCanvas(canvas);
        return;
      }
      if (slot.canvas) freeCanvas(slot.canvas);
      slot.canvas = canvas;
      slot.root.prepend(canvas);
      slot.renderedFor = target;
      this.setState(slot, "rendered");
    } catch (error) {
      freeCanvas(canvas);
      if (error instanceof RenderingCancelledException) return;
      console.error("ページの描画に失敗しました", error);
      if (generation === slot.generation) this.setState(slot, "error");
    } finally {
      if (slot.task === task) slot.task = null;
    }
  }
}
