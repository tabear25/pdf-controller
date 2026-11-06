import type { EditorStore } from "../core/editor";
import { h } from "./dom";
import type { Viewer } from "./viewer";

export class PageControls {
  private readonly toggles = new WeakMap<HTMLElement, HTMLInputElement>();

  constructor(private readonly viewer: Viewer, private readonly store: EditorStore) {
    viewer.onLayout(() => this.sync());
    store.subscribe(() => this.sync());
  }

  private sync(): void {
    for (const view of this.viewer.pageViews) {
      let box = this.toggles.get(view.root);
      if (!box) {
        const index = view.model.index;
        box = h("input", { attrs: { type: "checkbox", "data-testid": `include-page-${index}`, "aria-label": `${index + 1} ページを書き出す` } });
        const input = box;
        input.addEventListener("change", () => this.store.setExcluded(index, !input.checked));
        const control = h("label", { className: "page-toggle" }, input, " 書き出す");
        control.addEventListener("pointerdown", (event) => event.stopPropagation());
        view.root.append(control);
        this.toggles.set(view.root, input);
      }
      const excluded = this.store.isExcluded(view.model.index);
      box.checked = !excluded;
      view.root.classList.toggle("excluded", excluded);
    }
  }
}
