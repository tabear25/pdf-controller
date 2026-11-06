import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const milestone = process.argv[2] ?? "m1";
const outDir = resolve("docs/screenshots");
const appUrl = pathToFileURL(resolve("dist/index.html")).href;
const fixture = (name) => resolve("tests/fixtures/pdf", name);

async function openFixture(page, name) {
  await page.setInputFiles('[data-testid="file-input"]', fixture(name));
  await page.locator('.page[data-page-index="0"][data-state="rendered"]').waitFor();
}

async function drag(page, pageIndex, from, to) {
  const el = page.locator(`.page[data-page-index="${pageIndex}"]`);
  await page.evaluate(
    ({ pageIndex, y }) => {
      const pageEl = document.querySelector(`.page[data-page-index="${pageIndex}"]`);
      const viewer = document.querySelector(".viewer");
      const scale = pageEl.clientWidth / Number(pageEl.dataset.displayWidth);
      const top = pageEl.getBoundingClientRect().top + y * scale;
      const box = viewer.getBoundingClientRect();
      viewer.scrollTop += top - (box.top + box.height / 3);
    },
    { pageIndex, y: Math.min(from[1], to[1]) },
  );
  await el.locator(".page-canvas").waitFor();
  const box = await el.boundingBox();
  const scale = box.width / Number(await el.getAttribute("data-display-width"));
  await page.mouse.move(box.x + from[0] * scale, box.y + from[1] * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0] * scale, box.y + to[1] * scale, { steps: 6 });
  await page.mouse.up();
}

const manifest = JSON.parse(readFileSync(resolve("tests/fixtures/manifest.json"), "utf8"));

async function redactTargets(page, name, ids) {
  const info = manifest.fixtures[name];
  for (let i = 0; i < info.pages.length; i++) {
    const p = info.pages[i];
    const top = p.cropBox[3];
    for (const t of p.targets) {
      if (!ids.some((id) => t.id.includes(id))) continue;
      const [x0, y0, x1, y1] = t.bbox;
      await drag(page, i, [x0 - p.cropBox[0] - 2, top - y1 - 2], [x1 - p.cropBox[0] + 2, top - y0 + 2]);
    }
  }
}

async function exportReview(page) {
  await page.getByTestId("export").click();
  await page.getByTestId("export-start").click();
  await page.getByTestId("review").waitFor({ timeout: 120000 });
  await page.locator('.preview-row[data-rendered="true"]').first().waitFor();
  await page.getByTestId("confirm").check();
}

const scenes = {
  m3: [
    {
      file: "m3-01-review.png",
      run: async (page) => {
        await openFixture(page, "01_embedded_resume.pdf");
        await redactTargets(page, "01_embedded_resume.pdf", ["header-name", "footer-name", "p1-kana", "p1-name", "p1-birth", "p1-gender", "p1-address", "p1-station", "p1-phone", "p1-email", "p1-url", "p1-photo"]);
        await exportReview(page);
      },
    },
    {
      file: "m3-02-review-scan.png",
      run: async (page) => {
        await openFixture(page, "07_scan_image_only.pdf");
        await redactTargets(page, "07_scan_image_only.pdf", ["scan-header", "scan-name", "scan-phone", "scan-email", "scan-address", "scan-photo"]);
        await exportReview(page);
      },
    },
  ],
  m2: [
    {
      file: "m2-01-rect-editing.png",
      run: async (page) => {
        await openFixture(page, "01_embedded_resume.pdf");
        await drag(page, 0, [126, 16], [180, 33]);
        await drag(page, 0, [116, 150], [205, 182]);
      },
    },
    {
      file: "m2-02-apply-all-skipped.png",
      run: async (page) => {
        await openFixture(page, "04_rotated_sizes.pdf");
        await drag(page, 1, [30, 20], [150, 60]);
        await page.getByTestId("panel-apply-all").click();
        await page.getByTestId("message").waitFor();
      },
    },
  ],
  m1: [
    { file: "m1-01-start.png", run: async () => {} },
    { file: "m1-02-embedded-resume.png", run: (page) => openFixture(page, "01_embedded_resume.pdf") },
    { file: "m1-03-nonembedded-japanese.png", run: (page) => openFixture(page, "02_nonembedded.pdf") },
    { file: "m1-04-scan-ccitt.png", run: (page) => openFixture(page, "07_scan_image_only.pdf") },
    {
      file: "m1-05-password.png",
      run: async (page) => {
        await page.setInputFiles('[data-testid="file-input"]', fixture("09_password.pdf"));
        await page.getByRole("dialog", { name: "パスワードの入力" }).waitFor();
      },
    },
  ],
};

const list = scenes[milestone];
if (!list) {
  console.error(`unknown milestone: ${milestone}`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
for (const scene of list) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(appUrl);
  await scene.run(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(outDir, scene.file) });
  await context.close();
  console.log(`saved docs/screenshots/${scene.file}`);
}
await browser.close();
