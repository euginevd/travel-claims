import { Copy, Receipt, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import type { Api, Risk } from "../api";
import { dollars } from "../format";

/** Signals worth a second look on a claim: receipts seen on other claims, the customer's earlier
 * claims, and the amount against the typical one for the claim type. Never a decision. */
export function RiskPanel({ api, claimId }: { api: Api; claimId: string }) {
  const [risk, setRisk] = useState<Risk | null>(null);

  useEffect(() => {
    let live = true;
    api.getRisk(claimId).then(
      (found) => {
        if (live) setRisk(found);
      },
      () => {
        // The panel is a help; the claim still works without it.
      },
    );
    return () => {
      live = false;
    };
  }, [api, claimId]);

  if (!risk) return null;
  const flags = (risk.shared_receipts.length > 0 ? 1 : 0) + (risk.high_amount ? 1 : 0);
  return (
    <section className={`risk${flags ? " risk-flagged" : ""}`} aria-labelledby="risk-title">
      <h3 id="risk-title">
        Risk signals{" "}
        <span className="muted small">
          {flags ? `${String(flags)} worth a look` : "nothing unusual"} · signals, not decisions
        </span>
      </h3>
      <ul className="risk-list">
        <li className={risk.shared_receipts.length ? "flag" : ""}>
          <Copy size={16} strokeWidth={2} aria-hidden="true" />
          {risk.shared_receipts.length === 0
            ? "No receipt seen on another claim"
            : risk.shared_receipts
                .map((s) => `Receipt ${String(s.receipt)} also on ${s.claim_id} (${s.match})`)
                .join("; ")}
        </li>
        <li>
          <Receipt size={16} strokeWidth={2} aria-hidden="true" />
          {risk.earlier_claims === 0
            ? "No earlier claims"
            : `${String(risk.earlier_claims)} earlier ${risk.earlier_claims === 1 ? "claim" : "claims"}, ${dollars(risk.earlier_paid)} paid`}
        </li>
        <li className={risk.high_amount ? "flag" : ""}>
          <TrendingUp size={16} strokeWidth={2} aria-hidden="true" />
          {risk.typical_amount === null
            ? `${dollars(risk.amount_claimed)} claimed`
            : `${dollars(risk.amount_claimed)} claimed, typical for this type ${dollars(risk.typical_amount)}`}
        </li>
      </ul>
    </section>
  );
}
