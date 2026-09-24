import { defineConfig, configDefaults } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@cribliv/shared-types": path.resolve(__dirname, "../../packages/shared-types/dist")
    }
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    // Quarantined in CI: pre-existing broken suites needing external
    // services/creds the runner lacks (D7 SMS, Azure realtime, live PG DB).
    // They still run locally. Tracked to fix + un-quarantine.
    exclude: [
      ...configDefaults.exclude,
      ...(process.env.CI
        ? [
            "test/auth-d7.provider.test.ts",
            "test/voice-agent-pg.gateway.integration.test.ts",
            "test/pg-funnel.controller.integration.test.ts"
          ]
        : [])
    ],
    globals: true,
    pool: "threads",
    // Default (5000ms) is tuned for unit tests. The pg-rent integration
    // suites run real multi-statement Postgres transactions and share an
    // 8-core / 10-connections-per-pool budget across parallel test files;
    // under contention (default parallel mode) they routinely exceed 5s
    // even though nothing is deadlocked (see pg-rent-money-controllers'
    // existing 60_000 per-test override for the heaviest case). 20s keeps
    // real hangs distinguishable from load-induced slowness — it's well
    // under the 30s already budgeted for beforeAll's full Nest module
    // compile, so a test that still times out here is a genuine problem,
    // not contention.
    testTimeout: 20_000
  }
});
