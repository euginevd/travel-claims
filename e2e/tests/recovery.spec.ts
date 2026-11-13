import { expect, test } from "@playwright/test";
import { DASHBOARD } from "../playwright.config";

// A claim left in progress by a crashed agent shows as stalled, and Retry carries it on. The
// agent then works it for real: about 3 cents of Claude.
const CLAIM = "CLM-1002";

test("a handler retries a claim the agent stopped working @model", async ({ page, request }) => {
  const signIn = await request.post(`${DASHBOARD}/api/staff/dev/test-sign-in`, {
    data: { account: "senior" },
  });
  expect(signIn.ok()).toBeTruthy();
  const { id_token: token } = (await signIn.json()) as { id_token: string };
  const stall = await request.post(`${DASHBOARD}/api/staff/dev/claims/${CLAIM}/stall`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(stall.status(), "run against a fresh stack: npm run stack:down, then npm run stack").toBe(
    200,
  );

  await page.goto(DASHBOARD);
  await page.getByRole("button", { name: /Continue as Dana/ }).click();
  const row = page.getByRole("row").filter({ hasText: CLAIM });
  await expect(row.getByText("Stalled")).toBeVisible();

  await row.getByRole("link").first().click();
  await expect(page.getByText("The agent stopped working on this claim.")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("The agent is carrying this claim on")).toBeVisible();
  await expect(page.getByText("The agent stopped working on this claim.")).toBeHidden();
});
