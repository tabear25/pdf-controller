import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
import type { FixturePage } from "./geometry";

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
