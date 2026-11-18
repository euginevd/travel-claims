// Scenes 1 and 2: the project page, then the repo (layout, README, architecture, threat model).
const { scene } = require("./rec.cjs");
const SLIDE = "file:///" + __dirname.replace(/\\/g, "/") + "/slide.html";
const which = process.argv.slice(2);
const want = (n) => !which.length || which.includes(n);

(async () => {
  if (want("01-landing"))
    await scene("01-landing", async (r) => {
      const p = r.page;
      await p.goto("http://127.0.0.1:5172/");
      await p.waitForTimeout(2500);
      await r.move(960, 600, 1);
      await r.start();
      await r.cap("<b>UnderCover</b>: a team of AI agents that settles routine travel insurance claims, while claims experts make the judgement calls.", 3400);
      await r.point(p.locator(".hero-flow, figure").first());
      await r.wait(600);
      await r.cap("Three apps: a <b>portal</b> for customers, a <b>dashboard</b> for claims handlers, and an <b>AI control plane</b> for engineers.", 0);
      const cards = p.getByRole("link", { name: /Open/ });
      for (let i = 0; i < 3; i++) { await r.point(cards.nth(i)); await r.wait(450); }
      await r.wait(700);
      await r.cap("It starts with the code.", 0);
      await r.point(p.getByRole("link", { name: /Code on GitHub/ }));
      await r.wait(900);
    });

  if (want("02-repo"))
    await scene("02-repo", async (r) => {
      const p = r.page;
      await p.goto("https://github.com/euginevd/travel-claims");
      await p.waitForLoadState("networkidle").catch(() => {});
      await p.waitForTimeout(1500);
      await r.start();
      await r.tag("The repo", "repo");
      await r.cap("One repo: the agents, API, MCP servers and three web apps in <b>apps/</b>, Terraform in <b>infra/</b>, decisions and the threat model in <b>docs/</b>.", 0);
      const files = p.locator('table[aria-labelledby="folders-and-files"], [aria-labelledby="folders-and-files"]').first();
      if (await files.count()) await r.spot(files);
      await r.wait(3900);
      await r.spot(null);
      await r.cap("Every PR runs secret, dependency, IaC and code scans, CodeQL, unit tests, end-to-end tests and the agent's exam.", 0);
      await r.scroll(Math.max(0, (await p.locator("#readme, article.markdown-body").first().boundingBox())?.y - 80 || 900), 1200);
      await r.wait(2300);
      await p.goto(SLIDE + "?k=architecture-overview");
      await p.waitForTimeout(900);
      await r.tag("Architecture", "repo");
      await r.cap("On AWS, the agents run on <b>Bedrock AgentCore</b> in private subnets, reach tools only through an <b>MCP gateway under Cedar policy</b>, and call Claude on Bedrock.", 1900);
      await p.evaluate(() => window.focusOn(0.7, 0.3, 1.75));
      await r.wait(3400);
      await p.goto(SLIDE + "?k=threat-model");
      await p.waitForTimeout(900);
      await r.tag("Threat model", "sec");
      await r.cap("A <b>STRIDE threat model</b> came before the code: trust boundaries, each threat numbered where it lands, with the control that stops it.", 2000);
      await p.evaluate(() => window.focusOn(0.55, 0.22, 1.6));
      await r.wait(2000);
      await r.cap("Top risk, <b>R1</b>: prompt injection in a claim or receipt. A separate check reads every claim before any agent does.", 0);
      await p.evaluate(() => window.focusOn(0.2, 0.84, 1.9));
      await r.wait(3500);
    });
})().catch((e) => { console.error("ERROR", e); process.exit(1); });
