import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { blindResumePlugin } from "./scripts/build-plugin.mjs";

export const BUNDLED_PACKAGES = ["pdfjs-dist"];

export default defineConfig({
  base: "./",
  plugins: [blindResumePlugin({ bundledPackages: BUNDLED_PACKAGES }), viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    target: "es2023",
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    chunkSizeWarningLimit: 20000,
    reportCompressedSize: false,
    sourcemap: false,
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
