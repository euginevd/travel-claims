// The demo home: live status dots, live numbers, the diagram's details and one claim's journey.
// No customer data is read here.

const PARTS = {
  portal: ["Customer portal", "Claim from a photo. Get paid to a PayID. Own sign-in."],
  dashboard: ["Handler workspace", "Case briefs, sign-offs and the Copilot. Own sign-in."],
  console: ["AI assurance", "Evaluations, improvements and the red team. Own sign-in."],
  api: ["The api", "The only place money moves. Enforces the $1,000 limit and pays once."],
  copilot: ["Copilot", "The handlers' chat agent. Acts with their access, never more."],
  agent: ["Claim agent", "Checks for hidden instructions, reads the policy, decides with sources."],
  context: ["Context over MCP", "Policy wording and the claims manual, each answer sourced."],
  db: ["PostgreSQL", "Records, memory and saved progress. Receipts under random names."],
  claude: ["Claude", "Sonnet decides, Haiku checks. Bedrock in Australia on AWS."],
};

const JOURNEY = [
  { nodes: ["portal"], edges: [], text: "Oliver claims a late flight in one tap" },
  { nodes: ["api"], edges: ["portal-api"], text: "The api checks his token and records it" },
  { nodes: ["dashboard", "api"], edges: ["dashboard-api"], text: "Dana presses Work" },
  { nodes: ["agent"], edges: ["api-agent"], text: "The injection check reads it first" },
  { nodes: ["agent", "context", "claude"], edges: ["agent-context", "agent-claude"], text: "The agent reads the policy and decides" },
  { nodes: ["api"], edges: ["api-agent"], text: "The api checks the $1,000 limit" },
  { nodes: ["api", "db"], edges: ["api-db"], text: "Paid once, to his PayID" },
  { nodes: ["portal"], edges: ["portal-api"], text: "Oliver sees Paid, with a text" },
];

function showPart(name) {
  const part = PARTS[name];
  if (!part) return;
  document.getElementById("detail-title").textContent = part[0];
  document.getElementById("detail-what").textContent = part[1];
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
  let at = -1;
  const next = document.getElementById("journey-next");
  const back = document.getElementById("journey-back");
  const count = document.getElementById("journey-count");
  const line = document.getElementById("journey-line");
  function render() {
    const step = at >= 0 ? JOURNEY[at] : null;
    highlight(step);
    count.textContent = step ? `Step ${String(at + 1)} of ${String(JOURNEY.length)}` : "One claim, start to paid";
    line.textContent = step ? step.text : "Press play";
    back.disabled = at < 0;
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

// Links to the other apps use this page's own host, so it works on localhost or 127.0.0.1.
function setUpLinks() {
  document.querySelectorAll("[data-port]").forEach((link) => {
    const url = new URL(window.location.href);
    url.port = link.dataset.port;
    url.pathname = "/";
    url.hash = "";
    url.search = "";
    link.href = url.toString();
  });
}

// Each app's dot: green if it answers, red if not. A no-cors request only tells us it's up.
function checkHealth() {
  document.querySelectorAll("[data-health]").forEach((card) => {
    const dot = card.querySelector(".dot");
    fetch(card.href, { mode: "no-cors", cache: "no-store" }).then(
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
      if (stats.decided) {
        setStat("agent_share", `${String(Math.round((stats.decided_by_agent / stats.decided) * 100))}%`);
      }
      if (stats.average_cost) setStat("average_cost", `$${stats.average_cost.toFixed(2)}`);
      if (stats.redteam_attacks) {
        setStat("redteam", `${String(stats.redteam_held)}/${String(stats.redteam_attacks)}`);
      }
    })
    .catch(() => {
      // The numbers shown in the page stand in when the api isn't there.
    });
}

setUpLinks();
setUpDiagram();
setUpJourney();
checkHealth();
loadStats();
setInterval(checkHealth, 15000);
