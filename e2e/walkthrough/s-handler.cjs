// Scene 4: Dana, a senior handler, picks up Oliver's referred claim, asks the Copilot, decides it.
const fs = require("fs");
const path = require("path");
const { scene } = require("./rec.cjs");
const CLAIM = fs.readFileSync(path.join(__dirname, "claim.txt"), "utf8").trim();
if (!/^CLM-\d+$/.test(CLAIM)) throw new Error(`claim.txt doesn't hold a claim number: ${CLAIM}`);

(async () => {
  await scene("04-handler", async (r) => {
    const p = r.page;
    await p.goto("http://127.0.0.1:5174/");
    await p.getByRole("button", { name: /Continue as Dana/ }).click();
    await p.getByRole("heading", { level: 1 }).waitFor();
    await p.waitForTimeout(3000);
    await r.move(900, 500, 1);
    await r.start();
    await r.tag("The claims handler", "product");
    await r.cap("Dana, a senior claims handler, starts from <b>Today</b>: what needs her, worked out from the queue.", 2600);
    await p.goto(`http://127.0.0.1:5174/#/claims/${CLAIM}`);
    await p.getByRole("heading", { level: 1, name: new RegExp(CLAIM) }).waitFor();
    await r.wait(900);
    await r.cap("The agent assessed Oliver's claim: payable at <b>$174.87</b>, and every check cites the policy wording, the claims manual or a document.", 0);
    await r.spot(p.locator(".verdict-checks").first());
    await r.wait(3700);
    await r.cap("But it's his <b>third claim in 12 months</b>. A rule in the claims manual sends it to a person, whatever its merits, and nothing tips Oliver off.", 0);
    await r.spot(p.locator(".next-step").first());
    await r.wait(4000);
    await r.spot(null);
    await r.cap("Dana asks the <b>Copilot</b>. It reads the claim, its documents and his history, and answers with sources.", 0);
    await r.click(p.getByRole("button", { name: /Ask Wattle/ }).first());
    const panel = p.getByRole("complementary", { name: "Wattle AI" });
    const box = panel.getByRole("textbox").last();
    await r.type(box, "Anything besides the repeat-claims rule to check before I clear it?");
    await p.keyboard.press("Enter");
    await r.fast(14, async () => {
      for (let i = 0; i < 60; i++) {
        await p.waitForTimeout(1000);
        if (i > 2 && !(await panel.getByRole("status").count())) break;
      }
    });
    await r.wait(3800);
    await r.click(panel.getByRole("button", { name: /Close/ }).first()).catch(() => {});
    await p.keyboard.press("Escape").catch(() => {});
    await r.wait(500);
    await r.cap("Dana makes the call. Code pays it, within her limit, and the decision is on the record: who, when and why.", 0);
    await r.click(p.getByRole("button", { name: /^Approve/ }).first());
    const amount = p.getByLabel("Amount to pay (US dollars)");
    if ((await amount.inputValue()) === "") await r.type(amount, "174.87");
    await r.type(p.getByLabel("Note for the record"), "Investigations cleared it; the airline confirms the delay.");
    await r.wait(600);
    await r.click(p.getByRole("button", { name: "Confirm decision" }));
    await r.wait(2500);
    await r.cap("Paid. Oliver sees the decision on his claim, and the audit log keeps it.", 0);
    await r.point(p.getByText(/Paid/).first());
    await r.wait(2300);
  });
})().catch((e) => { console.error("ERROR", e); process.exit(1); });
