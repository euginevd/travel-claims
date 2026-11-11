import { ShieldAlert, UserRoundPen } from "lucide-react";
import type { ReactNode } from "react";
import type { Decision, Payment, Step } from "../api";
import { dollars, REASON_LABELS, when } from "../format";
import { AiMark } from "./AiMark";
import { Checklist } from "./Checklist";
import { OutcomeChip } from "./StatusChip";

interface DecisionCardProps {
  decision: Decision;
  payment: Payment | null;
  claimed: number;
  steps: Step[];
  heading?: string;
  /** What a handler can do about it (sign off, send back, override), under the breakdown. */
  actions?: ReactNode;
}

interface Segment {
  label: string;
  amount: number;
  paid: boolean;
}

const OUTSIDE = "Not covered or over a limit";

// Claimed to paid as labelled segments: what's paid, then each amount the calculation took off,
// then anything claimed that never entered it (not covered, or over an item's limit).
export function segmentsOf(decision: Decision, claimed: number): Segment[] {
  const lines = decision.calculation?.lines ?? [];
  const counted = lines.filter((line) => line.amount > 0).reduce((sum, l) => sum + l.amount, 0);
  const segments: Segment[] = [{ label: "Paid", amount: decision.payout, paid: true }];
  for (const line of lines) {
    if (line.amount < 0) segments.push({ label: line.step, amount: -line.amount, paid: false });
  }
  const outside = Math.round((claimed - (lines.length ? counted : decision.payout)) * 100) / 100;
  if (outside > 0) {
    segments.push({ label: OUTSIDE, amount: outside, paid: false });
  }
  return segments.filter((segment) => segment.amount > 0);
}

interface Row {
  label: string;
  amount: number;
  kind: "claimed" | "off" | "pay";
  /** Where the bar starts and how wide it is, as percentages of what was claimed. */
  from: number;
  width: number;
}

/** The segments as a waterfall: all that was claimed, each amount that came off it (what never
 * entered the calculation first), and what's left to pay. */
export function waterfallOf(decision: Decision, claimed: number): Row[] {
  const segments = segmentsOf(decision, claimed);
  const total = segments.reduce((sum, segment) => sum + segment.amount, 0);
  if (total <= 0) return [];
  const share = (amount: number) => (amount / total) * 100;
  const off = segments.filter((segment) => !segment.paid);
  const ordered = [
    ...off.filter((segment) => segment.label === OUTSIDE),
    ...off.filter((segment) => segment.label !== OUTSIDE),
  ];
  const rows: Row[] = [{ label: "Claimed", amount: total, kind: "claimed", from: 0, width: 100 }];
  let edge = 100;
  for (const segment of ordered) {
    const width = share(segment.amount);
    edge -= width;
    rows.push({ label: segment.label, amount: segment.amount, kind: "off", from: edge, width });
  }
  const paid = segments.find((segment) => segment.paid);
  if (paid) {
    rows.push({
      label: "Pay",
      amount: paid.amount,
      kind: "pay",
      from: 0,
      width: share(paid.amount),
    });
  }
  return rows;
}

function PayoutBar({
  decision,
  claimed,
  paid,
}: {
  decision: Decision;
  claimed: number;
  paid: boolean;
}) {
  const rows = waterfallOf(decision, claimed);
  if (rows.length === 0) return null;
  return (
    <figure className="payout-figure">
      <figcaption className="visually-hidden">
        Claimed {dollars(claimed)}, paid {dollars(decision.payout)}
      </figcaption>
      <ul className="waterfall">
        {rows.map((row, index) => (
          <li key={index} className={`wf-row wf-${row.kind}`}>
            <span className="wf-label">{row.kind === "pay" && paid ? "Paid" : row.label}</span>
            <span className="number">{dollars(row.kind === "off" ? -row.amount : row.amount)}</span>
            {/* SVG positions are attributes, not inline styles, so the strict CSP allows them. */}
            <svg className="wf-bar" aria-hidden="true" preserveAspectRatio="none">
              <rect
                className="wf-fill"
                x={`${String(row.from)}%`}
                width={`${String(row.width)}%`}
                height="100%"
                rx="4"
              />
            </svg>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** The recommendation: the outcome and amount, the reason, the payout broken down, what a
 * handler can do about it, then what was checked with its sources. The working-out is folded
 * away. */
export function DecisionCard({
  decision,
  payment,
  claimed,
  steps,
  heading = "Recommendation",
  actions,
}: DecisionCardProps) {
  const approved = decision.decision === "approve";
  const byPerson = decision.override !== null;
  return (
    <section className="panel decision" aria-label={heading}>
      <div className="decision-head">
        <h2>{heading}</h2>
        {byPerson ? (
          <span className="ai-mark person">
            <UserRoundPen size={14} strokeWidth={1.75} aria-hidden="true" />
            Overridden by {decision.override?.by}
          </span>
        ) : decision.by_screening ? (
          <span className="ai-mark">
            <ShieldAlert size={14} strokeWidth={1.75} aria-hidden="true" />
            Hidden-instruction check
          </span>
        ) : (
          <AiMark label="UnderCover Agent" />
        )}
      </div>
      <div className="decision-line">
        <OutcomeChip decision={decision.decision} />
        {approved && <span className="payout">{dollars(decision.payout)}</span>}
      </div>
      <p className="decision-reason" dir="auto">
        {decision.reason}
      </p>
      {decision.override && (
        <p className="notice small">
          {REASON_LABELS[decision.override.reason_code]}: {decision.override.note}. The agent had{" "}
          {decision.override.previous_decision === "approve"
            ? `approved ${dollars(decision.override.previous_payout)}`
            : decision.override.previous_decision === "decline"
              ? "declined"
              : "referred"}{" "}
          it.
        </p>
      )}
      {approved && <PayoutBar decision={decision} claimed={claimed} paid={payment !== null} />}
      {actions}
      <Checklist checks={decision.checklist} steps={steps} />
      {decision.calculation && decision.calculation.lines.length > 0 && (
        <details className="working">
          <summary>How the payout was worked out</summary>
          <table className="calculation">
            <tbody>
              {decision.calculation.lines.map((line, index) => (
                <tr key={index}>
                  <th scope="row">{line.step}</th>
                  <td className="number">{dollars(line.amount)}</td>
                </tr>
              ))}
              <tr className="total">
                <th scope="row">Payout</th>
                <td className="number">{dollars(decision.payout)}</td>
              </tr>
            </tbody>
          </table>
        </details>
      )}
      <dl className="facts">
        <dt>Relied on</dt>
        <dd>{decision.section}</dd>
        <dt>Decided</dt>
        <dd>
          {decision.decided_by}, {when(decision.decided_at)}
        </dd>
        {payment && (
          <>
            <dt>Paid</dt>
            <dd>
              {dollars(payment.amount)}, {when(payment.paid_at)}
              {payment.signed_off_by && <> · signed off by {payment.signed_off_by}</>}
            </dd>
          </>
        )}
      </dl>
      {!byPerson && (
        <p className="muted small ai-foot">
          Made by an AI. A senior handler can send it back or override it, and the customer can ask
          for a person to review it.
        </p>
      )}
    </section>
  );
}
