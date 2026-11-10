import { CircleCheck, Clock, Hourglass, Wallet, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Api, ClaimSummary, Handler } from "../api";
import { DispatchCard } from "../components/DispatchCard";
import { StatusChip, type Tone } from "../components/StatusChip";
import { useFocusHeading } from "../useFocusHeading";
import { date, dollars } from "../format";
import { claimHref } from "../useHashRoute";

interface Figure {
  label: string;
  value: string;
  Icon: LucideIcon;
  tone: Tone;
}

// The four figures above the queue, worked out from the claims themselves.
export function figuresOf(claims: ClaimSummary[]): Figure[] {
  const count = (status: ClaimSummary["status"]) =>
    claims.filter((claim) => claim.status === status).length;
  const paid = claims
    .filter((claim) => claim.status === "decided" && claim.decision === "approve")
    .reduce((sum, claim) => sum + (claim.payout ?? 0), 0);
  return [
    {
      label: "Waiting",
      value: String(count("waiting") + count("sent_back")),
      Icon: Clock,
      tone: "info",
    },
    {
      label: "Waiting for sign-off",
      value: String(count("waiting_for_sign_off")),
      Icon: Hourglass,
      tone: "warn",
    },
    { label: "Decided", value: String(count("decided")), Icon: CircleCheck, tone: "refer" },
    { label: "Paid so far", value: dollars(paid), Icon: Wallet, tone: "good" },
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

/** How close a still-open claim is to its due date: overdue, due within two days, or fine. */
export function urgency(claim: ClaimSummary, today = new Date()): "overdue" | "soon" | null {
  const open = needsMe(claim) || claim.status !== "decided";
  if (!open) return null;
  const due = new Date(`${claim.due_on}T23:59:59`);
  const days = (due.getTime() - today.getTime()) / 86_400_000;
  if (days < 0) return "overdue";
  return days <= 2 ? "soon" : null;
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

function Skeleton() {
  return (
    <div aria-hidden="true">
      <div className="figures">
        {[0, 1, 2, 3].map((key) => (
          <span key={key} className="skeleton skeleton-figure" />
        ))}
      </div>
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
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select") || event.ctrlKey || event.metaKey) return;
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
    <section aria-labelledby="queue-heading">
      <p className="eyebrow">Handlers' dashboard</p>
      <h1 id="queue-heading" ref={heading} tabIndex={-1}>
        Claims queue
      </h1>
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
  const shown = claims.filter((claim) => inView(view, claim));
  if (view === "needs_me") shown.sort(byUrgency);
  return (
    <>
      <ul className="figures" aria-label="The queue at a glance">
        {figuresOf(claims).map((figure) => (
          <li key={figure.label} className={`figure figure-${figure.tone}`}>
            <p className="eyebrow figure-label">
              <figure.Icon size={16} strokeWidth={2} aria-hidden="true" />
              {figure.label}
            </p>
            <p className="figure-value">{figure.value}</p>
          </li>
        ))}
      </ul>
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
        <span className="muted small shortcuts-hint">J and K to move, Enter to open</span>
      </div>
      {shown.length === 0 ? (
        <div className="panel empty">
          <h2>Nothing here</h2>
          <p className="muted">
            {view === "needs_me"
              ? "Nothing needs you right now. Held payouts and referrals show here."
              : "No claims in this view."}
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="queue" ref={table}>
            <caption className="visually-hidden">
              {shown.length} claims, oldest submitted first
            </caption>
            <thead>
              <tr>
                <th scope="col">Claim</th>
                <th scope="col">Customer</th>
                <th scope="col">Plan</th>
                <th scope="col">What happened</th>
                <th scope="col" className="number">
                  Claimed
                </th>
                <th scope="col">Due</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((claim) => (
                <tr key={claim.claim_id} className={needsMe(claim) ? "needs-me" : undefined}>
                  <th scope="row" className="nowrap">
                    <a href={claimHref(claim.claim_id)}>{claim.claim_id}</a>
                  </th>
                  <td className="nowrap">{claim.customer_name}</td>
                  <td className="capitalise">{claim.plan}</td>
                  <td dir="auto">{claim.summary}</td>
                  <td className="number nowrap">{dollars(claim.amount_claimed)}</td>
                  <td className="nowrap">
                    {date(claim.due_on)}
                    {urgency(claim) === "overdue" && <span className="chip chip-bad">Overdue</span>}
                    {urgency(claim) === "soon" && <span className="chip chip-warn">Due soon</span>}
                  </td>
                  <td className="nowrap">
                    <StatusChip status={claim.status} decision={claim.decision} />
                    {claim.stalled && <span className="chip chip-bad">Stalled</span>}
                    {claim.review_requested && <span className="chip chip-warn">Review asked</span>}
                    {claim.documents_in && <span className="chip chip-good">Documents in</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
