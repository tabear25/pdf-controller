import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";
import type { AppOptions } from "./tests/e2e/harness";

const channel = process.env["PW_CHANNEL"] || undefined;
const port = 4173;
const fileUrl = pathToFileURL(resolve("dist/index.html")).href;

export default defineConfig<AppOptions>({
  testDir: "tests/e2e",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: true,
  workers: process.env["CI"] ? 2 : 4,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    ...(channel ? { channel } : {}),
    viewport: { width: 1280, height: 860 },
    acceptDownloads: true,
  },
  projects: [
    { name: "file", use: { appUrl: fileUrl, appMode: "file" } },
    { name: "http", use: { appUrl: `http://127.0.0.1:${port}/`, appMode: "http" } },
  ],
  webServer: {
    command: `node scripts/serve.mjs --port ${port}`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: !process.env["CI"],
    stdout: "ignore",
  },
});
