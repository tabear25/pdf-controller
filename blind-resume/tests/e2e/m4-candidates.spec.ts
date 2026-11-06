import { boxToDisplay } from "./geometry";
import {
  candidateRects,
  checkResults,
  coversBox,
  dragOnPage,
  expect,
  exportToReview,
  independentToolsAvailable,
  manifest,
  openFixture,
  redactionData,
  runIndependentVerifier,
  search,
  test,
  waitForAllPagesRendered,
  waitForText,
} from "./harness";

const toolsAvailable = independentToolsAvailable();

function targetBox(name: string, pageIndex: number, id: string) {
  const page = manifest.fixtures[name]!.pages[pageIndex]!;
  const target = page.targets.find((t) => t.id === id)!;
  return boxToDisplay(page, target.bbox);
}

test("範囲の中の文字が検索語に入り、文書全体の同じ氏名が候補になる（塗った範囲は除く）", async ({ app }, testInfo) => {
  const name = "01_embedded_resume.pdf";
  await openFixture(app, name);
  await waitForAllPagesRendered(app, 2);
  await waitForText(app);
  const header = targetBox(name, 0, "header-name-p1");
  await dragOnPage(app, 0, [header.x - 2, header.y - 2], [header.x + header.width + 2, header.y + header.height + 2]);
  await expect(app.getByTestId("search-input")).toHaveValue("見本 太郎");
  await expect(app.getByTestId("search-status")).toContainText("検索語に入れました");
  await app.getByTestId("search-run").click();
  await expect(app.getByTestId("search-status")).toContainText("6 件見つかりました");
  await expect(app.getByTestId("search-status")).toContainText("すでに塗る範囲に含まれている 1 件は、候補から除きました");
  await expect(app.getByTestId("candidate")).toHaveCount(5);
  const rects = await candidateRects(app);
  for (const [pageIndex, id] of [[0, "footer-name-p1"], [0, "p1-name"], [1, "header-name-p2"], [1, "footer-name-p2"], [1, "p2-pr-name"]] as const) {
    expect(coversBox(rects, pageIndex, targetBox(name, pageIndex, id)), `${id} を候補の矩形が覆う`).toBe(true);
  }
  await app.getByTestId("apply-all-candidates").click();
  await expect(app.getByTestId("candidate")).toHaveCount(0);
  await expect(app.getByTestId("candidate-count")).toContainText("塗った 5 件");
  expect((await redactionData(app)).length).toBe(6);

  await exportToReview(app);
  const results = await checkResults(app);
  expect(Object.values(results).every(Boolean), JSON.stringify(results)).toBe(true);
  await app.getByTestId("confirm").check();
  const [download] = await Promise.all([app.waitForEvent("download"), app.getByTestId("download").click()]);
  const outputPath = testInfo.outputPath("output.pdf");
  await download.saveAs(outputPath);
  if (toolsAvailable) {
    const report = runIndependentVerifier(outputPath, name, null);
    const names = ["header-name-p1", "footer-name-p1", "p1-name", "header-name-p2", "footer-name-p2", "p2-pr-name"];
    const checked = report.targets.filter((t) => names.includes(t.id));
    expect(checked).toHaveLength(6);
    expect(checked.filter((t) => (t.dark_ratio ?? 0) < 0.98), "検索で塗った氏名が黒になっている").toEqual([]);
    expect(report.output.forbidden).toEqual([]);
  }
});

test("均等割り付け、字間、全角空白、カタカナ・半角カナの氏名も一致する", async ({ app }) => {
  const name = "03_spaced_name.pdf";
  await openFixture(app, name);
  await waitForAllPagesRendered(app, 1);
  await waitForText(app);
  await search(app, "見本太郎");
  await expect(app.getByTestId("candidate")).toHaveCount(2);
  await search(app, "見本花子");
  await expect(app.getByTestId("candidate")).toHaveCount(3);
  await search(app, "みほんたろう");
  await expect(app.getByTestId("candidate")).toHaveCount(5);
  await search(app, "ミホンガクエン");
  await expect(app.getByTestId("candidate")).toHaveCount(6);
  await search(app, "みほんだいがく");
  await expect(app.getByTestId("candidate")).toHaveCount(7);
  const rects = await candidateRects(app);
  for (const id of ["spaced-name", "charspace-name", "ideographic-space-name", "spaced-katakana", "halfwidth-katakana", "halfwidth-dakuten", "halfwidth-dakuten-charspace"]) {
    expect(coversBox(rects, 0, targetBox(name, 0, id)), `${id} を候補の矩形が覆う`).toBe(true);
  }
});

test("スキャン画像の透明なテキスト層からも候補を作る", async ({ app }) => {
  const name = "08_scan_with_text_layer.pdf";
  await openFixture(app, name);
  await waitForAllPagesRendered(app, 1);
  await waitForText(app);
  await search(app, "見本太郎");
  await expect(app.getByTestId("candidate")).toHaveCount(2);
  const rects = await candidateRects(app);
  expect(coversBox(rects, 0, targetBox(name, 0, "scan-name"))).toBe(true);
});

test("フォントを埋め込んでいない PDF でも検索できる", async ({ app }) => {
  await openFixture(app, "02_nonembedded.pdf");
  await waitForAllPagesRendered(app, 1);
  await waitForText(app);
  await search(app, "見本 太郎");
  await expect(app.getByTestId("candidate")).toHaveCount(1);
  const rects = await candidateRects(app);
  expect(coversBox(rects, 0, targetBox("02_nonembedded.pdf", 0, "name"))).toBe(true);
  await search(app, "TARO.MIHON");
  await expect(app.getByTestId("candidate")).toHaveCount(2);
});

test("文字の情報がない PDF では、検索が使えないことを表示する", async ({ app }) => {
  await openFixture(app, "07_scan_image_only.pdf");
  await waitForAllPagesRendered(app, 3);
  await waitForText(app);
  await expect(app.getByTestId("text-availability")).toContainText("文字の情報がない");
  await expect(app.getByTestId("search-input")).toBeDisabled();
  await expect(app.getByTestId("search-run")).toBeDisabled();
});

test("1 件ずつ塗る・塗らないを選べ、元に戻せる。候補の位置を表示できる", async ({ app }) => {
  await openFixture(app, "02_nonembedded.pdf");
  await waitForAllPagesRendered(app, 1);
  await waitForText(app);
  await search(app, "見本");
  await expect(app.getByTestId("candidate")).toHaveCount(3);
  await app.locator('[data-testid="candidate"] .candidate-text').first().click();
  await expect(app.locator(".candidate-rect.flash").first()).toBeAttached();
  await app.getByTestId("candidate-apply").first().click();
  await expect(app.getByTestId("candidate")).toHaveCount(2);
  expect(await redactionData(app)).toHaveLength(1);
  await app.getByTestId("candidate-skip").first().click();
  await expect(app.getByTestId("candidate")).toHaveCount(1);
  await expect(app.getByTestId("candidate-count")).toContainText("塗った 1 件、塗らない 1 件");
  await app.locator("body").click({ position: { x: 5, y: 5 } });
  await app.keyboard.press("Control+z");
  await expect(app.getByTestId("candidate")).toHaveCount(2);
  await app.keyboard.press("Control+z");
  await expect(app.getByTestId("candidate")).toHaveCount(3);
  expect(await redactionData(app)).toHaveLength(0);
});

test("未確認の候補が残っていると、書き出しの前に一覧を示して判断を求める", async ({ app }) => {
  await openFixture(app, "02_nonembedded.pdf");
  await waitForAllPagesRendered(app, 1);
  await waitForText(app);
  await search(app, "見本");
  await app.getByTestId("export").click();
  const dialog = app.getByTestId("pending-dialog");
  await expect(dialog).toContainText("未確認の候補が 3 件あります");
  await expect(dialog.locator("li")).toHaveCount(3);
  await app.getByTestId("pending-back").click();
  await expect(dialog).toHaveCount(0);
  await expect(app.getByTestId("candidate")).toHaveCount(3);
  await app.getByTestId("export").click();
  await app.getByTestId("pending-apply").click();
  await expect(app.getByRole("dialog", { name: "書き出しの設定" })).toBeVisible();
  await app.getByRole("button", { name: "やめる" }).click();
  await expect(app.getByTestId("candidate")).toHaveCount(0);
  expect((await redactionData(app)).length).toBe(3);
  await app.getByTestId("undo").click();
  await expect(app.getByTestId("candidate")).toHaveCount(3);
});
