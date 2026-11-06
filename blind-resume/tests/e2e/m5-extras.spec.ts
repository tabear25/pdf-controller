import { boxToDisplay } from "./geometry";
import {
  candidateRects,
  checkResults,
  coversBox,
  dragOnPage,
  expect,
  exportToReview,
  manifest,
  openFixture,
  redactionData,
  test,
  waitForAllPagesRendered,
  waitForText,
} from "./harness";

function targetBox(name: string, pageIndex: number, id: string) {
  const page = manifest.fixtures[name]!.pages[pageIndex]!;
  return boxToDisplay(page, page.targets.find((t) => t.id === id)!.bbox);
}

test("開いたときに、メール・電話・郵便番号・URL・年齢を自動で候補にする（日付は既定では探さない）", async ({ app }) => {
  const name = "01_embedded_resume.pdf";
  await openFixture(app, name);
  await waitForAllPagesRendered(app, 2);
  await waitForText(app);
  const status = app.getByTestId("detect-status");
  for (const label of ["メールアドレス", "電話番号", "郵便番号", "URL", "年齢"]) await expect(status).toContainText(label);
  await expect(status).not.toContainText("日付");
  const texts = await app.locator('[data-testid="candidate"] .candidate-text').allTextContents();
  for (const expected of ["taro.mihon@example.com", "090-0000-1234", "〒000-0001", "https://example.com/mihon-taro", "満35歳", "０９０－００００－５６７８"]) {
    expect(texts, `候補に「${expected}」がある`).toContain(expected);
  }
  expect(texts.some((t) => t.includes("1990年4月1日"))).toBe(false);
  await expect(app.getByTestId("undo")).toBeDisabled();
  const rects = await candidateRects(app);
  for (const [pageIndex, id] of [[0, "p1-email"], [0, "p1-phone"], [0, "p1-url"], [1, "p2-pr-phone-fullwidth"]] as const) {
    expect(coversBox(rects, pageIndex, targetBox(name, pageIndex, id)), `${id} を候補の矩形が覆う`).toBe(true);
  }
  await app.getByTestId("detector-date").check();
  await app.getByTestId("detect-run").click();
  await expect(status).toContainText("日付・年号");
  const withDates = await app.locator('[data-testid="candidate"] .candidate-text').allTextContents();
  expect(withDates.some((t) => t.includes("1990年4月1日"))).toBe(true);
  await app.getByTestId("undo").click();
  await expect(app.locator('[data-testid="candidate"] .candidate-text', { hasText: "1990年4月1日" })).toHaveCount(0);
});

test("拡大、縮小、幅に合わせるで表示を変えても、範囲の座標は変わらない", async ({ app }) => {
  await openFixture(app, "01_embedded_resume.pdf");
  await waitForAllPagesRendered(app, 2);
  await dragOnPage(app, 0, [60, 100], [260, 160]);
  const before = await redactionData(app);
  const level = app.getByTestId("zoom-level");
  const fitText = (await level.textContent()) ?? "";
  await app.getByTestId("zoom-out").click();
  await expect(level).not.toHaveText(fitText);
  const zoomedOut = Number.parseInt((await level.textContent()) ?? "0", 10);
  await app.getByTestId("zoom-in").click();
  await app.getByTestId("zoom-in").click();
  await expect.poll(async () => Number.parseInt((await level.textContent()) ?? "0", 10)).toBeGreaterThan(zoomedOut);
  await expect(app.locator('.page[data-page-index="0"]')).toHaveAttribute("data-state", "rendered");
  expect(await redactionData(app)).toEqual(before);
  await app.getByTestId("zoom-fit").click();
  await expect(level).toHaveText(fitText);
  expect(await redactionData(app)).toEqual(before);
});

test("ページ単位で出力から外せる", async ({ app }) => {
  await openFixture(app, "01_embedded_resume.pdf");
  await waitForAllPagesRendered(app, 2);
  const secondPage = app.locator('.page[data-page-index="1"]');
  const secondToggle = app.getByTestId("include-page-1");
  await secondToggle.uncheck();
  await expect(secondPage).toHaveClass(/excluded/);
  await app.getByTestId("undo").click();
  await expect(secondPage).not.toHaveClass(/excluded/);
  await expect(secondToggle).toBeChecked();
  await app.getByTestId("redo").click();
  await expect(secondPage).toHaveClass(/excluded/);
  await expect(secondToggle).not.toBeChecked();
  await dragOnPage(app, 0, [60, 100], [260, 160]);
  await exportToReview(app);
  await expect(app.getByTestId("output-summary")).toContainText("1 ページ（1 ページは書き出さない）");
  await expect(app.getByTestId("check-pages")).toContainText("1 ページ（想定 1 ページ）");
  const results = await checkResults(app);
  expect(Object.values(results).every(Boolean), JSON.stringify(results)).toBe(true);
  await expect(app.locator(".preview-row")).toHaveCount(1);
  await app.getByTestId("review-back").click();
  await expect(secondPage).toHaveClass(/excluded/);
  await app.getByTestId("include-page-0").uncheck();
  await app.getByTestId("export").click();
  await expect(app.getByTestId("message")).toContainText("書き出すページがありません");
});
