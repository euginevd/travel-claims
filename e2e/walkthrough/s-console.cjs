// Scenes 5 to 9: the AI control plane. Observe (team, map, the claim's trace), Evaluate,
// Secure, Govern; then the end card.
const fs = require("fs");
const path = require("path");
const { scene } = require("./rec.cjs");
const CLAIM = fs.readFileSync(path.join(__dirname, "claim.txt"), "utf8").trim();
if (!/^CLM-\d+$/.test(CLAIM)) throw new Error(`claim.txt doesn't hold a claim number: ${CLAIM}`);
const C = "http://127.0.0.1:5175/";
const SLIDE = "file:///" + __dirname.replace(/\\/g, "/") + "/slide.html";
const which = process.argv.slice(2);
const want = (n) => !which.length || which.includes(n);

async function signIn(p) {
  await p.goto(C);
  await p.getByRole("button", { name: /Continue as Sam/ }).click();
  await p.getByRole("heading", { level: 1 }).waitFor();
  await p.waitForTimeout(3500);
}

async function go(r, hash, wait = 2200) {
  await r.page.goto(C + hash);
  await r.page.waitForTimeout(wait);
}

(async () => {
  if (want("05-overview"))
    await scene("05-overview", async (r) => {
      const p = r.page;
      await signIn(p);
      await r.move(900, 520, 1);
      await r.start();
      await r.tag("AI engineering", "eng");
      await r.cap("The <b>AI control plane</b>. Nine Claude agents, each with its model, its work and its cost, beside a live feed of every tool call and hand-off.", 0);
      await r.spot(p.locator(".team-row").first());
      await r.wait(4600);
      await r.spot(null);
      await r.click(p.getByRole("link", { name: /^Claim agent:/ }));
      await p.waitForTimeout(1800);
      await r.cap("Each agent opens its <b>tools</b>, what it reads, its <b>worst case if tricked</b>, and what stops it. The claim's path runs left to right.", 0);
      await r.spot(p.locator(".agent-card").first());
      await r.wait(4300);
      await r.spot(null);
    });

  if (want("06-trace"))
    await scene("06-trace", async (r) => {
      const p = r.page;
      await signIn(p);
      await p.goto(C + `#/trace/${CLAIM}`);
      await p.waitForTimeout(3000);
      await r.move(700, 600, 1);
      await r.start();
      await r.tag("AI engineering", "eng");
      await r.cap(`Oliver's claim, <b>${CLAIM}</b>, step by step: screened for hidden instructions first, then his policy, the documents specialist and tools over MCP.`, 0);
      const panel = (name) => p.locator(".panel", { has: p.getByRole("heading", { name, exact: true }) }).first();
      await r.spot(panel("What happened"));
      await r.wait(2600);
      await r.spot(null);
      await r.point(p.locator(".trace-timeline").first());
      await r.scroll(420, 1500);
      const step = p.locator(".trace-timeline").getByText(/document checker|Asked the documents/i).first();
      if (await step.count()) { await r.click(step); await r.wait(2600); }
      await r.cap("Every model call with its tokens, time and cost. Every tool took the claim from the session, <b>never from the model</b>.", 0);
      await r.spot(panel("Security"));
      await r.wait(3000);
      await r.spot(panel("Cost"));
      await r.wait(2600);
      await r.spot(null);
    });

  if (want("07-evaluate"))
    await scene("07-evaluate", async (r) => {
      const p = r.page;
      await signIn(p);
      await p.goto(C + "#/scoreboard");
      await p.waitForTimeout(3000);
      await r.move(900, 500, 1);
      await r.start();
      await r.tag("AI engineering", "eng");
      await r.cap("Every agent version sits an <b>exam</b>: claims experts' decisions on held-out claims, scored on accuracy, safety and cost.", 4600);
      await go(r, "#/compare", 2600);
      await r.cap("Models are compared on the same claims, so the cheapest one that meets the targets runs.", 3800);
      await go(r, "#/versions", 2600);
      await r.cap("An <b>improver</b> agent proposes a change and an engineer approves it, but the exam and the red team decide. This round's proposal was <b>rolled back</b>: it settled fewer claims without a person.", 5800);
    });

  if (want("08-secure"))
    await scene("08-secure", async (r) => {
      const p = r.page;
      await signIn(p);
      await p.goto(C + "#/posture");
      await p.waitForTimeout(3000);
      await r.move(900, 400, 1);
      await r.start();
      await r.tag("AI security", "sec");
      await r.cap("<b>Would we stop an attack?</b> Worked out in code from the latest red-team run, four threat frameworks and what fired on live claims.", 0);
      await r.wait(3800);
      await r.cap("Every risk in OWASP's <b>LLM</b> and <b>Agentic Top 10</b>, the <b>MCP Top 10</b> and CSA <b>MAESTRO</b>, mapped to its control and the attacks that test it.", 0);
      await r.point(p.locator(".live-detail-body").first());
      await r.scroll(300, 900);
      await r.wait(800);
      await r.click(p.locator("label", { hasText: "Agentic Top 10" }).first());
      await r.wait(2200);
      await r.click(p.locator("label", { hasText: "MCP Top 10" }).first());
      await r.wait(1800);
      await r.click(p.locator("label", { hasText: "MAESTRO" }).first());
      await r.wait(2000);
      await go(r, "#/redteam", 2400);
      await r.cap("The <b>red team</b> attacks through the real portal: instructions hidden in receipts, forged approvals, a walk toward a payout promise.", 0);
      await r.wait(1000);
      await r.point(p.locator(".table-wrap").first());
      await r.scroll(900, 2400);
      await r.wait(700);
      await go(r, "#/guardrails", 2400);
      await r.cap("On live claims, the <b>guardrails</b> show what they caught, each one opening its claim's trace.", 3600);
    });

  if (want("09-govern"))
    await scene("09-govern", async (r) => {
      const p = r.page;
      await signIn(p);
      await p.goto(C + "#/cost");
      await p.waitForTimeout(3000);
      await r.move(900, 500, 1);
      await r.start();
      await r.tag("Govern", "eng");
      await r.cap("Under a cent of Claude a claim, against a <b>daily budget</b> that stops the agent on its own.", 4200);
      await r.cap("And one click stops the agent or pauses every payout, with the reason on the record.", 0);
      await r.point(p.getByRole("button", { name: /Payouts live|Agent on/ }).first());
      await r.wait(3200);
    });

  if (want("10-end"))
    await scene("10-end", async (r) => {
      const p = r.page;
      await p.goto(SLIDE + "?k=end");
      await r.start();
      await p.waitForTimeout(5200);
    });
})().catch((e) => { console.error("ERROR", e); process.exit(1); });
