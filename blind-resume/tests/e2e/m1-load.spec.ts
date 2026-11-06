import { readFileSync } from "node:fs";
import { boxToDisplay, displaySize } from "./geometry";
import {
  darkPixelRatio,
  expect,
  fixturePath,
  manifest,
  openFixture,
  test,
  waitForAllPagesRendered,
} from "./harness";

const unlocked = Object.entries(manifest.fixtures).filter(([, info]) => info.password === null);

test("初期画面に使い方と送信しない旨が表示される", async ({ app, guard }) => {
  await expect(app.getByText("PDF はこの PC の外に送信されません", { exact: false }).first()).toBeVisible();
  await expect(app.getByTestId("usage")).toBeVisible();
  await expect(app.getByTestId("usage")).toContainText("使い方");
  await expect(app.getByTestId("open")).toBeEnabled();
  await expect(app.getByTestId("clear")).toBeDisabled();
  expect(guard.externalRequests).toEqual([]);
});

for (const [name, info] of unlocked) {
  test(`${name} を開くと全ページが描画される`, async ({ app }) => {
    await openFixture(app, name);
    await waitForAllPagesRendered(app, info.pages.length);
    await expect(app.getByTestId("file-info")).toContainText(`${info.pages.length} ページ`);
    for (let i = 0; i < info.pages.length; i++) {
      const fixturePage = info.pages[i]!;
      const size = displaySize(fixturePage);
      const pageEl = app.locator(`.page[data-page-index="${i}"]`);
      await pageEl.scrollIntoViewIfNeeded();
      await expect(pageEl).toHaveAttribute("data-state", "rendered");
      expect(Number(await pageEl.getAttribute("data-display-width"))).toBeCloseTo(size.width, 1);
      expect(Number(await pageEl.getAttribute("data-display-height"))).toBeCloseTo(size.height, 1);
      expect(await darkPixelRatio(app, i)).toBeGreaterThan(0.0005);
      for (const target of fixturePage.targets) {
        if (target.id.includes("outside")) continue;
        const region = boxToDisplay(fixturePage, target.bbox);
        const ratio = await darkPixelRatio(app, i, region);
        expect(ratio, `${name} p${i + 1} ${target.id} の位置に描画がある`).toBeGreaterThan(0.01);
      }
    }
  });
}

test("フォントを埋め込んでいない日本語の PDF で、cMap の読み込みに失敗しない", async ({ app, guard }) => {
  const consoleText: string[] = [];
  app.on("console", (m) => consoleText.push(m.text()));
  await openFixture(app, "02_nonembedded.pdf");
  await waitForAllPagesRendered(app, 1);
  expect(consoleText.filter((t) => /CMap|cMap|BinaryData|同梱データ/.test(t))).toEqual([]);
  expect(guard.violations).toEqual([]);
});

test("クロップ外の文字は画面に描画されない", async ({ app }) => {
  const info = manifest.fixtures["05_cropbox.pdf"]!;
  await openFixture(app, "05_cropbox.pdf");
  await waitForAllPagesRendered(app, info.pages.length);
  const outside = info.pages[0]!.targets.find((t) => t.id === "p1-outside")!;
  const region = boxToDisplay(info.pages[0]!, outside.bbox);
  expect(region.y + region.height).toBeGreaterThan(Number(await app.locator('.page[data-page-index="0"]').getAttribute("data-display-height")));
});

test("別のファイルを開くと前の Worker が終了し、クリアで何も残らない", async ({ app }) => {
  await openFixture(app, "01_embedded_resume.pdf");
  await waitForAllPagesRendered(app, 2);
  expect(app.workers().length).toBe(1);
  await openFixture(app, "02_nonembedded.pdf");
  await waitForAllPagesRendered(app, 1);
  await expect.poll(() => app.workers().length).toBe(1);
  await app.getByTestId("clear").click();
  await expect(app.locator(".page")).toHaveCount(0);
  await expect.poll(() => app.workers().length).toBe(0);
  await expect(app.getByTestId("file-info")).toHaveText("");
  await expect(app.locator("canvas")).toHaveCount(0);
});

test("ドラッグ＆ドロップで開ける", async ({ app }) => {
  const bytes = [...readFileSync(fixturePath("03_spaced_name.pdf"))];
  const dataTransfer = await app.evaluateHandle((data) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(data)], "dropped.pdf", { type: "application/pdf" }));
    return transfer;
  }, bytes);
  await app.dispatchEvent("body", "dragover", { dataTransfer });
  await app.dispatchEvent("body", "drop", { dataTransfer });
  await waitForAllPagesRendered(app, 1);
  await expect(app.getByTestId("file-info")).toContainText("dropped.pdf");
});

test("PDF 以外のファイルは開かない", async ({ app }) => {
  await app.setInputFiles('[data-testid="file-input"]', { name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(app.getByTestId("message")).toContainText("PDF ファイルを選んでください");
  await expect(app.locator(".page")).toHaveCount(0);
});

test("壊れた PDF ではエラーを表示する", async ({ app, guard }) => {
  guard.allowConsole(/PDF を開けませんでした|Invalid PDF|InvalidPDFException/);
  await app.setInputFiles('[data-testid="file-input"]', { name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\nnot really a pdf") });
  await expect(app.getByTestId("message")).toContainText("PDF として読み込めませんでした");
  await expect.poll(() => app.workers().length).toBe(0);
});

test("パスワード付きの PDF は、その場で入力して開ける", async ({ app, guard }) => {
  guard.allowConsole(/PDF を開けませんでした|PasswordException|No password given|Incorrect Password/);
  const info = manifest.fixtures["09_password.pdf"]!;
  await openFixture(app, "09_password.pdf");
  const dialog = app.getByRole("dialog", { name: "パスワードの入力" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("パスワード").fill("wrong-pass");
  await dialog.getByRole("button", { name: "開く" }).click();
  const retry = app.getByRole("dialog", { name: "パスワードの入力" });
  await expect(retry).toContainText("パスワードが違います");
  await retry.getByLabel("パスワード").fill(info.password!);
  await retry.getByRole("button", { name: "開く" }).click();
  await waitForAllPagesRendered(app, 1);
  await expect(app.locator('input[type="password"]')).toHaveCount(0);
});

test("パスワードの入力をやめると開かない", async ({ app, guard }) => {
  guard.allowConsole(/PDF を開けませんでした/);
  await openFixture(app, "09_password.pdf");
  const dialog = app.getByRole("dialog", { name: "パスワードの入力" });
  await dialog.getByRole("button", { name: "やめる" }).click();
  await expect(app.getByTestId("message")).toContainText("パスワードの入力を取り消した");
  await expect(app.locator(".page")).toHaveCount(0);
  await expect.poll(() => app.workers().length).toBe(0);
});

test("第三者ライセンスを画面で読める", async ({ app }) => {
  await app.getByTestId("licenses").click();
  const dialog = app.getByRole("dialog", { name: "第三者ライセンス" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".license-text")).toContainText("pdfjs-dist");
  await expect(dialog.locator(".license-text")).toContainText("Apache License");
  await expect(dialog.locator(".license-text")).toContainText("Adobe");
  await dialog.getByRole("button", { name: "閉じる" }).click();
  await expect(dialog).toBeHidden();
});
