import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { BUNDLED_PACKAGES, buildLicenseText, packageRoot } from "./licenses.mjs";

export const BUNDLED_STANDARD_FONTS = ["FoxitDingbats.pfb", "FoxitSymbol.pfb"];
export const BUNDLED_WASM = ["jbig2.wasm", "openjpeg.wasm"];
export const EXPECTED_IMPORT_META_URL_COUNT = 2;

const VIRTUAL_IDS = {
  worker: "virtual:pdfjs-worker-source",
  data: "virtual:pdfjs-data",
  licenses: "virtual:licenses",
  buildInfo: "virtual:build-info",
};

export function classicWorkerSource() {
  const file = join(packageRoot("pdfjs-dist"), "build/pdf.worker.min.mjs");
  const source = readFileSync(file, "utf8");
  const exportPattern = /export\s*\{\s*WorkerMessageHandler\s*\}\s*;?\s*$/;
  if (!exportPattern.test(source)) {
    throw new Error("pdf.worker.min.mjs の末尾に想定した export 文がありません。PDF.js の更新内容を確認してください。");
  }
  const withoutExport = source.replace(exportPattern, "");
  const metaCount = withoutExport.split("import.meta.url").length - 1;
  if (metaCount !== EXPECTED_IMPORT_META_URL_COUNT) {
    throw new Error(`pdf.worker.min.mjs の import.meta.url が ${metaCount} 箇所あります（想定は ${EXPECTED_IMPORT_META_URL_COUNT} 箇所）。PDF.js の更新内容を確認してください。`);
  }
  const classic = withoutExport.replaceAll("import.meta.url", "self.location.href");
  if (classic.includes("import.meta")) {
    throw new Error("classic 形式に変換した Worker に import.meta が残っています。");
  }
  new vm.Script(classic, { filename: "pdf.worker.classic.js" });
  return classic;
}

function base64Table(dir, names) {
  const table = {};
  for (const name of names) {
    table[name] = readFileSync(join(dir, name)).toString("base64");
  }
  return table;
}

export function pdfjsDataTables() {
  const root = packageRoot("pdfjs-dist");
  const cmapDir = join(root, "cmaps");
  const cmapNames = readdirSync(cmapDir).filter((f) => f.endsWith(".bcmap")).sort();
  return {
    cmaps: base64Table(cmapDir, cmapNames),
    standardFonts: base64Table(join(root, "standard_fonts"), BUNDLED_STANDARD_FONTS),
    wasm: base64Table(join(root, "wasm"), BUNDLED_WASM),
  };
}

function packageNameFromModuleId(id) {
  const normalized = id.replaceAll("\\", "/");
  const marker = "/node_modules/";
  const at = normalized.lastIndexOf(marker);
  if (at < 0) return null;
  const rest = normalized.slice(at + marker.length).split("/");
  if (rest[0]?.startsWith("@")) return `${rest[0]}/${rest[1]}`;
  return rest[0] ?? null;
}

export function blindResumePlugin({ bundledPackages }) {
  const declared = BUNDLED_PACKAGES.map((p) => p.name).filter((n) => bundledPackages.includes(n));
  return {
    name: "blind-resume-build",
    enforce: "pre",
    resolveId(id) {
      if (Object.values(VIRTUAL_IDS).includes(id)) return `\0${id}`;
      return null;
    },
    load(id) {
      if (!id.startsWith("\0virtual:")) return null;
      const name = id.slice(1);
      if (name === VIRTUAL_IDS.worker) {
        return `export default ${JSON.stringify(classicWorkerSource())};`;
      }
      if (name === VIRTUAL_IDS.data) {
        const t = pdfjsDataTables();
        return [
          `export const cmaps = ${JSON.stringify(t.cmaps)};`,
          `export const standardFonts = ${JSON.stringify(t.standardFonts)};`,
          `export const wasm = ${JSON.stringify(t.wasm)};`,
        ].join("\n");
      }
      if (name === VIRTUAL_IDS.licenses) {
        return `export default ${JSON.stringify(buildLicenseText(declared))};`;
      }
      if (name === VIRTUAL_IDS.buildInfo) {
        const app = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
        const pdfjs = JSON.parse(readFileSync(join(packageRoot("pdfjs-dist"), "package.json"), "utf8"));
        return `export default ${JSON.stringify({ appVersion: app.version, pdfjsVersion: pdfjs.version })};`;
      }
      return null;
    },
    generateBundle(_options, bundle) {
      const found = new Set();
      for (const item of Object.values(bundle)) {
        if (item.type !== "chunk") continue;
        const ids = item.moduleIds ?? Object.keys(item.modules ?? {});
        for (const id of ids) {
          const pkg = packageNameFromModuleId(id);
          if (pkg) found.add(pkg);
        }
      }
      const unexpected = [...found].filter((p) => !declared.includes(p));
      const missing = declared.filter((p) => !found.has(p));
      if (unexpected.length > 0 || missing.length > 0) {
        this.error(`ライセンス一覧と実際に同梱されたパッケージが一致しません。一覧にない: ${unexpected.join(", ") || "なし"} / 同梱されていない: ${missing.join(", ") || "なし"}`);
      }
    },
  };
}
