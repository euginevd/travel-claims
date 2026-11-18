// The walkthrough's thumbnail, drawn from slide.html and saved at the player's 1600x900.
const path = require("path");
const { chromium } = require("@playwright/test");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  await p.goto("file:///" + __dirname.replaceAll(path.sep, "/") + "/slide.html?k=poster");
  await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(__dirname, "poster.png") });
  await b.close();
})();
