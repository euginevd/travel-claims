import { ShieldAlert, UserRoundPen } from "lucide-react";
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
}

interface Segment {
  label: string;
  amount: number;
  paid: boolean;
}

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
    segments.push({ label: "Not covered or over a limit", amount: outside, paid: false });
  }
  return segments.filter((segment) => segment.amount > 0);
}

function PayoutBar({ decision, claimed }: { decision: Decision; claimed: number }) {
  const segments = segmentsOf(decision, claimed);
  const total = segments.reduce((sum, segment) => sum + segment.amount, 0);
  if (total <= 0) return null;
  return (
    <figure className="payout-figure">
      <figcaption className="eyebrow">
        Claimed {dollars(claimed)}, paid {dollars(decision.payout)}
      </figcaption>
      {/* SVG widths are attributes, not inline styles, so the strict CSP allows them. */}
      <svg className="payout-bar" aria-hidden="true" preserveAspectRatio="none">
        {segments.map((segment, index) => {
          const before = segments.slice(0, index).reduce((sum, s) => sum + s.amount, 0);
          return (
            <rect
              key={index}
              className={segment.paid ? "bar-paid" : "bar-kept"}
              x={`${String((before / total) * 100)}%`}
              width={`${String((segment.amount / total) * 100)}%`}
              height="100%"
            />
          );
        })}
      </svg>
      <ul className="bar-legend">
        {segments.map((segment, index) => (
          <li key={index}>
            <span>
              <span
                className={`swatch ${segment.paid ? "bar-paid" : "bar-kept"}`}
                aria-hidden="true"
              />
              {segment.label}
            </span>
            <span className="number">{dollars(segment.amount)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** The recommendation: the outcome and amount, the reason, what was checked with its sources,
 * and the payout bar. The working-out is folded away. */
export function DecisionCard({
  decision,
  payment,
  claimed,
  steps,
  heading = "Recommendation",
}: DecisionCardProps) {
  const approved = decision.decision === "approve";
  const byPerson = decision.override !== null;
  return (
    <section className="panel decision" aria-label={heading}>
      <div className="decision-head">
        <h2>{heading}</h2>
        {byPerson ? (
          <span className="ai-mark person">
            <UserRoundPen size={14} strokeWidth={2} aria-hidden="true" />
            Overridden by {decision.override?.by}
          </span>
        ) : decision.by_screening ? (
          <span className="ai-mark">
            <ShieldAlert size={14} strokeWidth={2} aria-hidden="true" />
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
      <p dir="auto">{decision.reason}</p>
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
      <Checklist checks={decision.checklist} steps={steps} />
      {approved && <PayoutBar decision={decision} claimed={claimed} />}
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
        <p className="muted small">
          Made by an AI. A senior handler can send it back or override it, and the customer can ask
          for a person to review it.
        </p>
      )}
    </section>
  );
}
