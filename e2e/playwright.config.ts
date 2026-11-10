import { defineConfig } from "@playwright/test";

// Against a running tier 1 stack: the test stack from `npm run stack` (ports plus 100) unless
// E2E_PORTAL, E2E_DASHBOARD and E2E_CONSOLE name another.
export const PORTAL = process.env.E2E_PORTAL ?? "http://127.0.0.1:5273";
export const DASHBOARD = process.env.E2E_DASHBOARD ?? "http://127.0.0.1:5274";
export const CONSOLE = process.env.E2E_CONSOLE ?? "http://127.0.0.1:5275";

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  workers: 1,
  reporter: "list",
  use: { browserName: "chromium", trace: "retain-on-failure" },
});
