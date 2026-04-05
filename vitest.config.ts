import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/**/*.integration.test.{ts,tsx}"],
    testTimeout: 15000,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "html", "json-summary"],
      reportsDirectory: "./coverage",
      include: [
        "src/stores/**/*.ts",
        "src/hooks/**/*.ts",
        "src/lib/**/*.ts",
        "src/components/**/*.tsx",
      ],
      exclude: [
        "src/**/*.test.*",
        "src/test/**",
        "src/types/**",
        "src/data/**",
        "src/main.tsx",
        "src/vite-env.d.ts",
      ],
    },
  },
});
