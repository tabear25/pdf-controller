import { mkdirSync } from "node:fs";
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

const scenes = {
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
