import { displaySize } from "./geometry";
import {
  checkResults,
  dragOnPage,
  expect,
  exportToReview,
  independentToolsAvailable,
  manifest,
  openFixture,
  redactAllTargets,
  runIndependentVerifier,
  test,
  waitForAllPagesRendered,
} from "./harness";

const toolsAvailable = independentToolsAvailable();

for (const [name, info] of Object.entries(manifest.fixtures)) {
  test(`${name}：範囲を塗って書き出すと、自動検査に合格し、文字や情報が残らない`, async ({ app, guard }, testInfo) => {
    test.setTimeout(240_000);
    guard.allowConsole(/PasswordException|No password given/);
    await openFixture(app, name);
    if (info.password) {
      const dialog = app.getByRole("dialog", { name: "パスワードの入力" });
      await dialog.getByLabel("パスワード").fill(info.password);
      await dialog.getByRole("button", { name: "開く" }).click();
    }
    await waitForAllPagesRendered(app, info.pages.length);
    const rectCount = await redactAllTargets(app, info);
    await exportToReview(app);
    const results = await checkResults(app);
    expect(Object.keys(results).length).toBeGreaterThanOrEqual(10);
    expect(results, JSON.stringify(results)).toEqual(Object.fromEntries(Object.keys(results).map((k) => [k, true])));
    await expect(app.getByTestId("check-black")).toContainText(`${rectCount} か所を確認しました`);
    await expect(app.getByTestId("review-status")).toContainText("合格しました");
    await expect(app.locator('[data-testid="checklist"] li')).toHaveCount(9);
    await expect(app.getByTestId("download")).toBeDisabled();
    await app.getByTestId("confirm").check();
    await expect(app.getByTestId("download")).toBeEnabled();
    const fileName = await app.getByTestId("filename").inputValue();
    expect(fileName).toMatch(/^blind_resume_\d{8}_\d{4}\.pdf$/);
    const [download] = await Promise.all([app.waitForEvent("download"), app.getByTestId("download").click()]);
    expect(download.suggestedFilename()).toBe(fileName);
    const outputPath = testInfo.outputPath("output.pdf");
    await download.saveAs(outputPath);
    await expect(app.getByTestId("download-note")).toContainText("ダウンロードしました");

    if (!toolsAvailable) {
      testInfo.annotations.push({ type: "note", description: "Python と poppler がないため、独立した検査を省略" });
      return;
    }
    const report = runIndependentVerifier(outputPath, name, info.password);
    expect(report.output.forbidden, "出力に残った文字列").toEqual([]);
    expect(report.output.structure, "出力の構造").toEqual([]);
    expect(report.output.jpeg_metadata, "画像のメタデータ").toEqual([]);
    expect(report.output_text, "出力から取り出せる文字").toBe("");
    expect(report.output.page_sizes).toHaveLength(info.pages.length);
    report.output.page_sizes.forEach(([w, h, rotate], i) => {
      const want = displaySize(info.pages[i]!);
      expect(Math.abs(w - want.width), `${i + 1} ページの幅`).toBeLessThan(0.5);
      expect(Math.abs(h - want.height), `${i + 1} ページの高さ`).toBeLessThan(0.5);
      expect(rotate).toBe(0);
    });
    const notBlack = report.targets.filter((t) => t.error || (t.dark_ratio ?? 0) < 0.98);
    expect(notBlack, "poppler で描画した出力で、黒になっていない箇所").toEqual([]);
    expect(report.targets.length).toBe(info.pages.reduce((n, p) => n + p.targets.filter((x) => !x.id.includes("outside")).length, 0));
    if (info.hasText || name.startsWith("06")) {
      const positive = report.input.forbidden.length > 0 || report.input_text.includes("見本");
      expect(positive, "検査の仕組みが入力側では文字を見つけられること").toBe(true);
    }
  });
}

test("塗る範囲がないまま書き出そうとすると、注意を表示する", async ({ app }) => {
  await openFixture(app, "02_nonembedded.pdf");
  await waitForAllPagesRendered(app, 1);
  await app.getByTestId("export").click();
  await expect(app.getByRole("dialog", { name: "書き出しの設定" })).toContainText("塗る範囲がまだありません");
  await app.getByRole("button", { name: "やめる" }).click();
  await expect(app.getByRole("dialog", { name: "書き出しの設定" })).toHaveCount(0);
});

test("ファイル名を変えてダウンロードでき、戻ると範囲がそのまま残る", async ({ app }, testInfo) => {
  await openFixture(app, "02_nonembedded.pdf");
  await waitForAllPagesRendered(app, 1);
  await dragOnPage(app, 0, [60, 110], [260, 140]);
  await exportToReview(app, 150);
  await app.getByTestId("confirm").check();
  await app.getByTestId("filename").fill("candidate:A/interview");
  const [download] = await Promise.all([app.waitForEvent("download"), app.getByTestId("download").click()]);
  expect(download.suggestedFilename()).toBe("candidateAinterview.pdf");
  await expect(app.getByTestId("filename")).toHaveValue("candidateAinterview.pdf");
  await app.getByTestId("filename").fill("候補者A_面接用");
  const [japanese] = await Promise.all([app.waitForEvent("download"), app.getByTestId("download").click()]);
  await expect(app.getByTestId("filename")).toHaveValue("候補者A_面接用.pdf");
  const observed = japanese.suggestedFilename();
  testInfo.annotations.push({ type: "japanese-filename", description: observed });
  console.log(`[japanese-filename] ${testInfo.project.name}: ${observed}`);
  if (process.platform === "win32") expect(observed).toBe("候補者A_面接用.pdf");
  await app.getByTestId("review-back").click();
  await expect(app.getByTestId("review")).toHaveCount(0);
  await expect(app.getByTestId("rect-count")).toHaveText("塗る範囲：1 件");
  await expect.poll(() => app.workers().length).toBe(1);
});

test("大きなページは解像度を下げて書き出し、その旨を表示する", async ({ app }) => {
  await openFixture(app, "10_large_page.pdf");
  await waitForAllPagesRendered(app, 1);
  await dragOnPage(app, 0, [90, 100], [900, 180]);
  await exportToReview(app, 300);
  await expect(app.getByTestId("dpi-reduced")).toContainText("1 ページを");
  const results = await checkResults(app);
  expect(Object.values(results).every(Boolean), JSON.stringify(results)).toBe(true);
});

test("書き出しを途中で中止できる", async ({ app }) => {
  await openFixture(app, "04_rotated_sizes.pdf");
  await waitForAllPagesRendered(app, 7);
  await dragOnPage(app, 0, [30, 20], [150, 60]);
  await app.getByTestId("export").click();
  await app.getByTestId("dpi-300").check();
  await app.getByTestId("export-start").click();
  await app.getByTestId("export-cancel").click();
  await expect(app.getByTestId("message")).toContainText("書き出しを中止しました");
  await expect(app.getByTestId("review")).toHaveCount(0);
  await expect(app.getByTestId("export")).toBeEnabled();
});
