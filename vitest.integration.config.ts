import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.integration.test.{ts,tsx}"],
    testTimeout: 30000,
    sequence: {
      concurrent: false,
    },
    pool: "forks",
  },
});
