type Child = Node | string | null | undefined | false;

type Listener = (event: Event) => void;

export interface ElementProps {
  readonly className?: string;
  readonly text?: string;
  readonly attrs?: Readonly<Record<string, string>>;
  readonly dataset?: Readonly<Record<string, string>>;
  readonly on?: Readonly<Record<string, Listener>>;
}

const FORBIDDEN_ATTRIBUTE = /^(on|style$|srcdoc$|formaction$)/i;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.className) el.className = props.className;
  if (props.text !== undefined) el.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) {
    if (FORBIDDEN_ATTRIBUTE.test(name)) {
      throw new Error(`属性 ${name} は使えません。`);
    }
    el.setAttribute(name, value);
  }
  for (const [key, value] of Object.entries(props.dataset ?? {})) {
    el.dataset[key] = value;
  }
  for (const [type, listener] of Object.entries(props.on ?? {})) {
    el.addEventListener(type, listener);
  }
  append(el, ...children);
  return el;
}

export function append(parent: Element, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
}

export function clear(el: Element): void {
  el.replaceChildren();
}

export function setText(el: Element, text: string): void {
  el.textContent = text;
}
