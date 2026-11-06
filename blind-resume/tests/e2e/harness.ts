import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
import { boxToDisplay, type FixturePage } from "./geometry";

export interface AppOptions {
  appUrl: string;
  appMode: "file" | "http";
}

export interface FixtureInfo {
  readonly description: string;
  readonly hasText: boolean;
  readonly password: string | null;
  readonly pages: readonly FixturePage[];
  readonly hiddenStrings?: readonly string[];
}

export interface Manifest {
  readonly persona: Readonly<Record<string, string>>;
  readonly forbiddenStrings: readonly string[];
  readonly fixtures: Readonly<Record<string, FixtureInfo>>;
}

export const manifest: Manifest = JSON.parse(readFileSync(resolve("tests/fixtures/manifest.json"), "utf8"));

export const fixturePath = (name: string): string => resolve("tests/fixtures/pdf", name);

export interface Guard {
  readonly externalRequests: string[];
  readonly violations: string[];
  readonly consoleProblems: string[];
  allowConsole(pattern: RegExp): void;
}

const ALWAYS_ALLOWED_CONSOLE = [/Cannot load system font/, /Warning: Indexing all PDF objects/];

export const test = base.extend<AppOptions & { guard: Guard; app: Page }>({
  appUrl: ["", { option: true }],
  appMode: ["file", { option: true }],
  guard: async ({ context, appUrl }, use) => {
    const externalRequests: string[] = [];
    const appOrigin = appUrl.startsWith("http") ? new URL(appUrl).origin : null;
    context.on("request", (request) => {
      const url = request.url();
      if (url.startsWith("blob:") || url.startsWith("data:")) return;
      if (appOrigin === null && url === appUrl) return;
      if (appOrigin !== null && (url === `${appOrigin}/` || url === `${appOrigin}/index.html`)) return;
      externalRequests.push(url);
    });
    const allowed = [...ALWAYS_ALLOWED_CONSOLE];
    const guard: Guard = {
      externalRequests,
      violations: [],
      consoleProblems: [],
      allowConsole: (pattern) => allowed.push(pattern),
    };
    await use(guard);
    const problems = guard.consoleProblems.filter((m) => !allowed.some((p) => p.test(m)));
    expect(externalRequests, "外部への通信").toEqual([]);
    expect(guard.violations, "CSP の違反").toEqual([]);
    expect(problems, "コンソールの警告・エラー").toEqual([]);
  },
  app: async ({ page, appUrl, guard }, use) => {
    await page.exposeFunction("__reportViolation", (text: string) => {
      guard.violations.push(text);
    });
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        const report = (window as unknown as { __reportViolation: (t: string) => void }).__reportViolation;
        report(`${event.effectiveDirective} ${event.blockedURI} ${event.sample}`);
      });
    });
    page.on("console", (message) => {
      const type = message.type();
      if (type === "error" || type === "warning") guard.consoleProblems.push(`${type}: ${message.text()}`);
    });
    page.on("pageerror", (error) => guard.consoleProblems.push(`pageerror: ${error.message}`));
    await page.goto(appUrl);
    await expect(page.getByRole("heading", { name: "ブラインドレジュメ作成ツール" })).toBeVisible();
    await use(page);
  },
});

export { expect };

export async function openFixture(page: Page, name: string): Promise<void> {
  await page.setInputFiles('[data-testid="file-input"]', fixturePath(name));
}

export async function waitForAllPagesRendered(page: Page, expectedPages: number): Promise<void> {
  await expect(page.locator(".page")).toHaveCount(expectedPages);
  for (let i = 0; i < expectedPages; i++) {
    const pageEl = page.locator(`.page[data-page-index="${i}"]`);
    await pageEl.scrollIntoViewIfNeeded();
    await expect(pageEl).toHaveAttribute("data-state", "rendered");
  }
}

export async function darkPixelRatio(
  page: Page,
  pageIndex: number,
  region?: { x: number; y: number; width: number; height: number },
): Promise<number> {
  return page.evaluate(
    ({ pageIndex, region }) => {
      const root = document.querySelector<HTMLElement>(`.page[data-page-index="${pageIndex}"]`);
      const canvas = root?.querySelector("canvas");
      if (!root || !canvas) return -1;
      const k = canvas.width / root.clientWidth;
      const scale = root.clientWidth / Number(root.dataset["displayWidth"]);
      const r = region ?? { x: 0, y: 0, width: Number(root.dataset["displayWidth"]), height: Number(root.dataset["displayHeight"]) };
      const x = Math.max(0, Math.floor(r.x * scale * k));
      const y = Math.max(0, Math.floor(r.y * scale * k));
      const w = Math.max(1, Math.min(canvas.width - x, Math.ceil(r.width * scale * k)));
      const h = Math.max(1, Math.min(canvas.height - y, Math.ceil(r.height * scale * k)));
      const copy = document.createElement("canvas");
      copy.width = w;
      copy.height = h;
      const copyContext = copy.getContext("2d", { willReadFrequently: true })!;
      copyContext.drawImage(canvas, x, y, w, h, 0, 0, w, h);
      const data = copyContext.getImageData(0, 0, w, h).data;
      let dark = 0;
      for (let i = 0; i < data.length; i += 4) if ((data[i]! + data[i + 1]! + data[i + 2]!) / 3 < 200) dark++;
      return dark / (w * h);
    },
    { pageIndex, region },
  );
}

export interface PageGeometry {
  readonly left: number;
  readonly top: number;
  readonly scale: number;
}

export async function revealOnPage(page: Page, pageIndex: number, yTop: number, yBottom: number): Promise<void> {
  await page.evaluate(
    ({ pageIndex, yTop, yBottom }) => {
      const el = document.querySelector<HTMLElement>(`.page[data-page-index="${pageIndex}"]`)!;
      const viewer = document.querySelector<HTMLElement>(".viewer")!;
      const scale = el.clientWidth / Number(el.dataset["displayWidth"]);
      const pageRect = el.getBoundingClientRect();
      const viewerRect = viewer.getBoundingClientRect();
      const middle = pageRect.top + ((yTop + yBottom) / 2) * scale;
      viewer.scrollTop += middle - (viewerRect.top + viewerRect.height / 2);
    },
    { pageIndex, yTop, yBottom },
  );
  const el = page.locator(`.page[data-page-index="${pageIndex}"]`);
  await expect(el).toHaveAttribute("data-state", "rendered");
}

export async function pageGeometry(page: Page, pageIndex: number, scroll = true): Promise<PageGeometry> {
  const el = page.locator(`.page[data-page-index="${pageIndex}"]`);
  if (scroll) await el.scrollIntoViewIfNeeded();
  await expect(el).toHaveAttribute("data-state", "rendered");
  const box = (await el.boundingBox())!;
  const displayWidth = Number(await el.getAttribute("data-display-width"));
  return { left: box.x, top: box.y, scale: box.width / displayWidth };
}

export async function dragOnPage(
  page: Page,
  pageIndex: number,
  from: readonly [number, number],
  to: readonly [number, number],
): Promise<void> {
  await revealOnPage(page, pageIndex, Math.min(from[1], to[1]), Math.max(from[1], to[1]));
  const g = await pageGeometry(page, pageIndex, false);
  await page.mouse.move(g.left + from[0] * g.scale, g.top + from[1] * g.scale);
  await page.mouse.down();
  await page.mouse.move(g.left + to[0] * g.scale, g.top + to[1] * g.scale, { steps: 8 });
  await page.mouse.up();
}

export interface RectData {
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export async function redactionData(page: Page): Promise<RectData[]> {
  return page.locator('[data-testid="redaction"]').evaluateAll((els) =>
    els.map((el) => {
      const d = (el as HTMLElement).dataset;
      return { page: Number(d["page"]), x: Number(d["x"]), y: Number(d["y"]), width: Number(d["w"]), height: Number(d["h"]) };
    }),
  );
}

export const PYTHON = process.env["PYTHON"] ?? "python3";

export function independentToolsAvailable(): boolean {
  try {
    execFileSync(PYTHON, ["-I", "-c", "import pikepdf, pypdf, PIL"], { stdio: "ignore" });
    execFileSync("pdftoppm", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    if (process.env["REQUIRE_INDEPENDENT_CHECKS"] === "1") {
      throw new Error("独立した検査に使う Python（pikepdf、pypdf、Pillow）か poppler が見つかりません。");
    }
    return false;
  }
}

export interface IndependentReport {
  readonly output: { forbidden: string[]; structure: string[]; jpeg_metadata: string[]; page_sizes: [number, number, number][] };
  readonly output_text: string;
  readonly input: { forbidden: string[]; structure: string[] };
  readonly input_text: string;
  readonly targets: { page: number; id: string; dark_ratio?: number; error?: string }[];
}

export function runIndependentVerifier(outputPath: string, fixtureName: string, password: string | null): IndependentReport {
  const args = [
    "-I",
    resolve("tests/tools/verify_output.py"),
    "--output",
    outputPath,
    "--input",
    fixturePath(fixtureName),
    "--manifest",
    resolve("tests/fixtures/manifest.json"),
    "--fixture",
    fixtureName,
  ];
  if (password) args.push("--password", password);
  const stdout = execFileSync(PYTHON, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(stdout) as IndependentReport;
}

interface Box4 {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function mergeOverlapping(boxes: Box4[], gap: number): Box4[] {
  const groups = boxes.map((b) => ({ ...b }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let a = 0; a < groups.length && !merged; a++) {
      for (let b = a + 1; b < groups.length && !merged; b++) {
        const A = groups[a]!;
        const B = groups[b]!;
        if (A.x0 - gap < B.x1 && B.x0 - gap < A.x1 && A.y0 - gap < B.y1 && B.y0 - gap < A.y1) {
          groups[a] = { x0: Math.min(A.x0, B.x0), y0: Math.min(A.y0, B.y0), x1: Math.max(A.x1, B.x1), y1: Math.max(A.y1, B.y1) };
          groups.splice(b, 1);
          merged = true;
        }
      }
    }
  }
  return groups;
}

export async function redactAllTargets(page: Page, info: FixtureInfo, margin = 2): Promise<number> {
  let count = 0;
  for (let i = 0; i < info.pages.length; i++) {
    const fixturePage = info.pages[i]!;
    const boxes = fixturePage.targets
      .filter((t) => !t.id.includes("outside"))
      .map((t) => {
        const b = boxToDisplay(fixturePage, t.bbox);
        return { x0: b.x - margin, y0: b.y - margin, x1: b.x + b.width + margin, y1: b.y + b.height + margin };
      });
    for (const g of mergeOverlapping(boxes, 2)) {
      await dragOnPage(page, i, [g.x0, g.y0], [g.x1, g.y1]);
      count += 1;
    }
  }
  await expect(page.getByTestId("rect-count")).toHaveText(`塗る範囲：${count} 件`);
  return count;
}

export async function exportToReview(page: Page, dpi = 200): Promise<void> {
  await page.getByTestId("export").click();
  await page.getByTestId(`dpi-${dpi}`).check();
  await page.getByTestId("export-start").click();
  await expect(page.getByTestId("review")).toBeVisible({ timeout: 120_000 });
}

export async function checkResults(page: Page): Promise<Record<string, boolean>> {
  return page.locator('[data-testid^="check-"]').evaluateAll((els) =>
    Object.fromEntries(els.map((el) => [(el as HTMLElement).dataset["testid"]!, (el as HTMLElement).dataset["ok"] === "true"])),
  );
}

export async function candidateRects(page: Page): Promise<RectData[]> {
  return page.locator('[data-testid="candidate-rect"]').evaluateAll((els) =>
    els.map((el) => {
      const d = (el as HTMLElement).dataset;
      return { page: Number(d["page"]), x: Number(d["x"]), y: Number(d["y"]), width: Number(d["w"]), height: Number(d["h"]) };
    }),
  );
}

export function coversBox(rects: readonly RectData[], pageIndex: number, box: { x: number; y: number; width: number; height: number }): boolean {
  const onPage = rects.filter((r) => r.page === pageIndex);
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 4; j++) {
      const x = box.x + (box.width * i) / 8;
      const y = box.y + (box.height * j) / 4;
      if (!onPage.some((r) => x >= r.x - 0.01 && x <= r.x + r.width + 0.01 && y >= r.y - 0.01 && y <= r.y + r.height + 0.01)) return false;
    }
  }
  return true;
}

export async function waitForText(page: Page): Promise<void> {
  await expect(page.getByTestId("text-availability")).not.toContainText("読み取っています");
}

export async function search(page: Page, query: string): Promise<void> {
  await page.getByTestId("search-input").fill(query);
  await page.getByTestId("search-run").click();
  await expect(page.getByTestId("search-status")).toContainText(`「${query}」は`);
}
