import { expect, test } from "@playwright/test";
import { CONSOLE, DASHBOARD, PORTAL } from "../playwright.config";

// Each app's main page, signed in with its test account. No model calls.
const APPS = [
  { name: "portal", url: PORTAL, heading: "My claims" },
  { name: "dashboard", url: DASHBOARD, heading: "Claims queue" },
  { name: "console", url: CONSOLE, heading: "Scoreboard" },
];

for (const app of APPS) {
  test(`the ${app.name} signs in with its test account`, async ({ page }) => {
    await page.goto(app.url);
    await page.getByRole("button", { name: /Use test account/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: app.heading })).toBeVisible();
  });
}
