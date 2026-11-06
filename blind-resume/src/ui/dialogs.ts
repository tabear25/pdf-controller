import { h } from "./dom";

export function createDialog(className: string, title: string, ...body: Node[]): HTMLDialogElement {
  const closeButton = h("button", { className: "button", text: "閉じる", attrs: { type: "button", value: "close" } });
  const dialog = h(
    "dialog",
    { className: `dialog ${className}`, attrs: { "aria-label": title } },
    h("h2", { className: "dialog-title", text: title }),
    ...body,
    h("div", { className: "dialog-actions" }, closeButton),
  );
  closeButton.addEventListener("click", () => dialog.close());
  return dialog;
}

export function askPasswordDialog(host: HTMLElement, reason: "need" | "incorrect"): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h("input", {
      className: "text-input",
      attrs: { type: "password", autocomplete: "off", spellcheck: "false", "aria-label": "パスワード" },
    });
    const lead = reason === "incorrect"
      ? "パスワードが違います。もう一度入力してください。"
      : "この PDF はパスワードで保護されています。パスワードを入力してください。";
    const note = "入力したパスワードは、PDF を開くためだけに使い、保存しません。";
    const ok = h("button", { className: "button primary", text: "開く", attrs: { type: "submit" } });
    const cancel = h("button", { className: "button", text: "やめる", attrs: { type: "button" } });
    const form = h(
      "form",
      { className: "password-form", attrs: { method: "dialog" } },
      h("p", { text: lead }),
      input,
      h("p", { className: "note", text: note }),
      h("div", { className: "dialog-actions" }, cancel, ok),
    );
    const dialog = h(
      "dialog",
      { className: "dialog password", attrs: { "aria-label": "パスワードの入力" } },
      h("h2", { className: "dialog-title", text: "パスワードの入力" }),
      form,
    );
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      input.value = "";
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      finish(input.value);
    });
    cancel.addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", () => finish(null));
    host.append(dialog);
    dialog.showModal();
    input.focus();
  });
}
