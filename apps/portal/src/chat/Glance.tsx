import { ChevronRight, FileText, Shield, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { stepsFor } from "../components/ClaimTracker";
import { date } from "../format";
import { latestPolicy, noun, place } from "./arrival";
import { planName } from "./cover";
import type { Records } from "./records";
import type { PanelTarget } from "./SidePanel";

const DONE = new Set(["paid", "declined"]);
const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
const STAGE: Record<string, string> = {
  received: "Received",
  assessing: "Being assessed",
  reviewing: "Final check",
  with_a_handler: "With a person",
  approved: "Approved, paying soon",
};

/** Where a trip stands today. */
export function tripState(trip: { departs_on: string; returns_on: string }, today: string) {
  if (today < trip.departs_on) return "Starts soon";
  if (today > trip.returns_on) return "Trip over";
  return "Active now";
}

/** Key facts on the start screen for a customer who only wants to look: their claims, their
 * cover and how they get paid, all from their own records, each opening where it lives. Cards
 * with nothing to show are left out. */
export function Glance({
  records,
  onOpen,
  today = new Date().toISOString().slice(0, 10),
}: {
  records: Records;
  onOpen: (target: PanelTarget) => void;
  today?: string;
}) {
  const open = records.claims
    .filter((c) => !DONE.has(c.status))
    .sort((a, b) => b.submitted_on.localeCompare(a.submitted_on));
  const latest = open[0];
  const policy = latestPolicy(records.policies);
  const cover = policy && records.cover.find((c) => c.policy_id === policy.policy_id);
  const paid = records.claims.filter((c) => c.status === "paid").length;
  const cards: ReactNode[] = [];

  if (records.claims.length > 0) {
    cards.push(
      <Card
        key="claims"
        icon={<FileText size={16} strokeWidth={1.75} />}
        label="Claims"
        onClick={() => {
          onOpen({ view: "claims" });
        }}
      >
        <b>{open.length > 0 ? `${String(open.length)} in progress` : "All finished"}</b>
        {latest ? (
          <>
            <span className="glance-sub">
              {noun(latest) ? `${capital(noun(latest))} claim` : "Latest claim"} ·{" "}
              {STAGE[latest.status]}
            </span>
            <span className="glance-steps" aria-hidden="true">
              {stepsFor(latest.status).map((step) => (
                <span key={step.label} className={step.state} />
              ))}
            </span>
          </>
        ) : (
          <span className="glance-sub">{String(records.claims.length)} in all</span>
        )}
      </Card>,
    );
  }
  if (policy) {
    cards.push(
      <Card
        key="cover"
        icon={<Shield size={16} strokeWidth={1.75} />}
        label="Cover"
        onClick={() => {
          onOpen({ view: "settings", policyId: policy.policy_id });
        }}
      >
        <b>
          {place(policy.trip.destination)}
          {cover ? ` · ${planName(cover)}` : ""}
        </b>
        <span className="glance-sub">
          {date(policy.trip.departs_on)} to {date(policy.trip.returns_on)}
        </span>
        <span className="glance-tag">{tripState(policy.trip, today)}</span>
      </Card>,
    );
  }
  cards.push(
    <Card
      key="paid"
      icon={<Wallet size={16} strokeWidth={1.75} />}
      label="Getting paid"
      onClick={() => {
        onOpen({ view: "settings" });
      }}
    >
      <b>{records.payid ? "To your PayID" : "No PayID yet"}</b>
      <span className="glance-sub">
        {records.payid ?? "Add one and approved claims are paid in seconds"}
      </span>
      {paid > 0 && (
        <span className="glance-tag">
          {paid === 1 ? "1 claim paid" : `${String(paid)} claims paid`}
        </span>
      )}
    </Card>,
  );

  return (
    <section className="glance" aria-label="At a glance">
      <h2 className="glance-head">At a glance</h2>
      <ul>{cards}</ul>
    </section>
  );
}

function Card({
  icon,
  label,
  onClick,
  children,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <li>
      <button type="button" className="glance-card" onClick={onClick}>
        <span className="glance-label">
          <span aria-hidden="true">{icon}</span>
          {label}
          <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" className="glance-go" />
        </span>
        {children}
      </button>
    </li>
  );
}
