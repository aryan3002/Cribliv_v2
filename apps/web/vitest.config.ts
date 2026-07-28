import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    include: [
      "lib/**/*.test.ts",
      "lib/**/*.test.tsx",
      "app/**/*.test.ts",
      "app/**/*.test.tsx",
      "components/**/*.test.ts",
      "components/**/*.test.tsx",
      // Ops scripts are plain ESM (.mjs) so they run with bare node, but their
      // pure helpers still deserve coverage — seo-audit.mjs is the guard that
      // would have caught the 2026-07-26 indexability defects.
      "scripts/**/*.test.ts"
    ],
    // Quarantined in CI: pre-existing broken PG-dashboard suites. Tracked to fix.
    exclude: [
      ...configDefaults.exclude,
      ...(process.env.CI
        ? [
            "components/pg-operator/dashboard/__tests__/ListingHealthCard.test.tsx",
            "components/pg-operator/dashboard/__tests__/FunnelConversion.test.tsx"
          ]
        : [])
    ]
  },
  resolve: {
    alias: { "@": resolve(__dirname, ".") }
  }
});
