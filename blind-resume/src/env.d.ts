declare module "virtual:pdfjs-worker-source" {
  const source: string;
  export default source;
}

declare module "virtual:pdfjs-data" {
  export const cmaps: Readonly<Record<string, string>>;
  export const standardFonts: Readonly<Record<string, string>>;
  export const wasm: Readonly<Record<string, string>>;
}

declare module "virtual:licenses" {
  const text: string;
  export default text;
}

declare module "virtual:build-info" {
  const info: { readonly appVersion: string; readonly pdfjsVersion: string };
  export default info;
}

declare module "*.css";
