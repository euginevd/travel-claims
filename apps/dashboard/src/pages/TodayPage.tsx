import { ArrowRight, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentSwitch, Api, ClaimSummary, Handler, Insights } from "../api";
import { WattleMark } from "../components/Wattle";
import { date, dollars, words } from "../format";
import { useFocusHeading } from "../useFocusHeading";
import { claimHref } from "../useHashRoute";
import { arrange, daysOverdue, decisionWords, needsMe, QueueBody, urgency } from "./QueuePage";

/** "Good morning" and so on, by the handler's own clock. */
export function greeting(now = new Date()): string {
  const hour = now.getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

const firstName = (name: string) => name.split(/\s+/)[0] ?? name;

/** The first sentence of a reason, short enough for one line. */
export function shortReason(reason: string | null | undefined): string {
  if (!reason) return "";
  const first = reason.split(/(?<=[.!?])\s/)[0] ?? reason;
  return first.replace(/[.!?]$/, "");
}

/** Why a claim needs a handler, in a few words, and what the agent made of it. */
export function whyOf(claim: ClaimSummary): { why: string; agent: string } {
  const decided = decisionWords(claim);
  const reason = shortReason(claim.reason);
  if (claim.stalled) return { why: "The agent stopped working it", agent: "Retry carries it on" };
  if (claim.status === "waiting_for_sign_off") {
    return {
      why: "Over the approval limit",
      agent: `Agent approves ${dollars(claim.payout ?? 0)}`,
    };
  }
  if (claim.documents_in)
    return { why: "What you asked for came in", agent: "Ready to look again" };
  if (claim.review_requested) {
    return {
      why:
        claim.decision === "approve"
          ? `Asked for a review of ${dollars(claim.payout ?? 0)} paid`
          : "Asked for a review of a decline",
      agent: `Agent ${decided?.toLowerCase() ?? "decided"}${reason ? `: ${reason}` : ""}`,
    };
  }
  return {
    why: claim.flag ?? (reason || "Referred to a person"),
    agent: "Agent referred it to you",
  };
}

interface Figure {
  label: string;
  value: number;
}

/** Four figures about today's work, each something someone acts on. */
export function todayFigures(claims: ClaimSummary[], senior: boolean): Figure[] {
  const mine = claims.filter((claim) => needsMe(claim) && claim.status !== "waiting_for_sign_off");
  const count = (status: ClaimSummary["status"]) =>
    claims.filter((claim) => claim.status === status && !claim.red_team).length;
  const soon = mine.filter((claim) => urgency(claim) === "soon").length;
  const overdue = mine.filter((claim) => urgency(claim) === "overdue").length;
  return [
    senior ? { label: "Overdue", value: overdue } : { label: "Need you", value: mine.length },
    senior
      ? { label: "Due in 2 days", value: soon }
      : { label: "Due soon or overdue", value: soon + overdue },
    { label: "Waiting for the agent", value: count("waiting") },
    { label: "Agent working", value: count("in_progress") },
  ];
}

interface Brief {
  text: string;
  start: ClaimSummary | null;
}

/** Wattle's brief: a sentence or two written in code from the queue, and where to start. */
export function briefOf(claims: ClaimSummary[], senior: boolean, agent: AgentSwitch | null): Brief {
  const held = claims.filter((claim) => claim.status === "waiting_for_sign_off");
  const mine = arrange(claims, "needs_me", "", "", "queue").filter(
    (claim) => claim.status !== "waiting_for_sign_off",
  );
  const parts: string[] = [];
  if (senior && held.length > 0) {
    const total = held.reduce((sum, claim) => sum + (claim.payout ?? 0), 0);
    parts.push(
      held.length === 1
        ? `One payout waits for your sign-off, ${dollars(total)}.`
        : `${String(held.length)} payouts wait for your sign-off, ${dollars(total)} together.`,
    );
  }
  const overdue = mine.filter((claim) => urgency(claim) === "overdue").length;
  const soon = mine.filter((claim) => urgency(claim) === "soon").length;
  const when = [
    overdue > 0 ? `${String(overdue)} ${overdue === 1 ? "is" : "are"} overdue` : "",
    soon > 0 ? `${String(soon)} ${soon === 1 ? "is" : "are"} due within two days` : "",
  ]
    .filter(Boolean)
    .join(" and ");
  if (mine.length > 0) {
    const first = mine[0];
    const n = mine.length;
    parts.push(
      `${n === 1 ? "One claim needs" : `${String(n)} claims need`} you${when ? `, and ${when}` : ""}.`,
    );
    if (first && parts.length === 1) {
      const kind = words(first.claim_type).toLowerCase();
      const check = first.flag?.split(":")[0];
      const why = whyOf(first).why.replace(/[.!?]+$/, "");
      parts.push(
        check && !first.review_requested && !first.documents_in
          ? `Start with ${first.customer_name}'s ${kind} claim: the agent stopped at “${check}”.`
          : `Start with ${first.customer_name}'s ${kind} claim: ${why.charAt(0).toLowerCase()}${why.slice(1)}.`,
      );
    }
  }
  const waiting = claims.filter((claim) => claim.status === "waiting" && !claim.red_team).length;
  if (parts.length === 0) {
    parts.push(
      agent && !agent.on && waiting > 0
        ? `Nothing needs you yet. ${String(waiting)} ${waiting === 1 ? "claim waits" : "claims wait"} for the agent${senior ? "." : "; a senior handler turns it on."}`
        : agent?.on
          ? "Nothing needs you right now. The agent is working the queue."
          : "Nothing needs you right now.",
    );
  }
  const start = senior && held[0] ? held[0] : (mine[0] ?? null);
  return { text: parts.join(" "), start };
}

/** The queue, following the agent while it works. */
function useClaims(api: Api, following: boolean) {
  const [claims, setClaims] = useState<ClaimSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const retry = useCallback(() => {
    setError(null);
    setGeneration((n) => n + 1);
  }, []);
  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    const load = () => {
      api.listClaims().then(
        (found) => {
          if (!live) return;
          setClaims(found);
          const busy = found.some((claim) => claim.status === "in_progress");
          if (following || busy) timer = window.setTimeout(load, 4000);
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
  }, [api, following, generation]);
  return { claims, error, retry };
}

interface TodayProps {
  api: Api;
  handler: Handler;
  agent: AgentSwitch | null;
  /** Opens the agent switch's card, for the brief's Turn the agent on. */
  onTurnOn?: () => void;
}

export function TodayPage({ api, handler, agent, onTurnOn }: TodayProps) {
  const senior = handler.can_approve_over_limit;
  const { claims, error, retry } = useClaims(api, agent?.on === true);
  const heading = useFocusHeading();
  const list = useRef<HTMLUListElement>(null);

  // J and K move through the claims that need you, Enter opens one: the links take the focus.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const typing =
        event.target instanceof Element && event.target.closest("input, textarea, select");
      if (typing || event.ctrlKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key !== "j" && key !== "k") return;
      const links = [
        ...document.querySelectorAll<HTMLAnchorElement>(".today-rows a, table.queue tbody a"),
      ];
      if (links.length === 0) return;
      const at = links.indexOf(document.activeElement as HTMLAnchorElement);
      const next = key === "j" ? Math.min(at + 1, links.length - 1) : Math.max(at - 1, 0);
      links[at === -1 ? 0 : next]?.focus();
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const today = new Date();
  return (
    <section aria-labelledby="today-heading" className="page-in today">
      <p className="eyebrow">
        {today.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}
      </p>
      <h1 id="today-heading" ref={heading} tabIndex={-1}>
        {greeting(today)}, {firstName(handler.name)}
      </h1>
      {error && (
        <p className="error" role="alert">
          {error}
          <button type="button" className="button secondary" onClick={retry}>
            Try again
          </button>
        </p>
      )}
      {!claims && !error && (
        <>
          <p role="status" className="visually-hidden">
            Loading today&apos;s claims…
          </p>
          <span className="skeleton skeleton-card" aria-hidden="true" />
        </>
      )}
      {claims && (
        <TodayBody
          api={api}
          claims={claims}
          senior={senior}
          agent={agent}
          list={list}
          onTurnOn={onTurnOn}
        />
      )}
    </section>
  );
}

function TodayBody({
  api,
  claims,
  senior,
  agent,
  list,
  onTurnOn,
}: {
  api: Api;
  claims: ClaimSummary[];
  senior: boolean;
  agent: AgentSwitch | null;
  list: React.RefObject<HTMLUListElement | null>;
  onTurnOn?: () => void;
}) {
  const [more, setMore] = useState(false);
  const brief = briefOf(claims, senior, agent);
  const mine = arrange(claims, "needs_me", "", "", "queue").filter(
    (claim) => claim.status !== "waiting_for_sign_off",
  );
  const rest = claims.filter((claim) => !needsMe(claim) && !claim.red_team);
  const held = claims.filter((claim) => claim.status === "waiting_for_sign_off").length;
  const waiting = rest.filter((claim) => claim.status === "waiting" && !claim.red_team).length;
  const decided = rest.filter((claim) => claim.status === "decided").length;
  return (
    <>
      <div className="brief">
        <WattleMark size={34} />
        <p>
          {brief.text}
          <small>Worked out from the queue, not written by a model</small>
        </p>
        {brief.start ? (
          <a className="button" href={claimHref(brief.start.claim_id)}>
            Start with {brief.start.claim_id}
            <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
          </a>
        ) : (
          senior &&
          onTurnOn &&
          agent &&
          !agent.on &&
          waiting > 0 && (
            <button type="button" className="button" onClick={onTurnOn}>
              Turn the agent on
              <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )
        )}
      </div>

      <ul className="today-figures" aria-label="Today at a glance">
        {todayFigures(claims, senior).map((figure, index) => (
          <li
            key={figure.label}
            className={figure.value === 0 ? "zero" : index < 2 ? "hot" : undefined}
          >
            <span className="stat-label">{figure.label}</span>
            <b>{figure.value}</b>
          </li>
        ))}
      </ul>

      {senior && (
        <SeniorCards
          api={api}
          claims={claims}
          decided={claims.filter((claim) => claim.status !== "waiting").length}
        />
      )}

      <div className="list-head">
        <h2>{senior && held > 0 ? "Also needs you" : "Need you"}</h2>
        {mine.length > 0 && <span className="count">{mine.length}</span>}
        <span className="muted small">most urgent first</span>
      </div>
      {mine.length === 0 ? (
        <p className="muted today-empty">
          Nothing needs you. Referrals and review requests show up here.
        </p>
      ) : (
        <ul className="today-rows" ref={list}>
          {mine.map((claim, index) => (
            <TodayRow key={claim.claim_id} claim={claim} first={index === 0} />
          ))}
        </ul>
      )}

      <button
        type="button"
        className="folded"
        aria-expanded={more}
        onClick={() => {
          setMore((open) => !open);
        }}
      >
        <b>Everything else</b>
        <span className="muted small">
          {waiting} waiting for the agent · {decided} decided
        </span>
        <ChevronDown className="chevron" size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {more && <QueueBody claims={claims} startView="all" />}
    </>
  );
}

function TodayRow({ claim, first }: { claim: ClaimSummary; first: boolean }) {
  const { why, agent } = whyOf(claim);
  const due = urgency(claim);
  const late = daysOverdue(claim);
  return (
    <li className={first ? "today-row first" : "today-row"}>
      <a
        href={claimHref(claim.claim_id)}
        aria-label={`${claim.claim_id}, ${claim.customer_name}: ${why}`}
      >
        <span className="claim-id">{claim.claim_id}</span>
        <span className="cust">
          {claim.customer_name}
          <small className="capitalise">{claim.plan}</small>
        </span>
        <span className="what">
          <span dir="auto">{claim.summary}</span>
          <small>{words(claim.claim_type)}</small>
        </span>
        <span className="why">
          <b>{why}</b>
          <span>
            <WattleMark size={15} />
            {agent}
          </span>
        </span>
        <span className="number">{dollars(claim.amount_claimed)}</span>
        <span className="due">
          {due === "overdue" ? (
            <span className="chip chip-bad">
              {late} {late === 1 ? "day" : "days"} overdue
            </span>
          ) : due === "soon" ? (
            <span className="chip chip-warn">Due {date(claim.due_on)}</span>
          ) : (
            date(claim.due_on)
          )}
        </span>
      </a>
    </li>
  );
}

/** A senior handler's cards: sign-offs, the spot check and what Wattle noticed. */
function SeniorCards({
  api,
  claims,
  decided,
}: {
  api: Api;
  claims: ClaimSummary[];
  /** Claims the agent has got to: the findings load again as it decides more. */
  decided: number;
}) {
  const held = claims.filter((claim) => claim.status === "waiting_for_sign_off");
  const [insights, setInsights] = useState<Insights | null>(null);
  const [checked, setChecked] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.getInsights().then(
      (found) => {
        if (live) setInsights(found);
      },
      () => {
        if (live) setInsights({ noticed: [], spot_checks: [], paid_alone: 0 });
      },
    );
    return () => {
      live = false;
    };
  }, [api, decided]);

  const showHeld = held.length > 0;
  const showSpot = (insights?.spot_checks.length ?? 0) > 0;
  const showNoticed = (insights?.noticed.length ?? 0) > 0;
  if (!showHeld && !showSpot && !showNoticed) return null;
  const both = (showHeld || showSpot) && showNoticed;
  return (
    <div className={`senior-grid${both ? "" : " single"}`}>
      {(showHeld || showSpot) && (
        <div className="senior-stack">
          {showHeld && (
            <section className="panel" aria-labelledby="signoff-heading">
              <div className="card-head">
                <h2 id="signoff-heading">Waiting for your sign-off</h2>
                <span className="muted small">over the approval limit</span>
              </div>
              {
                <ul className="sign-list">
                  {held.map((claim) => (
                    <li key={claim.claim_id}>
                      <b>{dollars(claim.payout ?? 0)}</b>
                      <span>
                        <span className="claim-id">{claim.claim_id}</span> · {claim.customer_name} ·{" "}
                        {words(claim.claim_type)}
                        <small className="muted">
                          Agent approves · {shortReason(claim.reason) || claim.summary}
                        </small>
                      </span>
                      <a className="button secondary" href={claimHref(claim.claim_id)}>
                        Open
                      </a>
                    </li>
                  ))}
                </ul>
              }
            </section>
          )}

          {showSpot && (
            <section className="panel" aria-labelledby="spot-heading">
              <div className="card-head">
                <h2 id="spot-heading">Spot check</h2>
                <span className="muted small">
                  {insights && insights.paid_alone > 0
                    ? `${String(Math.min(3, insights.paid_alone))} of ${String(insights.paid_alone)} the agent paid alone this week, picked at random`
                    : "claims the agent paid alone this week"}
                </span>
              </div>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <ul className="spot-list">
                {insights?.spot_checks.map((claim) => (
                  <li key={claim.claim_id}>
                    <a className="claim-id" href={claimHref(claim.claim_id)}>
                      {claim.claim_id}
                    </a>
                    <span>
                      {words(claim.claim_type)} · {claim.customer_name} · paid{" "}
                      {dollars(claim.payout)}
                      <small className="muted">{shortReason(claim.reason)}</small>
                    </span>
                    {checked[claim.claim_id] ? (
                      <span className="chip chip-good">{checked[claim.claim_id]}</span>
                    ) : (
                      <span className="spot-actions">
                        {(["right", "wrong"] as const).map((verdict) => (
                          <button
                            key={verdict}
                            type="button"
                            className="button secondary"
                            onClick={() => {
                              setError(null);
                              api.spotCheck(claim.claim_id, verdict).then(
                                () => {
                                  setChecked((all) => ({
                                    ...all,
                                    [claim.claim_id]:
                                      verdict === "right" ? "Looks right" : "Flagged",
                                  }));
                                },
                                (caught: unknown) => {
                                  setError(
                                    caught instanceof Error ? caught.message : String(caught),
                                  );
                                },
                              );
                            }}
                          >
                            {verdict === "right" ? "Looks right" : "Not right"}
                          </button>
                        ))}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {showNoticed && (
        <section className="panel noticed" aria-labelledby="noticed-heading">
          <div className="card-head">
            <WattleMark />
            <h2 id="noticed-heading">Wattle noticed</h2>
          </div>
          <ul>
            {insights?.noticed.map((insight) => (
              <li key={insight.headline}>
                <p>
                  <b>{insight.headline}</b> {insight.detail}
                </p>
                {insight.claim_ids.length > 0 && (
                  <p className="small">
                    {insight.claim_ids.slice(0, 5).map((id) => (
                      <a key={id} className="claim-id" href={claimHref(id)}>
                        {id}
                      </a>
                    ))}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="muted small">
            Counted from decisions and overrides, not written by a model.
          </p>
        </section>
      )}
    </div>
  );
}
