// The Overview's centre: the agent team as personas, and what the agents are doing now. One
// poll feeds both, every few seconds while the page is in view. The feed names a tool but never
// its arguments, and never a claim's words: the api sends nothing more.
import {
  BookOpen,
  ClipboardCheck,
  FileSearch,
  HeartPulse,
  MessageSquare,
  PenLine,
  RefreshCw,
  Scale,
  Shield,
  ShieldCheck,
  Sparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import type { Activity, AgentEvent, Api, Persona } from "../api";
import { dollars } from "../format";
import { AGENTS_HREF, LIVE_HREF, agentHref, traceHref } from "../useHashRoute";

const POLL_MS = 4000;
// The team's figures count 14 days, so they're asked for once a minute; the feed every poll.
const TEAM_EVERY = 15;

const ICONS: Record<AgentEvent["agent"] | NonNullable<AgentEvent["to"]>, LucideIcon> = {
  claim_agent: Scale,
  screening: ShieldCheck,
  documents: FileSearch,
  medical: HeartPulse,
  wattle: MessageSquare,
  drafting: PenLine,
  copilot: Sparkles,
  judge: ClipboardCheck,
  improver: RefreshCw,
  guardian: Shield,
  context: BookOpen,
  api: Wrench,
};

const NAMES: Record<AgentEvent["agent"] | NonNullable<AgentEvent["to"]>, string> = {
  claim_agent: "Claim agent",
  screening: "Instruction check",
  documents: "Documents",
  medical: "Medical",
  wattle: "Wattle",
  drafting: "Drafting",
  copilot: "Copilot",
  judge: "Judge",
  improver: "Improver",
  guardian: "Guardian",
  context: "Context (MCP)",
  api: "API",
};

// Code, not a model: drawn plain, without the AI badge.
const CODE = new Set(["guardian", "context", "api"]);

/** "claude-haiku-5-5" as a short chip: "haiku 5.5". */
function shortModel(model: string | null): string {
  if (!model) return "code";
  const [, name = model, major, minor] = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(model) ?? [];
  return major ? `${name} ${major}.${minor ?? "0"}` : name;
}

/** How long ago, short: "4 s", "6 min", "2 h", "3 d". */
export function ago(at: string | null, now: number = Date.now()): string {
  if (!at) return "";
  const seconds = Math.max(0, Math.round((now - new Date(at).getTime()) / 1000));
  if (seconds < 60) return `${String(seconds)} s`;
  if (seconds < 3600) return `${String(Math.round(seconds / 60))} min`;
  if (seconds < 86_400) return `${String(Math.round(seconds / 3600))} h`;
  return `${String(Math.round(seconds / 86_400))} d`;
}

/** The activity, polled while the page is in view, one request at a time; null until the
 * first answer. The team comes with the first answer and then once a minute. */
function useActivity(api: Api): { activity: Activity | null; failed: boolean } {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let pending = false;
    let polls = 0;
    let teamLoaded = false;
    const get = () => {
      if (pending || document.visibilityState === "hidden") return;
      // Until a team has arrived, every poll asks for it: a failed first answer isn't kept empty.
      const withTeam = !teamLoaded || polls % TEAM_EVERY === 0;
      polls += 1;
      pending = true;
      api.getActivity(withTeam).then(
        (found) => {
          pending = false;
          if (withTeam) teamLoaded = true;
          if (!live) return;
          setActivity((before) =>
            withTeam || !before ? found : { team: before.team, events: found.events },
          );
          setFailed(false);
        },
        () => {
          pending = false;
          if (live) setFailed(true);
        },
      );
    };
    get();
    const timer = window.setInterval(get, POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [api]);
  return { activity, failed };
}

function AgentIcon({ agent, size }: { agent: keyof typeof ICONS; size: "big" | "small" }) {
  const Icon = ICONS[agent];
  return (
    <span className={`agent-icon ${size}${CODE.has(agent) ? " code" : ""}`} aria-hidden="true">
      <Icon size={size === "big" ? 18 : 14} strokeWidth={1.8} />
    </span>
  );
}

function PersonaCard({ persona }: { persona: Persona }) {
  return (
    <li>
      <a
        className={`persona${persona.key === "claim_agent" ? " lead" : ""}`}
        href={agentHref(persona.key)}
        aria-label={`${persona.name}: ${persona.voice}. Open its tools, risks and what stops them`}
      >
        <AgentIcon agent={persona.key} size="big" />
        <div className="persona-body">
          <p className="persona-name">
            <b>{persona.name}</b>
            <span className={`persona-state${persona.working ? " on" : ""}`}>
              <i aria-hidden="true" />
              {persona.working ? "Working" : "Idle"}
            </span>
          </p>
          <p className="persona-voice" title={persona.voice}>
            {persona.voice}
          </p>
          <p className="persona-work">
            <span className="persona-model mono">{shortModel(persona.model)}</span>
            {/* Each figure stays on one line: "0 model calls" never splits. */}
            {[
              ...persona.work.split(" · "),
              ...(persona.cost !== null && persona.cost > 0 ? [dollars(persona.cost)] : []),
            ].map((part, index) => (
              <Fragment key={part}>
                {index > 0 && " · "}
                <span className="persona-figure">{part}</span>
              </Fragment>
            ))}
          </p>
        </div>
      </a>
    </li>
  );
}

/** What an event did, in words: "called get_policy", "asked Medical". */
function eventWords(event: AgentEvent): string {
  switch (event.kind) {
    case "tool":
      return `called ${event.tool}`;
    case "read":
      return "read the policy";
    case "ask":
      return `asked ${event.to ? NAMES[event.to] : "a specialist"}`;
    case "clear":
      return "cleared the claim";
    case "flag":
      return "flagged hidden instructions";
    case "held":
      return "held a payout for sign-off";
    case "error":
      return "stopped with an error";
    case "answer":
      return event.agent === "wattle" ? "answered a customer" : "answered a handler";
  }
}

const TAGS: Partial<Record<AgentEvent["kind"], { label: string; tone: string }>> = {
  ask: { label: "agent → agent", tone: "a2a" },
  clear: { label: "clear", tone: "ok" },
  flag: { label: "flagged", tone: "warn" },
  held: { label: "held", tone: "warn" },
  error: { label: "error", tone: "bad" },
};

/** Back-to-back events that are the same step on the same claim, shown once with a count:
 * four reads of the policy in a row are one row, "×4". */
export function runs(events: AgentEvent[]): { event: AgentEvent; count: number }[] {
  // The same as the row reads: who, what in words, and which claim.
  const same = (a: AgentEvent, b: AgentEvent) =>
    a.agent === b.agent && eventWords(a) === eventWords(b) && a.claim_id === b.claim_id;
  const out: { event: AgentEvent; count: number }[] = [];
  for (const event of events) {
    const last = out.at(-1);
    if (last && same(last.event, event)) last.count += 1;
    else out.push({ event, count: 1 });
  }
  return out;
}

function EventRow({ event, count, fresh }: { event: AgentEvent; count: number; fresh: boolean }) {
  const tag = TAGS[event.kind];
  // An arrow only from one agent to another: a tool or the policy is in the words already.
  const handoff = event.to && !CODE.has(event.to) ? event.to : null;
  const body = (
    <>
      <span className="event-who">
        <AgentIcon agent={event.agent} size="small" />
        {handoff && (
          <>
            <span className="event-arrow" aria-hidden="true">
              →
            </span>
            <AgentIcon agent={handoff} size="small" />
          </>
        )}
      </span>
      <span className="event-what">
        <b>{NAMES[event.agent]}</b> {eventWords(event)}
        {tag && <span className={`event-tag ${tag.tone}`}>{tag.label}</span>}
        {count > 1 && <span className="event-count">×{count}</span>}
        {event.claim_id && <small className="mono">{event.claim_id}</small>}
      </span>
      <span className="event-when muted small">{ago(event.at)}</span>
    </>
  );
  return (
    <li className={fresh ? "event fresh" : "event"}>
      {event.claim_id ? (
        <a
          href={traceHref(event.claim_id)}
          aria-label={`${NAMES[event.agent]} ${eventWords(event)}${count > 1 ? ` ${String(count)} times` : ""}, ${event.claim_id}: open its trace`}
        >
          {body}
        </a>
      ) : (
        <div>{body}</div>
      )}
    </li>
  );
}

/** The agent team and the live feed, side by side. */
export function AgentTeam({ api }: { api: Api }) {
  const { activity, failed } = useActivity(api);
  // Rows that arrived since the last poll, marked so they slide in.
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!activity) return;
    const ids = new Set(activity.events.map((e) => e.event_id));
    if (seen.current) {
      const before = seen.current;
      setFresh(new Set([...ids].filter((id) => !before.has(id))));
    }
    seen.current = ids;
  }, [activity]);

  const working = activity?.team.filter((p) => p.working).length ?? 0;
  return (
    <div className="team-row fill">
      <section className="panel team-panel" aria-labelledby="team-heading">
        <div className="panel-head">
          <h2 id="team-heading">The agent team</h2>
          <span className="muted small">
            {activity
              ? `${String(activity.team.length)} AI agents · ${String(working)} working now · last 14 days`
              : ""}
          </span>
          <a className="stage-link small" href={AGENTS_HREF}>
            Open the map
          </a>
        </div>
        {!activity && !failed && <span className="skeleton skeleton-card" aria-hidden="true" />}
        {failed && !activity && <p className="muted small">The team couldn&apos;t be loaded.</p>}
        {activity && (
          // A scrollable list must take focus so keyboard users can scroll it (WCAG 2.1.1).
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          <ul className="team-grid fill-scroll" aria-label="The AI agents" tabIndex={0}>
            {activity.team.map((persona) => (
              <PersonaCard key={persona.key} persona={persona} />
            ))}
          </ul>
        )}
      </section>
      <section className="panel feed-panel" aria-labelledby="feed-heading">
        <div className="panel-head">
          <h2 id="feed-heading">Happening now</h2>
          <span className="muted small">{failed ? "paused: can't reach the api" : ""}</span>
          <a className="stage-link small" href={LIVE_HREF}>
            Live
          </a>
        </div>
        {activity && activity.events.length === 0 && (
          <p className="muted small">Nothing yet: the agents haven&apos;t worked a claim.</p>
        )}
        {activity && activity.events.length > 0 && (
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          <ul className="feed fill-scroll" aria-label="What the agents did" tabIndex={0}>
            {runs(activity.events).map(({ event, count }) => (
              <EventRow
                key={event.event_id}
                event={event}
                count={count}
                fresh={fresh.has(event.event_id)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
