import { Bot, ShieldAlert } from "lucide-react";
import type { Decision, Payment } from "../api";
import { dollars, when } from "../format";
import { OutcomeChip } from "./StatusChip";

interface DecisionCardProps {
  decision: Decision;
  payment: Payment | null;
  claimed: number;
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
  const outside = Math.round((claimed - counted) * 100) / 100;
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

export function DecisionCard({
  decision,
  payment,
  claimed,
  heading = "Decision",
}: DecisionCardProps) {
  const approved = decision.decision === "approve";
  return (
    <section className="panel decision" aria-label={heading}>
      <h2>{heading}</h2>
      <p className="ai-label muted small">
        {decision.by_screening ? (
          <ShieldAlert size={16} strokeWidth={2} aria-hidden="true" />
        ) : (
          <Bot size={16} strokeWidth={2} aria-hidden="true" />
        )}
        Decided by {decision.by_screening ? "the hidden-instruction check" : "the UnderCover Agent"}
        , an AI
      </p>
      {decision.by_screening && (
        <p className="notice" role="note">
          The hidden-instruction check referred this claim. The claim agent never saw it.
        </p>
      )}
      <div className="decision-line">
        <OutcomeChip decision={decision.decision} />
        {approved && <span className="payout">{dollars(decision.payout)}</span>}
      </div>
      <p>{decision.reason}</p>
      {approved && <PayoutBar decision={decision} claimed={claimed} />}
      {decision.calculation && decision.calculation.lines.length > 0 && (
        <table className="calculation">
          <caption>How the payout was worked out</caption>
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
      )}
      <dl className="facts">
        <dt>Relied on</dt>
        <dd>{decision.section}</dd>
        <dt>Decided by</dt>
        <dd>
          {decision.decided_by}, {when(decision.decided_at)}
        </dd>
        <dt>Claims manual</dt>
        <dd>Version {decision.manual_version}</dd>
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
      <p className="muted small">
        This decision was made by an AI. A senior handler can send it back for the agent to look at
        again, and the customer can ask for a person to review it.
      </p>
    </section>
  );
}
