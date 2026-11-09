// The demo home's behaviour: live dots for each app, live numbers, the architecture details and
// the step-through of one claim. No data about any customer is read here.

const PARTS = {
  portal: {
    title: "portal: the customer portal",
    what: "Customers make a claim from photos with an AI drafting assistant, claim delayed flights in one tap, answer what we ask for and follow every step.",
    facts: { Tech: "React, Vite, nginx", Port: "5173", Trust: "Customer issuer and audience", Reaches: "/api/customer only" },
  },
  dashboard: {
    title: "dashboard: the handlers' workspace",
    what: "Handlers work the queue, read the agent's case brief and checklist, ask customers for documents, and sign off, send back or override.",
    facts: { Tech: "React, Vite, nginx", Port: "5174", Trust: "Staff issuer and audience", Reaches: "/api/staff and the Copilot" },
  },
  console: {
    title: "console: the AI engineers' console",
    what: "AI engineers score the agent against handlers' decisions, approve or reject its proposed improvements, and run the red team.",
    facts: { Tech: "React, Vite, nginx", Port: "5175", Trust: "Engineering issuer and audience", Reaches: "/api/engineering only" },
  },
  api: {
    title: "api: claims, payments and limits",
    what: "The one place records change. It enforces the $1,000 approval limit, pays a claim once at most, holds the kill switch and sends customers their updates.",
    facts: { Tech: "Python, FastAPI, SQLAlchemy", Gates: "One auth gate per route: agent key, or a token from the right issuer", Data: "PostgreSQL, receipts volume" },
  },
  copilot: {
    title: "copilot: the handlers' chat agent",
    what: "Answers questions about the queue, a claim or a customer, and acts as the signed-in handler with that handler's own access.",
    facts: { Tech: "Python, Claude tool use", Acts: "With the handler's token, never more" },
  },
  agent: {
    title: "agent: the claim agent",
    what: "Works one claim: a hidden-instruction check first, then the agent reads the claim, policy and receipts, asks specialists, calculates the payout and records a decision with its sources.",
    facts: { Tech: "Python, LangGraph", Models: "Claude Sonnet 5.5, Haiku 5.5", Also: "Dispatcher, improver, drafting assistant, red team" },
  },
  context: {
    title: "context: policy wording over MCP",
    what: "Serves the policy wording, claims manual, plan limits and reference data as an MCP server, so every answer the agent uses has a named source.",
    facts: { Tech: "Python, MCP", Owners: "Legal, claims operations" },
  },
  db: {
    title: "PostgreSQL and receipts",
    what: "Claims, decisions, payments, the agent's saved progress and memory, evaluations, notices and drafts. Receipts are files under random names.",
    facts: { Locally: "Docker volume", "Stage 2": "Aurora PostgreSQL and a private S3 bucket" },
  },
  claude: {
    title: "Claude",
    what: "The models behind the agents. The Anthropic API locally; Amazon Bedrock with an Australian inference profile in stage 2, so claim data stays in Australia.",
    facts: { Models: "Sonnet 5.5 for decisions, Haiku 5.5 for lighter work" },
  },
};

const JOURNEY = [
  { nodes: ["portal"], edges: [], text: "Oliver taps Claim $35.00 on his delayed flight. The portal sends it with his customer token." },
  { nodes: ["api"], edges: ["portal-api"], text: "The api checks the token's issuer and audience, records the claim with the flight-status record, and texts Oliver his claim number." },
  { nodes: ["dashboard", "api"], edges: ["dashboard-api"], text: "Dana presses Work. The api hands the claim to the agent." },
  { nodes: ["agent"], edges: ["api-agent"], text: "The hidden-instruction check reads the claim and receipts first. Nothing tries to instruct the AI, so the claim agent starts." },
  { nodes: ["agent", "context", "claude"], edges: ["agent-context", "agent-claude"], text: "The agent reads the policy, looks up the delay cover over MCP and reasons with Claude, recording every step and its source." },
  { nodes: ["api"], edges: ["api-agent"], text: "The agent asks the api to calculate the payout and records an approval. The api checks it against the $1,000 limit and the kill switch." },
  { nodes: ["api", "db"], edges: ["api-db"], text: "Under the limit: the api pays it once, to Oliver's PayID, and records who decided and why." },
  { nodes: ["portal"], edges: ["portal-api"], text: "Oliver's claim shows Paid, sent to his PayID, with an email and a text in Updates." },
];

function showPart(name) {
  const part = PARTS[name];
  if (!part) return;
  document.getElementById("detail-title").textContent = part.title;
  document.getElementById("detail-what").textContent = part.what;
  const facts = document.getElementById("detail-facts");
  facts.replaceChildren();
  for (const [key, value] of Object.entries(part.facts)) {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value;
    facts.append(dt, dd);
  }
  document.querySelectorAll(".node").forEach((node) => {
    node.classList.toggle("selected", node.dataset.node === name);
  });
}

function highlight(step) {
  document.querySelectorAll(".node").forEach((node) => {
    node.classList.toggle("lit", Boolean(step && step.nodes.includes(node.dataset.node)));
  });
  document.querySelectorAll(".edge").forEach((edge) => {
    edge.classList.toggle("lit", Boolean(step && step.edges.includes(edge.dataset.edge)));
  });
}

function setUpJourney() {
  const list = document.getElementById("journey-steps");
  JOURNEY.forEach((step, index) => {
    const item = document.createElement("li");
    item.textContent = step.text;
    item.dataset.index = String(index);
    list.append(item);
  });
  let at = -1;
  const next = document.getElementById("journey-next");
  const back = document.getElementById("journey-back");
  function render() {
    list.querySelectorAll("li").forEach((item) => {
      const index = Number(item.dataset.index);
      item.classList.toggle("current", index === at);
      item.classList.toggle("done", index < at);
    });
    highlight(at >= 0 ? JOURNEY[at] : null);
    back.disabled = at < 0;
    next.textContent = at < 0 ? "Start" : at >= JOURNEY.length - 1 ? "Start again" : "Next step";
  }
  next.addEventListener("click", () => {
    at = at >= JOURNEY.length - 1 ? -1 : at + 1;
    render();
  });
  back.addEventListener("click", () => {
    at = Math.max(-1, at - 1);
    render();
  });
  render();
}

function setUpDiagram() {
  document.querySelectorAll(".node").forEach((node) => {
    node.addEventListener("click", () => showPart(node.dataset.node));
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showPart(node.dataset.node);
      }
    });
  });
}

// Each app's dot: green if it answers, red if not. A no-cors request only tells us it's reachable.
function checkHealth() {
  document.querySelectorAll("[data-health]").forEach((card) => {
    const dot = card.querySelector(".dot");
    fetch(card.dataset.health, { mode: "no-cors", cache: "no-store" }).then(
      () => {
        dot.className = "dot up";
        dot.title = "Running";
      },
      () => {
        dot.className = "dot down";
        dot.title = "Not running";
      },
    );
  });
}

function setStat(name, value) {
  const el = document.querySelector(`[data-stat="${name}"]`);
  if (el) el.textContent = value;
}

function loadStats() {
  fetch("/api/demo/stats", { headers: { Accept: "application/json" } })
    .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
    .then((stats) => {
      setStat("claims", String(stats.claims));
      setStat(
        "agent_share",
        stats.decided ? `${String(Math.round((stats.decided_by_agent / stats.decided) * 100))}%` : "–",
      );
      setStat("average_cost", stats.average_cost ? `$${stats.average_cost.toFixed(3)}` : "–");
      setStat(
        "redteam",
        stats.redteam_attacks ? `${String(stats.redteam_held)} of ${String(stats.redteam_attacks)}` : "not run",
      );
    })
    .catch(() => {
      // The numbers are a bonus; the page works without the api.
    });
}

setUpDiagram();
setUpJourney();
checkHealth();
loadStats();
setInterval(checkHealth, 15000);
