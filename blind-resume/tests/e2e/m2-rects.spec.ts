import { boxToDisplay } from "./geometry";
import {
  darkPixelRatio,
  dragOnPage,
  expect,
  manifest,
  openFixture,
  pageGeometry,
  redactionData,
  revealOnPage,
  test,
  waitForAllPagesRendered,
} from "./harness";

const near = (a: number, b: number, tolerance = 0.6): boolean => Math.abs(a - b) <= tolerance;

test("ドラッグで範囲を作ると、倍率に依存しない座標で保存される", async ({ app }) => {
  await openFixture(app, "01_embedded_resume.pdf");
  await waitForAllPagesRendered(app, 2);
  await dragOnPage(app, 0, [60, 100], [260, 160]);
  const [first] = await redactionData(app);
  expect(first).toBeDefined();
  expect(first!.page).toBe(0);
  expect(near(first!.x, 60) && near(first!.y, 100) && near(first!.width, 200) && near(first!.height, 60), JSON.stringify(first)).toBe(true);
  await expect(app.getByTestId("rect-count")).toHaveText("塗る範囲：1 件");

  const before = await pageGeometry(app, 0, false);
  await app.setViewportSize({ width: 1000, height: 860 });
  await expect.poll(async () => (await pageGeometry(app, 0, false)).scale).not.toBeCloseTo(before.scale, 3);
  const after = await pageGeometry(app, 0, false);
  const [same] = await redactionData(app);
  expect(same).toEqual(first);
  const box = (await app.getByTestId("redaction").first().boundingBox())!;
  expect(box.x - after.left).toBeCloseTo(first!.x * after.scale, 0);
  expect(box.width).toBeCloseTo(first!.width * after.scale, 0);
});

test("編集中の範囲は半透明で、下の文字が透けて見える", async ({ app }) => {
  await openFixture(app, "01_embedded_resume.pdf");
  await waitForAllPagesRendered(app, 2);
  await dragOnPage(app, 0, [60, 100], [260, 160]);
  const background = await app.getByTestId("redaction").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  const alpha = Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(background)?.[1] ?? "1");
  expect(alpha).toBeGreaterThan(0);
  expect(alpha).toBeLessThan(0.5);
});

test("移動、サイズ変更、削除、元に戻す、やり直す", async ({ app }) => {
  await openFixture(app, "01_embedded_resume.pdf");
  await waitForAllPagesRendered(app, 2);
  await dragOnPage(app, 0, [100, 200], [200, 250]);
  await dragOnPage(app, 0, [150, 225], [190, 245]);
  let [r] = await redactionData(app);
  expect(near(r!.x, 140) && near(r!.y, 220), JSON.stringify(r)).toBe(true);
  expect(near(r!.width, 100) && near(r!.height, 50)).toBe(true);

  const g = await pageGeometry(app, 0, false);
  const handle = (await app.locator(".handle-se").boundingBox())!;
  await app.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await app.mouse.down();
  await app.mouse.move(handle.x + handle.width / 2 + 30 * g.scale, handle.y + handle.height / 2 + 10 * g.scale, { steps: 6 });
  await app.mouse.up();
  [r] = await redactionData(app);
  expect(near(r!.width, 130) && near(r!.height, 60), JSON.stringify(r)).toBe(true);

  await app.keyboard.press("ArrowRight");
  await app.keyboard.press("Shift+ArrowDown");
  const [nudged] = await redactionData(app);
  expect(nudged!.x).toBeCloseTo(r!.x + 1, 2);
  expect(nudged!.y).toBeCloseTo(r!.y + 10, 2);

  await app.keyboard.press("Delete");
  await expect(app.getByTestId("redaction")).toHaveCount(0);
  await app.keyboard.press("Control+z");
  await expect(app.getByTestId("redaction")).toHaveCount(1);
  await app.keyboard.press("Control+Shift+z");
  await expect(app.getByTestId("redaction")).toHaveCount(0);
  await app.keyboard.press("Meta+z");
  await expect(app.getByTestId("redaction")).toHaveCount(1);
  await app.keyboard.press("Control+y");
  await expect(app.getByTestId("redaction")).toHaveCount(0);
  await app.getByTestId("undo").click();
  await app.getByTestId("undo").click();
  await app.getByTestId("undo").click();
  await app.getByTestId("undo").click();
  [r] = await redactionData(app);
  expect(near(r!.x, 140) && near(r!.y, 220) && near(r!.width, 100), JSON.stringify(r)).toBe(true);
  await app.getByTestId("redo").click();
  [r] = await redactionData(app);
  expect(near(r!.width, 130)).toBe(true);
});

test("Esc でドラッグを取り消すと範囲は作られない", async ({ app }) => {
  await openFixture(app, "01_embedded_resume.pdf");
  await waitForAllPagesRendered(app, 2);
  await revealOnPage(app, 0, 50, 120);
  const g = await pageGeometry(app, 0, false);
  await app.mouse.move(g.left + 50 * g.scale, g.top + 50 * g.scale);
  await app.mouse.down();
  await app.mouse.move(g.left + 150 * g.scale, g.top + 120 * g.scale, { steps: 5 });
  await app.keyboard.press("Escape");
  await app.mouse.up();
  await expect(app.getByTestId("redaction")).toHaveCount(0);
});

test("全ページの同じ位置に適用する（同じ大きさのページ）", async ({ app }) => {
  await openFixture(app, "01_embedded_resume.pdf");
  await waitForAllPagesRendered(app, 2);
  await dragOnPage(app, 0, [150, 6], [260, 22]);
  await app.getByTestId("apply-all").click();
  await expect(app.getByTestId("message")).toContainText("2 ページに、同じ位置の範囲を追加しました");
  const rects = await redactionData(app);
  expect(rects).toHaveLength(2);
  expect(rects[1]).toEqual({ ...rects[0]!, page: 1 });
  await app.getByTestId("undo").click();
  expect(await redactionData(app)).toHaveLength(1);
});

test("大きさや向きが違うページには適用せず、その旨を表示する", async ({ app }) => {
  const info = manifest.fixtures["04_rotated_sizes.pdf"]!;
  await openFixture(app, "04_rotated_sizes.pdf");
  await waitForAllPagesRendered(app, info.pages.length);
  await dragOnPage(app, 1, [20, 20], [120, 60]);
  await app.getByTestId("panel-apply-all").click();
  const message = app.getByTestId("message");
  await expect(message).toContainText("3、4 ページに、同じ位置の範囲を追加しました");
  await expect(message).toContainText("サイズや向きが違うため、1、5、6、7 ページには適用しませんでした");
  const pages = (await redactionData(app)).map((r) => r.page).sort();
  expect(pages).toEqual([1, 2, 3]);
});

const rotatedTargets: [string, number, string][] = [
  ["04_rotated_sizes.pdf", 1, "p2-header-name"],
  ["04_rotated_sizes.pdf", 2, "p3-header-name"],
  ["04_rotated_sizes.pdf", 6, "p7-header-name"],
  ["05_cropbox.pdf", 0, "p1-name"],
  ["05_cropbox.pdf", 1, "p2-name"],
  ["05_cropbox.pdf", 2, "p3-name"],
];

for (const [name, pageIndex, targetId] of rotatedTargets) {
  test(`${name} ${pageIndex + 1} ページ：画面で見た氏名の位置に範囲を作れる（${targetId}）`, async ({ app }) => {
    const info = manifest.fixtures[name]!;
    const fixturePage = info.pages[pageIndex]!;
    const target = fixturePage.targets.find((t) => t.id === targetId)!;
    const expected = boxToDisplay(fixturePage, target.bbox);
    await openFixture(app, name);
    await waitForAllPagesRendered(app, info.pages.length);
    await revealOnPage(app, pageIndex, expected.y, expected.y + expected.height);
    expect(await darkPixelRatio(app, pageIndex, expected)).toBeGreaterThan(0.01);
    await dragOnPage(app, pageIndex, [expected.x - 2, expected.y - 2], [expected.x + expected.width + 2, expected.y + expected.height + 2]);
    const [r] = await redactionData(app);
    expect(r!.page).toBe(pageIndex);
    expect(r!.x).toBeLessThanOrEqual(expected.x);
    expect(r!.y).toBeLessThanOrEqual(expected.y);
    expect(r!.x + r!.width).toBeGreaterThanOrEqual(expected.x + expected.width);
    expect(r!.y + r!.height).toBeGreaterThanOrEqual(expected.y + expected.height);
  });
}

test("別のファイルを開くと、範囲と履歴が消える", async ({ app }) => {
  await openFixture(app, "01_embedded_resume.pdf");
  await waitForAllPagesRendered(app, 2);
  await dragOnPage(app, 0, [60, 100], [260, 160]);
  await openFixture(app, "02_nonembedded.pdf");
  await waitForAllPagesRendered(app, 1);
  await expect(app.getByTestId("redaction")).toHaveCount(0);
  await expect(app.getByTestId("undo")).toBeDisabled();
  await expect(app.getByTestId("rect-count")).toHaveText("塗る範囲：0 件");
});
