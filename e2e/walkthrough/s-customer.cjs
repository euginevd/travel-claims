// Scene 3: Oliver claims for his delayed bag in Queenstown, by chat, and sends it.
const fs = require("fs");
const path = require("path");
const { scene } = require("./rec.cjs");
const RECEIPTS = path.resolve(__dirname, "../../data/sample-receipts");
const FILES = [
  `${RECEIPTS}/05-queenstown-clothes-bag-delayed.png`,
  `${RECEIPTS}/06-queenstown-airline-delay-report.png`,
];

async function settle(page) {
  await page.waitForTimeout(1500);
  for (let i = 0; i < 90; i++) {
    const busy = await page.getByText(/Looking into it|Putting your claim together|Reading|Thinking|Checking/).count();
    if (!busy) break;
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(500);
}

(async () => {
  await scene("03-customer", async (r) => {
    const p = r.page;
    const tail = async () => (await p.locator("main").innerText()).replace(/\n+/g, " / ");
    await p.goto("http://127.0.0.1:5173/");
    await p.getByRole("button", { name: "Use test account" }).waitFor();
    await r.move(960, 700, 1);
    await r.start();
    await r.tag("The customer", "product");
    await r.cap("Oliver's bag didn't arrive in <b>Queenstown</b>. He signs in to the customer portal.", 1600);
    await r.click(p.getByRole("button", { name: "Use test account" }));
    await p.getByRole("heading", { level: 1 }).waitFor();
    await r.wait(1600);
    await r.cap("He tells <b>Wattle</b>, the portal's AI assistant, what happened, in his own words.", 0);
    const box = () => p.getByRole("textbox").last();
    await r.type(box(), "My bag didn't arrive when I flew into Queenstown on 5 November. I had to buy clothes and toiletries until it turned up two days later.");
    await r.wait(400);
    await p.keyboard.press("Enter");
    await r.fast(12, () => settle(p));
    await r.wait(1400);
    let attached = false;
    for (let turn = 0; turn < 12; turn++) {
      const all = await tail();
      const last = all.slice(-420);
      console.log(`TURN ${turn}: ${last.slice(-220)}`);
      const send = p.getByRole("button", { name: /^Send claim$/ });
      if (await send.count()) {
        await r.cap("Wattle drafts the claim from his words and files. Oliver checks it and sends it.", 0);
        await r.point(p.locator("main").getByText(/Total|claiming|\$\d/).last());
        await r.wait(2000);
        await r.click(send);
        await r.fast(12, () => settle(p));
        await r.cap("Sent in about a minute: no forms. The claims agent picks it up straight away.", 2300);
        const id = /CLM-\d+/.exec(await tail())?.[0];
        console.log("CLAIM", id);
        if (id) fs.writeFileSync(path.join(__dirname, "claim.txt"), id);
        break;
      }
      if (!attached && /receipt|Add photos or files|Snap them|upload/i.test(last.slice(-300))) {
        attached = true;
        await r.cap("Wattle asks only for what's missing. Oliver adds the shop's receipt and the airline's delay report.", 0);
        await p.locator('input[type="file"]').first().setInputFiles(FILES);
        await r.fast(12, () => settle(p));
        const add = p.getByRole("button", { name: /^(Add|Send these|Done)$/ });
        if (await add.count()) { await r.click(add.first()); await r.fast(12, () => settle(p)); }
        await r.wait(1500);
        continue;
      }
      if (/When was it late\?/.test(last.slice(-260))) {
        await r.type(box(), "On my flight into Queenstown");
        await p.keyboard.press("Enter");
        await r.fast(12, () => settle(p));
        await r.wait(900);
        continue;
      }
      if (/Where were you when it happened\?/.test(last.slice(-200))) {
        await r.type(box(), "Queenstown Airport");
        await p.keyboard.press("Enter");
        await r.fast(12, () => settle(p));
        continue;
      }
      if (/already pay|reimburse|paid you|refund/.test(last.slice(-200))) {
        await r.type(box(), "No, nothing.");
        await p.keyboard.press("Enter");
        await r.fast(12, () => settle(p));
        continue;
      }
      let clicked = false;
      for (const name of ["Looks right", "Yes, that's right", "Yes"]) {
        const b = p.getByRole("button", { name: new RegExp(`^${name}`) });
        if (await b.count()) { await r.click(b.first()); clicked = true; break; }
      }
      if (!clicked) { console.log("STUCK"); break; }
      await r.fast(12, () => settle(p));
      await r.wait(900);
    }
  });
})().catch((e) => { console.error("ERROR", e); process.exit(1); });
