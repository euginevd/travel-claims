// The project page: live status dots, live numbers, the diagram's details and one claim's journey.
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
  document.querySelectorAll("a[data-port]").forEach((link) => {
    const url = new URL(window.location.href);
    url.port = link.dataset.port;
    url.pathname = "/";
    url.hash = "";
    url.search = "";
    link.href = url.toString();
  });
}

// Each app's dot: green if it answers, red if not. A no-cors request only tells us it's up.
function appUrl(port) {
  const url = new URL(window.location.href);
  url.port = port;
  url.pathname = "/";
  url.hash = "";
  url.search = "";
  return url.toString();
}

function checkHealth() {
  document.querySelectorAll("[data-health-port]").forEach((dot) => {
    fetch(appUrl(dot.dataset.healthPort), { mode: "no-cors", cache: "no-store" }).then(
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

// The big player: one app's clip at a time, moving to the next when it ends.
const CLIPS = {
  portal: { host: "localhost:5173", label: "Open the customer portal", who: "Oliver Grant" },
  handler: { host: "localhost:5174", label: "Open the handler workspace", who: "Dana Whitfield" },
  console: { host: "localhost:5175", label: "Open AI assurance", who: "Sam Carter" },
};
const ORDER = ["portal", "handler", "console"];

function setUpPlayer() {
  const video = document.getElementById("player");
  const picks = [...document.querySelectorAll(".pick")];
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let current = "portal";

  function select(name, play) {
    current = name;
    const clip = CLIPS[name];
    picks.forEach((pick) => {
      const on = pick.dataset.clip === name;
      pick.setAttribute("aria-selected", String(on));
      pick.querySelector(".bar i").style.width = "0";
    });
    document.getElementById("player-url").textContent = clip.host;
    document.querySelectorAll(".go-app").forEach((link) => {
      link.classList.toggle("current", link.dataset.port === picks.find((p) => p.dataset.clip === name).dataset.port);
    });
    video.poster = `img/${name}.webp`;
    if (still) {
      video.removeAttribute("src");
      video.load();
      return;
    }
    video.src = `media/${name}.mp4`;
    if (play) video.play().catch(() => undefined);
  }

  picks.forEach((pick) => {
    pick.addEventListener("click", () => select(pick.dataset.clip, true));
  });
  video.addEventListener("timeupdate", () => {
    if (!video.duration) return;
    const bar = picks.find((p) => p.dataset.clip === current).querySelector(".bar i");
    bar.style.width = `${String((video.currentTime / video.duration) * 100)}%`;
  });
  video.addEventListener("ended", () => {
    select(ORDER[(ORDER.indexOf(current) + 1) % ORDER.length], true);
  });
  select("portal", true);
}

function setStat(name, value) {
  const el = document.querySelector(`[data-stat="${name}"]`);
  if (el) el.textContent = value;
}

function loadStats() {
  fetch("/api/demo/stats", { headers: { Accept: "application/json" } })
    .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
    .then((stats) => {
      if (stats.decided) {
        const tenths = Math.round((stats.decided_by_agent / stats.decided) * 10);
        setStat("agent_share", `${String(tenths)} in 10`);
      }
      if (stats.agent_seconds) {
        const secs = stats.agent_seconds;
        setStat(
          "agent_seconds",
          secs < 90 ? `about ${String(secs)} seconds` : `about ${String(Math.round(secs / 60))} minutes`,
        );
      }
      setStat("need_a_handler", String(stats.need_a_handler));
      if (stats.redteam_attacks) {
        setStat("redteam", `${String(stats.redteam_held)} of ${String(stats.redteam_attacks)}`);
      }
    })
    .catch(() => {
      // The numbers in the page stand in when the api isn't there.
    });
}

setUpLinks();
setUpPlayer();
setUpDiagram();
setUpJourney();
checkHealth();
loadStats();
setInterval(checkHealth, 15000);
