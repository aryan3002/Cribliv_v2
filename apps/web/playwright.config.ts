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
      command:
        "DATABASE_URL= DISABLE_RATE_LIMIT=true OTP_PROVIDER=mock corepack pnpm --filter @cribliv/api dev",
      port: 4000,
      reuseExistingServer: true,
      timeout: 120_000
    },
    {
      command:
        "AUTH_SECRET=cribliv-e2e-secret NEXTAUTH_SECRET=cribliv-e2e-secret NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/v1 API_BASE_URL=http://localhost:4000/v1 corepack pnpm --filter @cribliv/web dev",
      port: 3000,
      reuseExistingServer: true,
      timeout: 120_000
    }
  ]
});
