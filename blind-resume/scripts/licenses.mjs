import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

export const BUNDLED_PACKAGES = [
  { name: "pdfjs-dist", licenseFiles: ["LICENSE"] },
  { name: "pdf-lib", licenseFiles: ["LICENSE.md"] },
  { name: "@pdf-lib/standard-fonts", licenseFiles: ["LICENSE.md"] },
  { name: "@pdf-lib/upng", licenseFiles: ["LICENSE"] },
  { name: "pako", licenseFiles: ["LICENSE"] },
  { name: "tslib", licenseFiles: ["LICENSE.txt"] },
];

export const BUNDLED_DATA = [
  { title: "PDF.js に同梱の cMap（Adobe）", file: "cmaps/LICENSE", license: "BSD-3-Clause" },
  { title: "PDF.js に同梱の標準フォント Symbol・ZapfDingbats（Foxit / PDFium）", file: "standard_fonts/LICENSE_FOXIT", license: "BSD-3-Clause" },
  { title: "JBIG2・CCITT の復号部（PDFium）", file: "wasm/LICENSE_JBIG2", license: "BSD-3-Clause ほか（本文を参照）" },
  { title: "JBIG2・CCITT の復号部の PDF.js 側", file: "wasm/LICENSE_PDFJS_JBIG2", license: "Apache-2.0" },
  { title: "JPEG 2000 の復号部（OpenJPEG）", file: "wasm/LICENSE_OPENJPEG", license: "BSD-2-Clause" },
  { title: "JPEG 2000 の復号部の PDF.js 側", file: "wasm/LICENSE_PDFJS_OPENJPEG", license: "BSD-2-Clause" },
];

export function packageRoot(name) {
  return dirname(require.resolve(`${name}/package.json`));
}

function packageInfo(name) {
  return JSON.parse(readFileSync(join(packageRoot(name), "package.json"), "utf8"));
}

export function buildLicenseText(bundledPackageNames) {
  const included = BUNDLED_PACKAGES.filter((p) => bundledPackageNames.includes(p.name));
  const sections = [];
  for (const pkg of included) {
    const info = packageInfo(pkg.name);
    const body = pkg.licenseFiles.map((f) => readFileSync(join(packageRoot(pkg.name), f), "utf8").trim()).join("\n\n");
    sections.push(`==== ${pkg.name} ${info.version}（${info.license}） ====\n\n${body}`);
  }
  const pdfjsRoot = packageRoot("pdfjs-dist");
  for (const data of BUNDLED_DATA) {
    const body = readFileSync(join(pdfjsRoot, data.file), "utf8").trim();
    sections.push(`==== ${data.title}（${data.license}） ====\n\n${body}`);
  }
  const header = [
    "ブラインドレジュメ作成ツール 第三者ライセンス一覧",
    "",
    "このアプリには、次のソフトウェアとデータが含まれています。",
    "それぞれの著作権表示とライセンス条文を、そのまま掲載します。",
  ].join("\n");
  return `${header}\n\n${sections.join("\n\n")}\n`;
}
