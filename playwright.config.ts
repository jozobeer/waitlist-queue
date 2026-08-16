import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testIgnore: "**/unit/**",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:8787" },
  webServer: {
    // ローカル D1 は migrations を自動適用しないため、dev 起動前に適用する（--local は .wrangler/ 内で完結）
    command: "npx wrangler d1 migrations apply waitlist-queue --local && npx wrangler dev --port 8787",
    url: "http://127.0.0.1:8787/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
