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
  setAutoDetection,
  test,
  waitForAllPagesRendered,
  waitForDetection,
} from "./harness";

function targetBox(name: string, pageIndex: number, id: string) {
  const page = manifest.fixtures[name]!.pages[pageIndex]!;
  return boxToDisplay(page, page.targets.find((t) => t.id === id)!.bbox);
}

test("開いたときに、氏名・会社名・学校名・住所・連絡先などを自動で候補にする（日付は既定では探さない）", async ({ app }) => {
  const name = "01_embedded_resume.pdf";
  await openFixture(app, name);
  await waitForAllPagesRendered(app, 2);
  await waitForDetection(app);
  const status = app.getByTestId("detect-status");
  for (const label of ["氏名・ふりがな", "会社・団体名", "学校名", "住所・最寄り駅", "メールアドレス", "電話番号", "URL", "年齢"]) await expect(status).toContainText(label);
  await expect(status).not.toContainText("日付");
  const texts = await app.locator('[data-testid="candidate"] .candidate-text').allTextContents();
  for (const expected of [
    "見本 太郎",
    "みほん たろう",
    "見本太郎",
    "Taro Mihon",
    "株式会社見本商事",
    "見本高等学校",
    "見本大学",
    "〒000-0001 東京都見本区見本町1-2-3",
    "見本線 見本駅",
    "taro.mihon@example.com",
    "090-0000-1234",
    "０９０－００００－５６７８",
    "https://example.com/mihon-taro",
    "満35歳",
  ]) {
    expect(texts, `候補に「${expected}」がある`).toContain(expected);
  }
  expect(texts.some((t) => t.includes("1990年4月1日"))).toBe(false);
  await expect(app.getByTestId("undo")).toBeDisabled();
  const rects = await candidateRects(app);
  const notDetectable = ["p1-birth", "p1-gender", "p1-photo"];
  manifest.fixtures[name]!.pages.forEach((page, pageIndex) => {
    for (const target of page.targets) {
      if (notDetectable.includes(target.id)) continue;
      expect(coversBox(rects, pageIndex, targetBox(name, pageIndex, target.id)), `${target.id} を候補の矩形が覆う`).toBe(true);
    }
  });
  await app.getByTestId("detector-date").check();
  await app.getByTestId("detect-run").click();
  await expect(status).toContainText("日付・年号");
  const withDates = await app.locator('[data-testid="candidate"] .candidate-text').allTextContents();
  expect(withDates.some((t) => t.includes("1990年4月1日"))).toBe(true);
  await app.getByTestId("undo").click();
  await expect(app.locator('[data-testid="candidate"] .candidate-text', { hasText: "1990年4月1日" })).toHaveCount(0);
});

test("自動で探す種類は、PDF を開く前に選べる", async ({ app }) => {
  await setAutoDetection(app, ["email", "phone"]);
  await openFixture(app, "01_embedded_resume.pdf");
  await waitForAllPagesRendered(app, 2);
  await waitForDetection(app);
  await expect(app.getByTestId("detect-status")).not.toContainText("氏名");
  const metas = await app.locator('[data-testid="candidate"] .candidate-meta').allTextContents();
  expect(metas.length).toBeGreaterThan(0);
  expect(metas.every((meta) => meta.includes("メールアドレス") || meta.includes("電話番号")), metas.join("\n")).toBe(true);
});

test("均等割り付けや字間の空いた氏名、1 文字ずつのフリガナも自動で候補にする", async ({ app }) => {
  const spaced = "03_spaced_name.pdf";
  await openFixture(app, spaced);
  await waitForAllPagesRendered(app, 1);
  await waitForDetection(app);
  const rects = await candidateRects(app);
  for (const id of ["spaced-name", "charspace-name", "ideographic-space-name", "spaced-katakana", "halfwidth-katakana"]) {
    expect(coversBox(rects, 0, targetBox(spaced, 0, id)), `${id} を候補の矩形が覆う`).toBe(true);
  }
});

test("「Name:」欄の英語表記と、「住所：」欄の値も自動で候補にする", async ({ app }) => {
  await openFixture(app, "02_nonembedded.pdf");
  await waitForAllPagesRendered(app, 1);
  await waitForDetection(app);
  const texts = await app.locator('[data-testid="candidate"] .candidate-text').allTextContents();
  for (const expected of ["見本 太郎", "みほん たろう", "Taro Mihon", "〒000-0001 東京都見本区見本町1-2-3"]) expect(texts, `候補に「${expected}」がある`).toContain(expected);
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

test("拡大してページが表示欄より広くなっても、ページの左端から右端までスクロールで届く", async ({ app }) => {
  await openFixture(app, "01_embedded_resume.pdf");
  await waitForAllPagesRendered(app, 2);
  const level = app.getByTestId("zoom-level");
  for (let i = 0; i < 6; i++) await app.getByTestId("zoom-in").click();
  await expect(level).toHaveText("400%");
  const edges = await app.evaluate(() => {
    const viewer = document.querySelector<HTMLElement>(".viewer")!;
    const page = document.querySelector<HTMLElement>('.page[data-page-index="0"]')!;
    const visibleLeft = () => viewer.getBoundingClientRect().left + viewer.clientLeft;
    viewer.scrollLeft = 0;
    const atStart = page.getBoundingClientRect().left - visibleLeft();
    viewer.scrollLeft = viewer.scrollWidth;
    const atEnd = visibleLeft() + viewer.clientWidth - page.getBoundingClientRect().right;
    return { atStart, atEnd, overflow: page.getBoundingClientRect().width - viewer.clientWidth };
  });
  expect(edges.overflow).toBeGreaterThan(0);
  expect(edges.atStart).toBeGreaterThanOrEqual(0);
  expect(edges.atEnd).toBeGreaterThanOrEqual(-0.5);
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
