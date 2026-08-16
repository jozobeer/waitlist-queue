/// <reference types="vitest/config" />
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// singlefile で public/index.html に全 JS/CSS をインライン化する。
// file:// での視覚検証と「単一ファイルが UI の正本」不変条件が依存するため外さないこと
export default defineConfig({
  base: "./",
  publicDir: false,
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    viteSingleFile(),
  ],
  build: { outDir: "public", emptyOutDir: true },
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node" },
});
