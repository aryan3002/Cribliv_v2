import { defineConfig } from "vitest/config";
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
    globals: true,
    pool: "threads"
  }
});
