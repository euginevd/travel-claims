// The project page: live status dots, live numbers, the diagram's details and one claim's journey.
// No customer data is read here.

// Each part of the target-state architecture, for AI, system and security architects:
// what it does, the tech, its endpoints or tools, its security controls, and what runs today.
const SPEC = {
  customer: {
    zone: "People", title: "Customer",
    what: "A traveller making and following claims in the customer portal.",
    facts: {
      Identity: "Cognito customer user pool, Google federation; ID token for the customer audience only",
      Reaches: "The portal over CloudFront; the api's /api/customer routes",
      Security: "Sees only their own policies, claims and receipts; a referral's internal reason is never shown",
    },
  },
  handler: {
    zone: "People", title: "Claims expert",
    what: "A claims handler working the queue; senior handlers also sign off large payouts and hold the payouts switch.",
    facts: {
      Identity: "Cognito staff user pool, MFA; ID token for the staff audience; seniors carry the sign-off right",
      Reaches: "The dashboard; the api's /api/staff routes and the Copilot",
      Security: "Allowed networks only in tier 2; every sign-off, override and send-back is recorded with who and why",
    },
  },
  engineer: {
    zone: "People", title: "AI engineer",
    what: "Evaluates, improves and red-teams the claim agent from the AI assurance console.",
    facts: {
      Identity: "Its own Cognito pool, issuer and audience: a handler's token opens nothing here",
      Reaches: "The console; the api's /api/engineering routes",
      Security: "Separated from claims work (NIST 800-53 SC-2): changing the agent and moving money are different roles",
    },
  },
  developer: {
    zone: "Delivery", title: "Developer and AI coding agent",
    what: "Builds UnderCover with a secure agentic SDLC: spec, plan, threat model, then code through a protected main.",
    facts: {
      Workflow: "AGENTS.md rules, a pre-push scan (Gitleaks, Trivy), one PR per plan with a security summary",
      Security: "No direct pushes to main; merges only with passing checks; no cloud credentials on the laptop",
    },
  },
  cdn: {
    zone: "Edge", title: "Route 53 and CloudFront",
    what: "DNS and the edge for the three apps: static files cached, /api forwarded to the load balancer.",
    facts: {
      Tech: "Route 53, CloudFront with origin access control, AWS Shield Standard",
      Security: "TLS 1.2+ only, HSTS, strict CSP and no-sniff headers; the origin isn't reachable around the edge",
      Today: "nginx in each app's container sets the same headers on localhost",
    },
  },
  waf: {
    zone: "Edge", title: "AWS WAF",
    what: "Filters every request before it reaches the VPC.",
    facts: {
      Rules: "AWS managed common, known-bad-inputs and IP reputation rules; rate limits per IP on sign-in and /api/customer/ask",
      Security: "Blocks floods and scanners at the edge; logs to S3 for the security team",
      Today: "Rate limits in the api (drafts and questions per customer per hour)",
    },
  },
  cognito: {
    zone: "Identity", title: "Amazon Cognito",
    what: "Three user pools, one per audience: customers, staff and AI engineers.",
    facts: {
      Tokens: "RS256 ID tokens; the api checks signature, issuer, audience, expiry and group on every request",
      Security: "A token for one audience fails the others' checks before any role check (decisions 10 and 12)",
      Today: "A local stand-in issues Cognito-shaped tokens, so the api's checks are the same",
    },
  },
  alb: {
    zone: "Public subnets", title: "Application Load Balancer",
    what: "The only public entry into the VPC, in front of the EKS services.",
    facts: {
      Tech: "AWS Load Balancer Controller on EKS, target groups per service",
      Security: "Accepts traffic from CloudFront only; TLS to private targets; no public IPs on nodes",
    },
  },
  portal: {
    zone: "EKS · customer namespace", title: "portal: customer portal",
    what: "React, Vite and TypeScript SPA served by nginx: claim from a photo, flight-delay claims, cover, PayID, Updates and Wattle AI.",
    facts: {
      Endpoints: "/api/customer: claims, receipts, drafts, delays, cover, payid, notices, draft, ask",
      Security: "nginx proxies only /api/customer; strict CSP (self only), no inline script; receipts checked by their bytes",
      Today: "Docker on localhost:5173",
    },
  },
  dashboard: {
    zone: "EKS · staff namespace", title: "dashboard: handler workspace",
    what: "React SPA for claims experts: the queue, case briefs, risk signals, asking customers, letters and sign-off.",
    facts: {
      Endpoints: "/api/staff: claims, work, sign-off, send-back, override, requests, risk, letter, payouts, trace; /api/copilot",
      Security: "nginx proxies only staff and Copilot routes; Copilot acts with the handler's own token",
      Today: "Docker on localhost:5174",
    },
  },
  console: {
    zone: "EKS · engineering namespace", title: "console: AI assurance",
    what: "React SPA for AI engineers: scoreboard, claim traces, improvement rounds, red team and threat coverage.",
    facts: {
      Endpoints: "/api/engineering: runs, configuration, rounds, redteam, threats, claims/{id}/trace",
      Security: "Its own issuer and audience; reachable only by AI engineers",
      Today: "Docker on localhost:5175",
    },
  },
  api: {
    zone: "EKS · core namespace", title: "api: claims, limits and payments",
    what: "The only place records change and money moves. FastAPI on Python with SQLAlchemy.",
    facts: {
      Endpoints: "/api/customer, /api/staff, /api/engineering, and /api/agent for the agent's key",
      Controls: "$1,000 approval limit and one payment per claim in code; payouts switch; decision records checked against the claims manual",
      Security: "One auth gate per route, deny by default; IRSA role reads only its secrets and buckets; personal data redacted from logs",
    },
  },
  agent: {
    zone: "EKS · ai namespace", title: "agent: Claude agents",
    what: "LangGraph agents: hidden-instruction check, claim agent with specialists, dispatcher, improver, drafting assistant, letters, Wattle AI for customers and engineers, and the red team.",
    facts: {
      Calls: "Bedrock (Claude Sonnet for decisions, Haiku for checks and drafts); the context MCP server; the api with its own key",
      Security: "Claim text is data, never instructions; tools take the claim from the session, not the model; egress only to Bedrock and in-cluster services",
      Today: "Anthropic API with made-up data only",
    },
  },
  copilot: {
    zone: "EKS · staff namespace", title: "copilot: handlers' agent",
    what: "A chat agent that answers from the records and acts as the signed-in handler.",
    facts: {
      Calls: "The api's staff routes with the handler's token; Bedrock",
      Security: "Never the agent's key; signs off a payout only after the handler confirms on a card; token kept out of checkpoints",
    },
  },
  context: {
    zone: "EKS · ai namespace", title: "context: MCP server",
    what: "Policy wording, claims manual, plans, rules and reference data as MCP tools, each answer with its source.",
    facts: {
      Tools: "search_documents, read_section, lookup_term, get_plan, get_claim_rules, search_reference_data",
      Security: "Read-only; the customer assistant sees policy-wording results only, never the claims manual",
    },
  },
  aurora: {
    zone: "Private data subnets", title: "Aurora PostgreSQL",
    what: "Claims, decisions, payments, the agents' saved progress and memory, evaluations, notices and letters.",
    facts: {
      Tech: "Aurora PostgreSQL, Multi-AZ, Alembic migrations on start",
      Security: "KMS encryption at rest, TLS in transit, IAM auth, no public access; security groups from the api and agent only",
      Today: "PostgreSQL in Docker",
    },
  },
  s3: {
    zone: "Private data subnets", title: "S3 receipts bucket",
    what: "Customers' receipts under random names.",
    facts: {
      Security: "Block public access, SSE-KMS, gateway endpoint only, bucket policy for the api's role; served to handlers as downloads, never a public URL",
      Today: "A Docker volume behind the same storage module",
    },
  },
  secrets: {
    zone: "Private data subnets", title: "Secrets Manager and KMS",
    what: "The agent's api key, database credentials and signing keys.",
    facts: {
      Security: "Customer-managed KMS keys, rotation, interface endpoints; pods read secrets through IRSA, nothing in images or env files",
      Today: "A local .env that is never committed",
    },
  },
  bedrock: {
    zone: "Managed AI", title: "Amazon Bedrock",
    what: "Claude Sonnet and Haiku for the agents.",
    facts: {
      Tech: "Australian cross-region inference profile, reached over PrivateLink",
      Security: "Claim data stays in Australia and off the internet; model invocation logging to CloudWatch; per-workload spending limits",
      Today: "The Anthropic API with made-up data only",
    },
  },
  guard: {
    zone: "Managed AI", title: "Bedrock Guardrails and the injection check",
    what: "Two layers in front of every model call: the app's hidden-instruction check and Bedrock Guardrails.",
    facts: {
      Controls: "Prompt-attack and denied-topic filters, PII masking in outputs; the check refers any claim that tries to instruct the AI",
      Evidence: "Red team: 8 attack claims mapped to OWASP LLM01, LLM06 and ASI01; threat coverage maps OWASP to MITRE ATLAS",
    },
  },
  ecr: {
    zone: "Supply chain", title: "Amazon ECR",
    what: "The container images every service runs.",
    facts: {
      Security: "Scan on push, immutable tags, images pinned by digest and signed; EKS admits signed images only",
    },
  },
  obs: {
    zone: "Security and observability", title: "Audit, detection and posture",
    what: "Everything that happens is recorded and watched.",
    facts: {
      Services: "CloudTrail, CloudWatch logs and alarms, GuardDuty (with EKS protection), Security Hub, AWS Config",
      Evidence: "Every AI decision traced end to end in the app: steps, sources, model, tokens and cost",
    },
  },
  github: {
    zone: "DevSecOps", title: "GitHub",
    what: "One repo for apps and Terraform.",
    facts: {
      Controls: "Protected main with a ruleset: PRs only, up to date, required checks; Dependabot with a 7-day cooldown",
    },
  },
  actions: {
    zone: "DevSecOps", title: "Actions checks",
    what: "Every PR is scanned and tested before it can merge.",
    facts: {
      Tools: "Semgrep, CodeQL, Gitleaks, Trivy, an SBOM, ruff, pyright, pytest, ESLint, Vitest with coverage gates",
      Security: "Actions pinned by commit SHA; a security summary comment on each PR",
    },
  },
  oidc: {
    zone: "DevSecOps", title: "OIDC to IAM",
    what: "GitHub Actions assumes short-lived AWS roles.",
    facts: {
      Security: "No stored AWS keys; roles scoped per environment and branch; separate plan and apply roles",
    },
  },
  terraform: {
    zone: "DevSecOps", title: "Terraform",
    what: "All AWS infrastructure as code, one unit per app.",
    facts: {
      Controls: "fmt, validate and plan on every PR; a person approves the plan before apply; state encrypted and locked",
    },
  },
  ecrpush: {
    zone: "DevSecOps", title: "Build, scan and sign",
    what: "Each service's image is built once and promoted.",
    facts: {
      Controls: "SBOM attached, Trivy scan gate, image signed, pushed to ECR by digest",
    },
  },
  deploy: {
    zone: "DevSecOps", title: "Deploy to EKS",
    what: "The same image runs in dev and prod.",
    facts: {
      Controls: "dev on merge, prod by hand with approval; health checks; roll back to the previous digest",
    },
  },
};

const FLOWS = {
  claim: {
    nodes: ["customer", "cdn", "waf", "alb", "portal", "api", "aurora", "s3", "cognito"],
    edges: ["cust-cdn", "cdn-waf", "waf-alb", "alb-portal", "portal-api", "api-aurora", "api-s3", "cdn-cog"],
  },
  decide: {
    nodes: ["handler", "dashboard", "api", "agent", "context", "guard", "bedrock", "aurora"],
    edges: ["hand-cdn", "alb-dash", "dash-api", "api-agent", "agent-context", "agent-guard", "guard-bedrock", "agent-aurora"],
  },
  deliver: {
    nodes: ["developer", "github", "actions", "oidc", "terraform", "ecrpush", "deploy", "ecr"],
    edges: ["dev-gh", "gh-actions", "actions-oidc", "oidc-tf", "tf-ecr", "ecr-deploy", "deploy-eks", "ecr-eks"],
  },
};

function showPart(name) {
  const part = SPEC[name];
  if (!part) return;
  document.getElementById("spec-zone").textContent = part.zone;
  document.getElementById("spec-title").textContent = part.title;
  document.getElementById("spec-what").textContent = part.what;
  const facts = document.getElementById("spec-facts");
  facts.replaceChildren();
  for (const [key, value] of Object.entries(part.facts)) {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value;
    facts.append(dt, dd);
  }
  document.querySelectorAll(".n").forEach((node) => {
    node.classList.toggle("selected", node.dataset.node === name);
  });
}

function lightFlow(name) {
  const flow = FLOWS[name];
  document.querySelectorAll(".flow").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.flow === name));
  });
  document.querySelectorAll(".n").forEach((node) => {
    node.classList.toggle("lit", Boolean(flow && flow.nodes.includes(node.dataset.node)));
  });
  document.querySelectorAll(".e").forEach((edge) => {
    edge.classList.toggle("lit", Boolean(flow && flow.edges.includes(edge.dataset.edge)));
  });
  document.querySelector(".net").classList.toggle("flowing", Boolean(flow));
}

function setUpDiagram() {
  document.querySelectorAll(".n").forEach((node) => {
    node.addEventListener("click", () => showPart(node.dataset.node));
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showPart(node.dataset.node);
      }
    });
  });
  let current = "";
  document.querySelectorAll(".flow").forEach((button) => {
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      current = current === button.dataset.flow ? "" : button.dataset.flow;
      lightFlow(current);
    });
  });
}

// Each app's address: on AWS from links.json, which the deploy writes; locally this host and its port.
const PORT_APP = { 5173: "portal", 5174: "dashboard", 5175: "console" };
let links = null;

function appUrl(port) {
  if (links && links[PORT_APP[port]]) return links[PORT_APP[port]];
  const url = new URL(window.location.href);
  url.port = port;
  url.pathname = "/";
  url.hash = "";
  url.search = "";
  return url.toString();
}

function setUpLinks() {
  document.querySelectorAll("a[data-port]").forEach((link) => {
    link.href = appUrl(link.dataset.port);
  });
}

// Each app's dot: green if it answers, red if not. A no-cors request only tells us it's up.
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
    const port = picks.find((p) => p.dataset.clip === name).dataset.port;
    document.getElementById("player-url").textContent = links ? new URL(appUrl(port)).host : clip.host;
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

function tenths(part, whole) {
  return `${String(Math.round((part / whole) * 10))} in 10`;
}

function within(seconds) {
  if (seconds <= 30) return "in under 30 seconds";
  if (seconds <= 60) return "in under a minute";
  return `in under ${String(Math.ceil(seconds / 60))} minutes`;
}

function loadStats() {
  fetch("/api/demo/stats", { headers: { Accept: "application/json" } })
    .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
    .then((stats) => {
      if (stats.decided) {
        setStat("ai_share", tenths(stats.decided_by_ai, stats.decided));
        setStat("expert_share", tenths(stats.decided - stats.decided_by_ai, stats.decided));
        setStat("traced", `${String(Math.round((stats.traced / stats.decided) * 100))}%`);
      }
      if (stats.slowest_seconds) setStat("ai_time", within(stats.slowest_seconds));
      if (stats.held_out_claims) {
        setStat("held_out", `${String(stats.held_out_matched)} of ${String(stats.held_out_claims)}`);
      }
      if (stats.redteam_attacks) {
        setStat("redteam", `${String(stats.redteam_held)} of ${String(stats.redteam_attacks)}`);
      }
    })
    .catch(() => {
      // The numbers in the page stand in when the api isn't there.
    });
}

function loadLinks() {
  return fetch("links.json", { headers: { Accept: "application/json" }, cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((found) => {
      links = found && typeof found.portal === "string" ? found : null;
    })
    .catch(() => {
      // Locally there's no links.json, so the apps are on this host's ports.
    });
}

setUpDiagram();
loadStats();
loadLinks().then(() => {
  setUpLinks();
  setUpPlayer();
  checkHealth();
  setInterval(checkHealth, 15000);
});
