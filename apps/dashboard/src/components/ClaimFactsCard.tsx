import { CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import type { Api, Claim } from "../api";
import { dollars } from "../format";
import { sorted } from "./Checklist";

const MARK = {
  pass: { Icon: CircleCheck, label: "Passed" },
  warn: { Icon: TriangleAlert, label: "Warning" },
  fail: { Icon: CircleX, label: "Failed" },
};

/** What was checked on a claim, or how its payout was worked out, built in code from the claim
 * as the handler's own access loads it: the Copilot only names the card. */
export function ClaimFactsCard({
  api,
  kind,
  claimId,
}: {
  api: Api;
  kind: "checks" | "payout";
  claimId: string;
}) {
  const [claim, setClaim] = useState<Claim | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    api.getClaim(claimId).then(
      (found) => {
        if (live) setClaim(found);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [api, claimId]);

  if (failed) return <p className="muted small">Couldn&apos;t load {claimId}.</p>;
  if (!claim) return <p className="muted small">Loading {claimId}…</p>;
  const decision = claim.decision;
  if (!decision) return <p className="muted small">{claimId} has no decision yet.</p>;

  if (kind === "checks") {
    return (
      <div className="facts-card">
        <p className="facts-title">What was checked on {claimId}</p>
        <ul className="facts-checks">
          {sorted(decision.checklist).map((check) => {
            const { Icon, label } = MARK[check.result];
            return (
              <li key={check.label} className={check.result}>
                <Icon size={15} strokeWidth={1.75} aria-label={label} />
                <span>
                  <strong>{check.label}</strong>
                  {check.detail && <span className="muted"> · {check.detail}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
  const lines = decision.calculation?.lines ?? [];
  return (
    <div className="facts-card">
      <p className="facts-title">How {claimId}&apos;s payout was worked out</p>
      {lines.length === 0 ? (
        <p className="muted small">
          {decision.decision === "approve"
            ? `Paid ${dollars(decision.payout)} as claimed.`
            : "Nothing to pay."}
        </p>
      ) : (
        <table className="facts-payout">
          <caption className="visually-hidden">Payout steps for {claimId}</caption>
          <tbody>
            {lines.map((line, i) => (
              <tr key={String(i)}>
                <th scope="row">{line.step}</th>
                <td>{dollars(line.amount)}</td>
              </tr>
            ))}
            <tr className="total">
              <th scope="row">Payout</th>
              <td>{dollars(decision.payout)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
