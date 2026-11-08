import type { Decision, Payment } from "../api";
import { DECISION_LABELS, dollars, when } from "../format";

interface DecisionCardProps {
  decision: Decision;
  payment: Payment | null;
  heading?: string;
}

export function DecisionCard({ decision, payment, heading = "Decision" }: DecisionCardProps) {
  return (
    <section className={`panel decision decision-${decision.decision}`} aria-label={heading}>
      <h2>{heading}</h2>
      {decision.by_screening && (
        <p className="notice" role="note">
          The hidden-instruction check referred this claim. The claim agent never saw it.
        </p>
      )}
      <p className="decision-line">
        <strong>{DECISION_LABELS[decision.decision]}</strong>
        {decision.decision === "approve" && <> · {dollars(decision.payout)}</>}
      </p>
      <p>{decision.reason}</p>
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
    </section>
  );
}
