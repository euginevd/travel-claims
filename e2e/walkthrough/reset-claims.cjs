// Reset claims only, keeping evaluations and red-team results, then turn the agent back on and
// wait for it to work the queue. Run before the customer scene, so Oliver's claim is new.
const { chromium } = require("@playwright/test");
const say = (ok, what) => console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1710, height: 1270 } });
  await page.goto("http://127.0.0.1:5174/");
  await page.getByRole("button", { name: /Continue as Dana/ }).click();
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.waitForTimeout(2000);
  await page.goto("http://127.0.0.1:5174/#/settings");
  await page.waitForTimeout(2500);
  await page.getByRole("checkbox").nth(4).waitFor({ timeout: 20000 });
  // In order: claims, evaluations, red-team results, agent off, payouts off. Keep only claims.
  for (const i of [1, 2, 4]) {
    const box = page.getByRole("checkbox").nth(i);
    if (await box.isChecked()) await box.uncheck();
  }
  console.log(JSON.stringify(await page.getByRole("checkbox").evaluateAll((els) => els.map((e) => e.checked))));
  await page.getByRole("button", { name: "Reset the demo" }).click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Yes, reset" }).click();
  await page.getByText(/Reset\. The demo starts fresh/).waitFor({ timeout: 60000 });
  say(true, "claims reset");
  await page.goto("http://127.0.0.1:5174/");
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /Agent off/ }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole("dialog").getByRole("textbox").fill("Recording the walkthrough");
  await page.getByRole("dialog").getByRole("button", { name: /Turn the agent on/ }).click();
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(15000);
    await page.reload();
    await page.waitForTimeout(2500);
    const t = await page.locator("main").innerText();
    const waiting = /Waiting for the agent\s*(\d+)/.exec(t)?.[1];
    const working = /Agent working\s*(\d+)/.exec(t)?.[1];
    console.log(`waiting=${waiting} working=${working}`);
    if (waiting === "0" && working === "0") break;
  }
  await browser.close();
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
