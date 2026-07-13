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
    pool: "threads"
  }
});
