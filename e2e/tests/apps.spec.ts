import { expect, test } from "@playwright/test";
import { CONSOLE, DASHBOARD, PORTAL } from "../playwright.config";

// Each app's main page, signed in with its test account. No model calls.
const APPS = [
  {
    name: "portal",
    url: PORTAL,
    heading: "Hi Oliver",
    signIn: /Use test account/,
  },
  {
    name: "dashboard",
    url: DASHBOARD,
    heading: /^Good \w+, Dana$/,
    signIn: /Continue as Dana/,
  },
  {
    name: "console",
    url: CONSOLE,
    heading: /^Good \w+, Sam$/,
    signIn: /Continue as Sam/,
  },
];

for (const app of APPS) {
  test(`the ${app.name} signs in with its test account`, async ({ page }) => {
    await page.goto(app.url);
    await page.getByRole("button", { name: app.signIn }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: app.heading }),
    ).toBeVisible();
  });
}
