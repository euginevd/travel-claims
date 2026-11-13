import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // @undercover/web-core is linked from packages/: its imports resolve from this app's packages.
  resolve: { preserveSymlinks: true },
  // Served as source, so an edit to it reloads like the app's own code.
  optimizeDeps: { exclude: ["@undercover/web-core"] },
  server: {
    port: 5173,
    proxy: { "/api/customer": "http://127.0.0.1:8000" },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["@testing-library/jest-dom/vitest"],
    server: { deps: { inline: ["@undercover/web-core"] } },
    coverage: {
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/main.tsx", "src/testing.ts", "src/**/*.test.{ts,tsx}"],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
