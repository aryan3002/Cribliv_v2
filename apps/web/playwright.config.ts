import { defineConfig } from "@playwright/test";

const E2E_API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:4000/v1";

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
      // DATABASE_URL and the FF_*/RAZORPAY_*/PAYMENT_WEBHOOK_SECRET vars are
      // passthroughs (`${VAR:-default}`) — unset in the invoking shell they
      // resolve to the same empty/off defaults as before (in-memory API,
      // flags off), so the default `pnpm test:e2e` run is unchanged. Suites
      // that need real leads/wallet persistence (e.g. lead-credit-purchase)
      // export DATABASE_URL to a local Postgres and the FF_* flags before
      // invoking Playwright — see docs/superpowers/specs/2026-07-10-lead-monetization-design.md.
      command:
        'DATABASE_URL="${DATABASE_URL:-}" DISABLE_RATE_LIMIT=true OTP_PROVIDER=mock FF_CALLBACK_LEADS="${FF_CALLBACK_LEADS:-}" FF_LEAD_MANAGEMENT_ENABLED="${FF_LEAD_MANAGEMENT_ENABLED:-}" FF_CREDIT_PURCHASE_ENABLED="${FF_CREDIT_PURCHASE_ENABLED:-}" RAZORPAY_ORDERS_MODE="${RAZORPAY_ORDERS_MODE:-mock}" RAZORPAY_CHECKOUT_SECRET="${RAZORPAY_CHECKOUT_SECRET:-e2e_checkout_secret}" PAYMENT_WEBHOOK_SECRET="${PAYMENT_WEBHOOK_SECRET:-e2e_webhook_secret}" corepack pnpm --filter @cribliv/api dev',
      port: 4000,
      reuseExistingServer: true,
      timeout: 120_000
    },
    {
      command: `AUTH_SECRET=cribliv-e2e-secret NEXTAUTH_SECRET=cribliv-e2e-secret NEXT_PUBLIC_API_BASE_URL="${E2E_API_BASE_URL}" API_BASE_URL="${E2E_API_BASE_URL}" NEXT_PUBLIC_FF_CALLBACK_LEADS="\${NEXT_PUBLIC_FF_CALLBACK_LEADS:-}" NEXT_PUBLIC_FF_CREDIT_PURCHASE_ENABLED="\${NEXT_PUBLIC_FF_CREDIT_PURCHASE_ENABLED:-}" corepack pnpm --filter @cribliv/web dev`,
      port: 3000,
      reuseExistingServer: true,
      timeout: 120_000
    }
  ]
});
