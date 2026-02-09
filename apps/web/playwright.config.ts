import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    headless: true
  },
  webServer: [
    {
      command: "pnpm --filter @cribliv/api dev",
      port: 4000,
      reuseExistingServer: true,
      timeout: 120_000
    },
    {
      command: "pnpm --filter @cribliv/web dev",
      port: 3000,
      reuseExistingServer: true,
      timeout: 120_000
    }
  ]
});
