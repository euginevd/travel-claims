import { AlarmClock, Clock, FileCheck, MessageCircleQuestion, OctagonAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Api, ClaimSummary, Handler } from "../api";
import { DispatchCard } from "../components/DispatchCard";
import { StatusChip } from "../components/StatusChip";
import { useFocusHeading } from "../useFocusHeading";
import { date, dollars, words } from "../format";
import { claimHref } from "../useHashRoute";

interface Figure {
  label: string;
  value: string;
  /** Shown in coral: something here is waiting on a person. */
  urgent: boolean;
}

// The four figures beside the title, worked out from the claims themselves.
export function figuresOf(claims: ClaimSummary[]): Figure[] {
  const count = (status: ClaimSummary["status"]) =>
    claims.filter((claim) => claim.status === status).length;
  const paid = claims
    .filter((claim) => claim.status === "decided" && claim.decision === "approve")
    .reduce((sum, claim) => sum + (claim.payout ?? 0), 0);
  const held = count("waiting_for_sign_off");
  return [
    { label: "Waiting", value: String(count("waiting") + count("sent_back")), urgent: false },
    { label: "Waiting for sign-off", value: String(held), urgent: held > 0 },
    { label: "Decided", value: String(count("decided")), urgent: false },
    { label: "Paid so far", value: dollars(paid), urgent: false },
  ];
}

export const VIEWS = ["needs_me", "in_progress", "waiting", "done", "all"] as const;
export type View = (typeof VIEWS)[number];
const VIEW_LABELS: Record<View, string> = {
  needs_me: "Needs me",
  in_progress: "In progress",
  waiting: "Waiting",
  done: "Done",
  all: "All",
};

export const SORTS = ["queue", "due", "amount"] as const;
export type Sort = (typeof SORTS)[number];
const SORT_LABELS: Record<Sort, string> = {
  queue: "Sort: queue order",
  due: "Sort: due soonest",
  amount: "Sort: largest claimed",
};
const SORT_WORDS: Record<Sort, string> = {
  queue: "oldest submitted first",
  due: "due soonest first",
  amount: "largest claimed first",
};

/** Whether a claim needs a handler: a held payout, a referral, a customer asking for review, or
 * a claim the agent stopped working. */
export function needsMe(claim: ClaimSummary): boolean {
  return (
    claim.stalled === true ||
    claim.status === "waiting_for_sign_off" ||
    claim.status === "left_for_handler" ||
    claim.review_requested ||
    claim.documents_in ||
    (claim.status === "decided" && claim.decision === "refer")
  );
}

/** Days until the end of a claim's due day; negative once it has passed. */
function daysLeft(claim: ClaimSummary, today: Date): number {
  const due = new Date(`${claim.due_on}T23:59:59`);
  return (due.getTime() - today.getTime()) / 86_400_000;
}

/** How close a still-open claim is to its due date: overdue, due within two days, or fine. */
export function urgency(claim: ClaimSummary, today = new Date()): "overdue" | "soon" | null {
  const open = needsMe(claim) || claim.status !== "decided";
  if (!open) return null;
  const days = daysLeft(claim, today);
  if (days < 0) return "overdue";
  return days <= 2 ? "soon" : null;
}

/** How many days past due an overdue claim is, counting part of a day as one. */
export function daysOverdue(claim: ClaimSummary, today = new Date()): number {
  return Math.max(0, Math.ceil(-daysLeft(claim, today)));
}

/** Needs me puts documents that came in first, then the most overdue. */
function byUrgency(a: ClaimSummary, b: ClaimSummary): number {
  if (a.documents_in !== b.documents_in) return a.documents_in ? -1 : 1;
  return a.due_on.localeCompare(b.due_on);
}

export function inView(view: View, claim: ClaimSummary): boolean {
  switch (view) {
    case "needs_me":
      return needsMe(claim);
    case "in_progress":
      return claim.status === "in_progress";
    case "waiting":
      return claim.status === "waiting" || claim.status === "sent_back";
    case "done":
      return claim.status === "decided" && !needsMe(claim);
    case "all":
      return true;
  }
}

/** The claims a view shows, narrowed by type and plan ("" for any) and put in order. */
export function arrange(
  claims: ClaimSummary[],
  view: View,
  type: string,
  plan: string,
  sort: Sort,
): ClaimSummary[] {
  const shown = claims.filter(
    (claim) =>
      inView(view, claim) &&
      (type === "" || claim.claim_type === type) &&
      (plan === "" || claim.plan === plan),
  );
  if (sort === "due") shown.sort((a, b) => a.due_on.localeCompare(b.due_on));
  else if (sort === "amount") shown.sort((a, b) => b.amount_claimed - a.amount_claimed);
  else if (view === "needs_me") shown.sort(byUrgency);
  return shown;
}

/** The decision on a claim in a few words: the agent's recommendation while it waits for
 * sign-off, the outcome once decided. */
export function decisionWords(claim: ClaimSummary): string | null {
  const settled = claim.status === "decided";
  switch (claim.decision) {
    case "approve":
      return `${settled ? "Approved" : "Approve"} ${dollars(claim.payout ?? 0)}`;
    case "decline":
      return settled ? "Declined" : "Decline";
    case "refer":
      return settled ? "Referred" : "Refer";
    case null:
      return null;
  }
}

function Skeleton() {
  return (
    <div aria-hidden="true" className="queue-skeleton">
      {[0, 1, 2, 3, 4, 5].map((key) => (
        <span key={key} className="skeleton skeleton-row" />
      ))}
    </div>
  );
}

export function QueuePage({ api, handler }: { api: Api; handler: Handler }) {
  const [claims, setClaims] = useState<ClaimSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [view, setView] = useState<View | null>(null);
  const table = useRef<HTMLTableElement>(null);
  const heading = useFocusHeading();

  // J and K move through the claims, Enter opens one: the links take the focus.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // The target is the window when the header's search button sends its own key press.
      const typing =
        event.target instanceof Element && event.target.closest("input, textarea, select");
      if (typing || event.ctrlKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key !== "j" && key !== "k") return;
      const links = [...(table.current?.querySelectorAll<HTMLAnchorElement>("tbody a") ?? [])];
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
  const retry = useCallback(() => {
    setError(null);
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    let live = true;
    api.listClaims().then(
      (found) => {
        if (live) setClaims(found);
      },
      (caught: unknown) => {
        if (live) setError(caught instanceof Error ? caught.message : String(caught));
      },
    );
    return () => {
      live = false;
    };
  }, [api, generation]);

  return (
    <section aria-labelledby="queue-heading" className="page-in">
      <div className="page-head">
        <div>
          <p className="eyebrow">Handlers&apos; dashboard</p>
          <h1 id="queue-heading" ref={heading} tabIndex={-1}>
            Claims queue
          </h1>
        </div>
        {claims && claims.length > 0 && (
          <ul className="statbar" aria-label="The queue at a glance">
            {figuresOf(claims).map((figure) => (
              <li key={figure.label}>
                <p className="stat-label">{figure.label}</p>
                <p className={`stat-value${figure.urgent ? " urgent" : ""}`}>{figure.value}</p>
              </li>
            ))}
          </ul>
        )}
        {!claims && !error && <span className="skeleton skeleton-stats" aria-hidden="true" />}
      </div>
      <DispatchCard api={api} handler={handler} onProgress={retry} />
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
            Loading the queue…
          </p>
          <Skeleton />
        </>
      )}
      {claims?.length === 0 && (
        <div className="panel empty">
          <h2>The queue is empty</h2>
          <p className="muted">New claims appear here as customers submit them.</p>
        </div>
      )}
      {claims && claims.length > 0 && (
        <QueueBody
          claims={claims}
          view={view ?? (claims.some(needsMe) ? "needs_me" : "all")}
          onView={setView}
          table={table}
        />
      )}
    </section>
  );
}

interface QueueBodyProps {
  claims: ClaimSummary[];
  view: View;
  onView: (view: View) => void;
  table: React.RefObject<HTMLTableElement | null>;
}

function QueueBody({ claims, view, onView, table }: QueueBodyProps) {
  const [type, setType] = useState("");
  const [plan, setPlan] = useState("");
  const [sort, setSort] = useState<Sort>("queue");
  const types = [...new Set(claims.map((claim) => claim.claim_type))].sort();
  const plans = [...new Set(claims.map((claim) => claim.plan))].sort();
  const shown = arrange(claims, view, type, plan, sort);
  const filtered = type !== "" || plan !== "";
  const summary = `${String(shown.length)} ${shown.length === 1 ? "claim" : "claims"}, ${SORT_WORDS[sort]}`;
  return (
    <>
      <div className="queue-bar">
        <div className="tabs" role="group" aria-label="Show">
          {VIEWS.map((name) => {
            const count = claims.filter((claim) => inView(name, claim)).length;
            return (
              <button
                key={name}
                type="button"
                className={`tab${name === view ? " current" : ""}${name === "needs_me" && count > 0 ? " tab-needs" : ""}`}
                aria-pressed={name === view}
                onClick={() => {
                  onView(name);
                }}
              >
                {VIEW_LABELS[name]} <span className="tab-count">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="filters" role="group" aria-label="Filter and sort">
          <select
            className="filter"
            aria-label="Claim type"
            value={type}
            onChange={(event) => {
              setType(event.target.value);
            }}
          >
            <option value="">All types</option>
            {types.map((name) => (
              <option key={name} value={name}>
                {words(name)}
              </option>
            ))}
          </select>
          <select
            className="filter"
            aria-label="Plan"
            value={plan}
            onChange={(event) => {
              setPlan(event.target.value);
            }}
          >
            <option value="">All plans</option>
            {plans.map((name) => (
              <option key={name} value={name}>
                {words(name)}
              </option>
            ))}
          </select>
          <select
            className="filter"
            aria-label="Sort"
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as Sort);
            }}
          >
            {SORTS.map((name) => (
              <option key={name} value={name}>
                {SORT_LABELS[name]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="panel empty">
          <h2>Nothing here</h2>
          <p className="muted">
            {filtered
              ? "No claims match these filters."
              : view === "needs_me"
                ? "Nothing needs you right now. Held payouts and referrals show here."
                : "No claims in this view."}
          </p>
          {filtered && (
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setType("");
                setPlan("");
              }}
            >
              Clear the filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className={`queue${view === "needs_me" ? "" : " queue-mixed"}`} ref={table}>
              <caption className="visually-hidden">{summary}</caption>
              <thead>
                <tr>
                  <th scope="col">Claim</th>
                  <th scope="col">Customer</th>
                  <th scope="col">What happened</th>
                  <th scope="col" className="number">
                    Claimed
                  </th>
                  <th scope="col">Decision</th>
                  <th scope="col">Due</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((claim) => (
                  <QueueRow key={claim.claim_id} claim={claim} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="queue-hint muted" aria-hidden="true">
            <span className="shortcuts-hint">
              <span>
                <kbd>J</kbd> <kbd>K</kbd> move
              </span>
              <span>
                <kbd>Enter</kbd> open
              </span>
              <span>
                <kbd>/</kbd> search
              </span>
            </span>
            <span>{summary}</span>
          </p>
        </>
      )}
    </>
  );
}

function QueueRow({ claim }: { claim: ClaimSummary }) {
  const due = urgency(claim);
  const late = daysOverdue(claim);
  const decision = decisionWords(claim);
  return (
    <tr className={needsMe(claim) ? "needs-me" : undefined}>
      <th scope="row" className="nowrap">
        <a className="claim-id" href={claimHref(claim.claim_id)}>
          {claim.claim_id}
        </a>
      </th>
      <td className="cust">
        <span className="nowrap">{claim.customer_name}</span>
        <span className="cust-plan capitalise">{claim.plan}</span>
      </td>
      <td>
        <span className="what" dir="auto" title={claim.summary}>
          {claim.summary}
        </span>
      </td>
      <td className="number">{dollars(claim.amount_claimed)}</td>
      {/* TODO: a short reason and a risk signal per row need fields the claims list doesn't have. */}
      <td className="nowrap decision-cell">{decision ?? <span className="muted">Not yet</span>}</td>
      <td className="nowrap">
        <span className="chip-row">
          {date(claim.due_on)}
          {due === "overdue" && (
            <span className="chip chip-bad">
              <AlarmClock size={13} strokeWidth={1.75} aria-hidden="true" />
              {late} {late === 1 ? "day" : "days"} overdue
            </span>
          )}
          {due === "soon" && (
            <span className="chip chip-warn">
              <Clock size={13} strokeWidth={1.75} aria-hidden="true" />
              Due soon
            </span>
          )}
        </span>
      </td>
      <td>
        <span className="chip-row">
          <StatusChip status={claim.status} decision={claim.decision} />
          {claim.stalled && (
            <span className="chip chip-bad">
              <OctagonAlert size={13} strokeWidth={1.75} aria-hidden="true" />
              Stalled
            </span>
          )}
          {claim.review_requested && (
            <span className="chip chip-warn">
              <MessageCircleQuestion size={13} strokeWidth={1.75} aria-hidden="true" />
              Review asked
            </span>
          )}
          {claim.documents_in && (
            <span className="chip chip-good">
              <FileCheck size={13} strokeWidth={1.75} aria-hidden="true" />
              Documents in
            </span>
          )}
        </span>
      </td>
    </tr>
  );
}
