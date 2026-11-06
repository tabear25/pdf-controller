import { AnnotationMode } from "pdfjs-dist";
import { BundledDataFactory } from "./data";

export const RENDER_SETTINGS = Object.freeze({
  intent: "display",
  annotationMode: AnnotationMode.ENABLE,
  background: "rgb(255,255,255)",
});

export const DOCUMENT_SETTINGS = Object.freeze({
  cMapUrl: "bundled:cmaps/",
  cMapPacked: true,
  wasmUrl: "bundled:wasm/",
  useWorkerFetch: false,
  useWasm: true,
  useSystemFonts: true,
  BinaryDataFactory: BundledDataFactory,
  enableXfa: false,
  disableWorkerRendering: true,
  stopAtErrors: false,
});
