import { AlarmClock, Clock, FileCheck, MessageCircleQuestion, OctagonAlert } from "lucide-react";
import { useState } from "react";
import type { ClaimSummary } from "../api";
import { StatusChip } from "../components/StatusChip";
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
  // The red team's attack claims are tests: they never need a handler.
  if (claim.red_team === true) return false;
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

/** Every claim, in tabs by where it is, with filters and a sort: Today's "Everything else". */
export function QueueBody({
  claims,
  startView = "all",
}: {
  claims: ClaimSummary[];
  startView?: View;
}) {
  const [view, onView] = useState<View>(startView);
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
            <table className={`queue${view === "needs_me" ? "" : " queue-mixed"}`}>
              <caption className="visually-hidden">{summary}</caption>
              <thead>
                <tr>
                  <th scope="col">Claim</th>
                  <th scope="col">Customer</th>
                  <th scope="col">What happened</th>
                  <th scope="col" className="number">
                    Claimed
                  </th>
                  <th scope="col" className="number">
                    Payout
                  </th>
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
  return (
    <tr className={needsMe(claim) ? "needs-me" : undefined}>
      <th scope="row" className="nowrap">
        <a className="claim-id" href={claimHref(claim.claim_id)}>
          {claim.claim_id}
        </a>
      </th>
      <td className="cust">
        <span className="nowrap">{claim.customer_name}</span>
        {claim.red_team ? (
          <span className="cust-plan">
            <span className="chip">Red-team test</span>
          </span>
        ) : (
          <span className="cust-plan capitalise">{claim.plan}</span>
        )}
      </td>
      <td>
        <span className="what" dir="auto" title={claim.summary}>
          {claim.summary}
        </span>
      </td>
      <td className="number">{dollars(claim.amount_claimed)}</td>
      {/* The status says what was decided; this says what it pays. */}
      <td className="number nowrap">
        {claim.decision === "approve" && claim.payout !== null ? (
          dollars(claim.payout)
        ) : (
          <span className="muted">–</span>
        )}
      </td>
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
