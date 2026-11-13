import { useEffect, useState, type SubmitEvent } from "react";
import {
  LIVE_PERIODS,
  type AgentNode,
  type AgentsMap,
  type Api,
  type LivePeriod,
  type ThreatCoverage,
  type Trace,
} from "../api";
import { useFocusHeading } from "@undercover/web-core/useFocusHeading";

// While the agent works, the map follows it.
const POLL_MS = 4000;
const W = 168;
const H = 66;

// Where each agent sits: the claim's path in one line across the middle, customers' agents on
// the left, what the claim agent calls above and below it, the handlers' side on the right, and
// the AI engineers' agents in their own row. Hand-laid on a grid, so no line crosses a box.
const AT: Record<string, [number, number]> = {
  wattle: [110, 90],
  portal: [110, 210],
  drafting: [110, 330],
  api: [355, 210],
  screening: [600, 210],
  claim_agent: [845, 210],
  specialists: [845, 90],
  context: [845, 330],
  payout: [1090, 210],
  sign_off: [1090, 330],
  copilot: [1090, 450],
  red_team: [355, 570],
  judge: [600, 570],
  improver: [845, 570],
};

interface Edge {
  from: string;
  to: string;
  label?: string;
  /** Part of a claim's path: it moves while the agent works. */
  path?: boolean;
  gate?: "agent" | "payouts";
}

const EDGES: Edge[] = [
  { from: "wattle", to: "portal", label: "answers" },
  { from: "portal", to: "drafting", label: "words, files" },
  { from: "portal", to: "api", label: "claim", path: true },
  { from: "api", to: "screening", path: true, gate: "agent" },
  { from: "screening", to: "claim_agent", label: "clear", path: true },
  { from: "claim_agent", to: "specialists", label: "asks" },
  { from: "claim_agent", to: "context", label: "reads" },
  { from: "claim_agent", to: "payout", path: true, gate: "payouts" },
  { from: "payout", to: "sign_off", label: "over the limit", path: true },
  { from: "copilot", to: "sign_off", label: "confirm card" },
];

// The threat model's row for each agent, by the name it goes by there.
const THREAT_NAMES: Record<string, string> = {
  screening: "Hidden-instruction check",
  claim_agent: "Claim agent",
  specialists: "Specialists",
  drafting: "Drafting assistant",
  judge: "Judge",
  improver: "Improver",
  copilot: "Copilot",
};

// Names too long for a box; the card beside the map gives the full one.
const SHORT: Record<string, string> = { screening: "Instruction check" };

const ZONES = [
  { x: 10, y: 38, w: 200, h: 342, label: "TB1 · customers: untrusted" },
  { x: 500, y: 38, w: 445, h: 342, label: "TB2 · agents: output untrusted" },
  {
    x: 255,
    y: 508,
    w: 690,
    h: 100,
    label: "AI engineers' agents: attack, grade and improve, never on a live claim's path",
  },
];

function edgePoints(edge: Edge): [number, number, number, number] {
  const [x1, y1] = AT[edge.from] ?? [0, 0];
  const [x2, y2] = AT[edge.to] ?? [0, 0];
  // From the side of one box to the side of the other, whichever faces it.
  if (Math.abs(x2 - x1) > Math.abs(y2 - y1)) {
    const dir = x2 > x1 ? 1 : -1;
    return [x1 + (dir * W) / 2, y1, x2 - (dir * W) / 2, y2];
  }
  const dir = y2 > y1 ? 1 : -1;
  return [x1, y1 + (dir * H) / 2, x2, y2 - (dir * H) / 2];
}

/** Security · Agents: every agent, how they connect and what each is doing. */
/** The map itself, also shown small on the Overview: every agent and the code around it, the
 * claim's path, the two switches as gates on it, and (optionally) the trust boundaries. */
export function AgentsMapSvg({
  map,
  zones,
  selected,
  onSelect,
  path = null,
}: {
  map: AgentsMap;
  zones: boolean;
  selected: string;
  onSelect: (key: string) => void;
  /** One claim's path: the agents and code it went through; everything else is dimmed. */
  path?: Set<string> | null;
}) {
  const nodes = new Map(map.nodes.map((node) => [node.key, node]));
  const working = (map.nodes.find((n) => n.key === "claim_agent")?.working ?? 0) > 0;
  return (
    <svg
      viewBox="0 28 1200 592"
      role="img"
      aria-label="How the agents connect: the claim goes from the portal to the api, the hidden-instruction check, the claim agent, the payout code and, over the limit, a senior's sign-off."
    >
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" className="map-arrow" />
        </marker>
      </defs>
      {zones &&
        ZONES.map((zone) => (
          <g key={zone.label} className="map-zone">
            <rect x={zone.x} y={zone.y} width={zone.w} height={zone.h} rx="16" />
            <text x={zone.x + 10} y={zone.y + 16}>
              {zone.label}
            </text>
          </g>
        ))}
      {EDGES.map((edge) => {
        const [x1, y1, x2, y2] = edgePoints(edge);
        const shut =
          (edge.gate === "agent" && !map.agent_on) ||
          (edge.gate === "payouts" && map.payouts_paused);
        const busy = edge.path && working && !shut;
        const used = (nodes.get(edge.from)?.calls ?? 0) > 0 && (nodes.get(edge.to)?.calls ?? 0) > 0;
        return (
          <g
            key={`${edge.from}-${edge.to}`}
            className={`map-edge${used ? " used" : ""}${busy ? " busy" : ""}${shut ? " shut" : ""}${
              path ? (path.has(edge.from) && path.has(edge.to) ? " on-path" : " off-path") : ""
            }`}
          >
            <line x1={x1} y1={y1} x2={x2} y2={y2} markerEnd="url(#arrow)" />
            {edge.label && (
              <text
                x={x1 === x2 ? x1 + 8 : (x1 + x2) / 2}
                y={x1 === x2 ? (y1 + y2) / 2 + 4 : (y1 + y2) / 2 - 7}
                textAnchor={x1 === x2 ? "start" : "middle"}
              >
                {edge.label}
              </text>
            )}
            {edge.gate && (
              <g transform={`translate(${String((x1 + x2) / 2)} ${String((y1 + y2) / 2 + 12)})`}>
                <rect x="-36" y="-10" width="72" height="20" rx="10" className="map-gate" />
                <text textAnchor="middle" y="4" className="map-gate-text">
                  {edge.gate === "agent"
                    ? map.agent_on
                      ? "agent on"
                      : "agent off"
                    : map.payouts_paused
                      ? "paused"
                      : "payouts live"}
                </text>
              </g>
            )}
          </g>
        );
      })}
      {[...nodes.values()].map((node) => (
        <MapNode
          key={node.key}
          node={node}
          dim={path !== null && !path.has(node.key)}
          selected={node.key === selected}
          onSelect={() => {
            onSelect(node.key);
          }}
        />
      ))}
    </svg>
  );
}

/** The agents and code one claim went through, from its trace: the portal and the api always;
 * the check if it screened the claim; the agent and its context if it worked it; specialists if
 * it asked one; the payout code if approved; a senior if it was held for sign-off. */
export function pathOf(trace: Trace): Set<string> {
  const path = new Set(["portal", "drafting", "api"]);
  const said = trace.steps.map((step) => `${step.kind} ${step.content}`).join("\n");
  if (trace.steps.some((step) => step.kind === "screening")) path.add("screening");
  if (trace.model_calls.length > 0 || /tool_call/.test(said)) {
    path.add("screening");
    path.add("claim_agent");
    path.add("context");
  }
  if (/check_documents|review_medical|find_duplicate|specialist/i.test(said)) {
    path.add("specialists");
  }
  if (trace.outcome?.decision === "approve") path.add("payout");
  if (trace.status === "waiting_for_sign_off" || /sign.?off/i.test(said)) path.add("sign_off");
  return path;
}

export function AgentsPage({ api }: { api: Api }) {
  const [days, setDays] = useState<LivePeriod>(14);
  const [map, setMap] = useState<AgentsMap | null>(null);
  const [threats, setThreats] = useState<ThreatCoverage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState("claim_agent");
  const [zones, setZones] = useState(true);
  const [following, setFollowing] = useState("");
  const [path, setPath] = useState<Set<string> | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);

  async function follow(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const wanted = following.trim().toUpperCase();
    if (!wanted) {
      setPath(null);
      return;
    }
    setPathError(null);
    try {
      setPath(pathOf(await api.getTrace(wanted)));
    } catch (caught) {
      setPath(null);
      setPathError(caught instanceof Error ? caught.message : String(caught));
    }
  }
  const heading = useFocusHeading();

  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    const load = () => {
      api.getAgents(days).then(
        (found) => {
          if (!live) return;
          setMap(found);
          const busy = found.agent_on || found.nodes.some((n) => n.working > 0);
          if (busy) timer = window.setTimeout(load, POLL_MS);
        },
        (caught: unknown) => {
          if (live) setError(caught instanceof Error ? caught.message : String(caught));
        },
      );
    };
    load();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [api, days]);

  useEffect(() => {
    let live = true;
    api.getThreats().then(
      (found) => {
        if (live) setThreats(found);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api]);

  const nodes = new Map(map?.nodes.map((node) => [node.key, node]));
  const chosen = nodes.get(selected);
  const threat = threats?.agents.find((row) => row.agent === THREAT_NAMES[selected]);

  return (
    <section className="page-in agents-page" aria-labelledby="agents-heading">
      <header className="page-head">
        <div>
          <p className="eyebrow">Observe · Agents</p>
          <h1 id="agents-heading" ref={heading} tabIndex={-1}>
            The agents, and how they connect
          </h1>
          <p className="lede">
            Every agent and the code around it, with what each has done. Lines move while the agent
            works; the two switches are gates on the claim&apos;s path.
          </p>
        </div>
        <fieldset className="seg page-head-side">
          <legend>Period</legend>
          <div className="seg-track">
            {LIVE_PERIODS.map((value) => (
              <label key={value} className="seg-option">
                <input
                  type="radio"
                  name="agents-days"
                  checked={days === value}
                  onChange={() => {
                    setDays(value);
                  }}
                />
                <span>{value} days</span>
              </label>
            ))}
          </div>
        </fieldset>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {map && (
        <div className="agents-layout">
          <div className="panel agents-map">
            <div className="panel-head">
              <p className="small muted">
                Agent {map.agent_on ? "on" : "off"} · payouts{" "}
                {map.payouts_paused ? "paused" : "live"}
              </p>
              <label className="small">
                <input
                  type="checkbox"
                  checked={zones}
                  onChange={(event) => {
                    setZones(event.target.checked);
                  }}
                />{" "}
                Trust boundaries
              </label>
            </div>
            <form className="follow-claim" onSubmit={(event) => void follow(event)}>
              <label htmlFor="follow-claim">Follow a claim</label>
              <input
                id="follow-claim"
                placeholder="CLM-1017"
                value={following}
                onChange={(event) => {
                  setFollowing(event.target.value);
                }}
              />
              <button type="submit" className="button secondary">
                {following.trim() ? "Show its path" : "Clear"}
              </button>
              {path && (
                <span className="small muted">
                  Lit: the {String(path.size)} parts it went through
                </span>
              )}
              {pathError && <span className="small error-text">{pathError}</span>}
            </form>
            <AgentsMapSvg
              map={map}
              zones={zones}
              selected={selected}
              onSelect={setSelected}
              path={path}
            />
          </div>
          <aside className="panel agent-card" aria-live="polite">
            {chosen && (
              <>
                <p className="eyebrow">
                  {chosen.who === "system" ? "Claims system" : `For ${chosen.who}s`}
                </p>
                <h2>{chosen.label}</h2>
                <p className="mono small">{chosen.model ?? "Code, no model"}</p>
                <p>{chosen.detail}</p>
                <dl className="agent-facts">
                  <dt>Last {days} days</dt>
                  <dd>{chosen.calls}</dd>
                  {chosen.working > 0 && (
                    <>
                      <dt>Working now</dt>
                      <dd>{chosen.working}</dd>
                    </>
                  )}
                  {chosen.failed > 0 && (
                    <>
                      <dt>{chosen.key === "screening" ? "Stopped" : "Errors"}</dt>
                      <dd>{chosen.failed}</dd>
                    </>
                  )}
                </dl>
                {threat && (
                  <dl className="agent-threat">
                    <dt>Can use</dt>
                    <dd className="tool-chips">
                      {threat.tools.split(/,\s*/).map((tool) => (
                        <span key={tool} className="chip mono small">
                          {tool}
                        </span>
                      ))}
                    </dd>
                    <dt>Reads</dt>
                    <dd>{threat.sources}</dd>
                    <dt>Worst case if tricked</dt>
                    <dd>{threat.worst_case}</dd>
                    <dt>What stops it</dt>
                    <dd>{threat.stopped_by}</dd>
                  </dl>
                )}
              </>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}

function MapNode({
  node,
  dim,
  selected,
  onSelect,
}: {
  node: AgentNode;
  dim: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const [x, y] = AT[node.key] ?? [0, 0];
  const model = node.model?.replace("claude-", "").replace(/-\d.*$/, "") ?? "code";
  return (
    <g
      className={`map-node who-${node.who}${selected ? " selected" : ""}${node.working > 0 ? " working" : ""}${dim ? " dim" : ""}`}
      transform={`translate(${String(x - W / 2)} ${String(y - H / 2)})`}
      role="button"
      tabIndex={0}
      aria-label={`${node.label}: ${node.detail}`}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <rect width={W} height={H} rx="14" />
      <text x="14" y="24" className="map-node-name">
        {SHORT[node.key] ?? node.label}
      </text>
      <text x="14" y="44" className="map-node-model">
        {model}
      </text>
      <text x={W - 14} y="44" textAnchor="end" className="map-node-count">
        {node.working > 0 ? `${String(node.working)} working` : String(node.calls)}
      </text>
    </g>
  );
}
