import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BUNDLED_PACKAGES } from "../vite.config.mjs";
import { buildCsp, securityHeaders } from "./csp.mjs";
import { buildLicenseText } from "./licenses.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const distHtml = `${root}dist/index.html`;

const ALLOWED_URLS = [
  { prefix: "http://www.w3.org/", reason: "XML・SVG の名前空間" },
  { prefix: "http://ns.adobe.com/", reason: "XMP メタデータの名前空間" },
  { prefix: "http://purl.org/dc/", reason: "XMP メタデータの名前空間" },
  { prefix: "http://www.aiim.org/pdfa/ns/", reason: "PDF/A の名前空間" },
  { prefix: "http://www.xfa.org/schema/", reason: "XFA の名前空間（XFA は無効にしている）" },
  { prefix: "http://www.apache.org/licenses/", reason: "ライセンス条文" },
  { prefix: "https://www.apache.org/licenses/", reason: "ライセンス条文" },
  { exact: "http://${e}", reason: "PDF.js が www. で始まるリンクの URL を検証するときに付ける接頭辞" },
  { exact: "http://example.com", reason: "PDF.js が URL を解析するときの仮の基準 URL" },
  { exact: "https://foo.bar", reason: "PDF.js が URL を解析するときの仮の基準 URL" },
  { exact: "https://github.com/Hopding/pdf-lib", reason: "pdf-lib が作成ソフト名として書く文字列（updateMetadata: false にしているため、出力には書かない）" },
];

function isAllowedUrl(url) {
  return ALLOWED_URLS.some((a) => (a.exact !== undefined ? url === a.exact : url.startsWith(a.prefix)));
}

const FORBIDDEN_PATTERNS = [
  { pattern: /\.innerHTML\b/g, reason: "HTML として解釈させる書き込み" },
  { pattern: /\.outerHTML\b/g, reason: "HTML として解釈させる書き込み" },
  { pattern: /insertAdjacentHTML/g, reason: "HTML として解釈させる書き込み" },
  { pattern: /document\.write\b/g, reason: "HTML として解釈させる書き込み" },
  { pattern: /createContextualFragment/g, reason: "HTML として解釈させる書き込み" },
  { pattern: /setHTMLUnsafe/g, reason: "HTML として解釈させる書き込み" },
  { pattern: /\blocalStorage\b/g, reason: "端末への保存" },
  { pattern: /\bsessionStorage\b/g, reason: "端末への保存" },
  { pattern: /\bindexedDB\b/g, reason: "端末への保存" },
  { pattern: /\bcaches\.open\b/g, reason: "端末への保存" },
  { pattern: /serviceWorker\.register/g, reason: "Service Worker" },
  { pattern: /\bnew Function\(/g, reason: "文字列からのコード生成" },
  { pattern: /[^.\w]eval\(/g, reason: "文字列からのコード生成" },
  { pattern: /navigator\.sendBeacon/g, reason: "外部への送信" },
];

function fail(message) {
  console.error(`postbuild: ${message}`);
  process.exit(1);
}

function sha256Base64(text) {
  return createHash("sha256").update(text, "utf8").digest("base64");
}

let html = readFileSync(distHtml, "utf8");

const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
if (scripts.length !== 1) fail(`インラインのスクリプトが ${scripts.length} 個あります（想定は 1 個）。`);
const [scriptMatch] = scripts;
if (/\bsrc\s*=/.test(scriptMatch[1])) fail("外部ファイルを読み込む script 要素があります。");
if (!/type\s*=\s*"module"/.test(scriptMatch[1])) fail("script 要素が module 形式ではありません。");
const scriptText = scriptMatch[2];

const styles = [...html.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/g)];
if (styles.length > 1) fail(`style 要素が ${styles.length} 個あります（想定は 1 個以下）。`);

const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, "");
if (/<link\b/i.test(markup)) fail("link 要素があります。外部のファイルを読み込まない構成にしてください。");
if (/\son[a-z]+\s*=/i.test(markup)) fail("インラインのイベント属性（on...）があります。");
if (/\sstyle\s*=/i.test(markup)) fail("style 属性があります。");
if (/\s(src|href)\s*=/i.test(markup)) fail("src または href 属性があります。");

const findings = [];
for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
  const count = (scriptText.match(pattern) ?? []).length;
  if (count > 0) findings.push(`${pattern.source}（${reason}）: ${count} 箇所`);
}
if (findings.length > 0) fail(`成果物に、使わない方針の API が含まれています。\n  ${findings.join("\n  ")}`);

const urls = [...html.matchAll(/https?:\/\/[^\s"'`<>)\\]+/g)].map((m) => m[0]);
const unknownUrls = [...new Set(urls)].filter((u) => !isAllowedUrl(u));
if (unknownUrls.length > 0) fail(`想定していない URL の文字列があります。\n  ${unknownUrls.join("\n  ")}`);

const scriptHashes = [sha256Base64(scriptText)];
const styleHashes = styles.map((m) => sha256Base64(m[2]));
const metaCsp = buildCsp({ scriptHashes, styleHashes, delivery: "meta" });
if (!html.includes('content="__CSP__"')) fail("CSP の差し込み位置（__CSP__）が見つかりません。");
const cspMetaAt = html.indexOf("__CSP__");
const firstScriptAt = html.indexOf("<script");
if (cspMetaAt < 0 || cspMetaAt > firstScriptAt) fail("CSP の meta タグが、スクリプトより前にありません。");
html = html.replace('content="__CSP__"', `content="${metaCsp}"`);
writeFileSync(distHtml, html);

const licenseText = buildLicenseText(BUNDLED_PACKAGES);
writeFileSync(`${root}dist/THIRD_PARTY_LICENSES.txt`, licenseText);

const headerCsp = buildCsp({ scriptHashes, styleHashes, delivery: "header" });
const vercel = {
  $schema: "https://openapi.vercel.sh/vercel.json",
  framework: null,
  installCommand: "echo 'skip install: dist/ is committed'",
  buildCommand: "echo 'skip build: dist/ is committed'",
  outputDirectory: "dist",
  cleanUrls: false,
  trailingSlash: false,
  headers: [{ source: "/(.*)", headers: securityHeaders(headerCsp) }],
};
writeFileSync(`${root}vercel.json`, `${JSON.stringify(vercel, null, 2)}\n`);

const digest = createHash("sha256").update(readFileSync(distHtml)).digest("hex");
writeFileSync(`${root}dist/index.html.sha256`, `${digest}  index.html\n`);

const sizeMb = (Buffer.byteLength(html, "utf8") / 1024 / 1024).toFixed(2);
console.log(`postbuild: dist/index.html ${sizeMb}MB, sha256 ${digest}`);
console.log(`postbuild: URL の文字列 ${urls.length} 箇所（すべて許可リスト内）`);
