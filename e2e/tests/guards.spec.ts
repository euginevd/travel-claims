import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { CONSOLE, DASHBOARD, PORTAL } from "../playwright.config";

// No model calls: these run in CI against the stack with a dummy Claude key.

async function token(
  request: APIRequestContext,
  url: string,
  path: string,
  account: string,
) {
  const answer = await request.post(`${url}${path}`, { data: { account } });
  expect(answer.ok()).toBeTruthy();
  return ((await answer.json()) as { id_token: string }).id_token;
}

test("each audience's token is refused on the others' routes", async ({
  request,
}) => {
  const customer = await token(
    request,
    PORTAL,
    "/api/customer/dev/test-sign-in",
    "customer",
  );
  const handler = await token(
    request,
    DASHBOARD,
    "/api/staff/dev/test-sign-in",
    "handler",
  );
  const engineer = await token(
    request,
    CONSOLE,
    "/api/engineering/dev/test-sign-in",
    "engineer",
  );
  const asked = async (url: string, path: string, bearer: string) =>
    (
      await request.get(`${url}${path}`, {
        headers: { Authorization: `Bearer ${bearer}` },
      })
    ).status();

  // Through each site, as a browser would: a token from another issuer fails its signature.
  expect(await asked(DASHBOARD, "/api/staff/claims", customer)).toBe(401);
  expect(await asked(DASHBOARD, "/api/staff/claims", engineer)).toBe(401);
  expect(await asked(PORTAL, "/api/customer/claims", handler)).toBe(401);
  expect(await asked(CONSOLE, "/api/engineering/runs", customer)).toBe(401);
  // And each one's own works.
  expect(await asked(DASHBOARD, "/api/staff/claims", handler)).toBe(200);
  expect(await asked(PORTAL, "/api/customer/claims", customer)).toBe(200);
  // A site never forwards another audience's prefix.
  expect((await request.get(`${PORTAL}/api/staff/claims`)).status()).toBe(404);
});

const PAGES = [
  {
    name: "portal",
    url: PORTAL,
    signIn: /Use test account/,
    heading: "Hi Oliver",
  },
  {
    name: "dashboard",
    url: DASHBOARD,
    signIn: /Continue as Dana/,
    heading: "Claims queue",
  },
  {
    name: "console",
    url: CONSOLE,
    signIn: /Continue as Sam/,
    heading: "Scoreboard",
  },
];

// axe checks what a person reads once the page settles, not text caught mid fade-in.
test.describe("accessibility", () => {
  test.use({ reducedMotion: "reduce" });
  for (const app of PAGES) {
    test(`the ${app.name}'s sign-in and main page have no serious accessibility problems`, async ({
      page,
    }) => {
      await page.goto(app.url);
      const before = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      await page.getByRole("button", { name: app.signIn }).click();
      await expect(
        page.getByRole("heading", { level: 1, name: app.heading }),
      ).toBeVisible();
      const after = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      const serious = [...before.violations, ...after.violations]
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.id}: ${v.help} (${v.nodes.length})`);
      expect(serious).toEqual([]);
    });
  }
});
