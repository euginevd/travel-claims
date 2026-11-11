import { Check, Receipt, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import type { Api, Risk } from "../api";
import { dollars } from "../format";

const SIGNALS = {
  clear: { Icon: Check, chip: "chip-good", says: "Nothing unusual: " },
  flag: { Icon: TriangleAlert, chip: "chip-warn flag", says: "Worth a look: " },
  fact: { Icon: Receipt, chip: "", says: "" },
} as const;

function Signal({ kind, children }: { kind: keyof typeof SIGNALS; children: string }) {
  const { Icon, chip, says } = SIGNALS[kind];
  return (
    <li className={`chip ${chip}`}>
      <Icon size={13} strokeWidth={1.75} aria-hidden="true" />
      {says && <span className="visually-hidden">{says}</span>}
      {children}
    </li>
  );
}

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
  const shared = risk.shared_receipts.length > 0;
  const flags = (shared ? 1 : 0) + (risk.high_amount ? 1 : 0);
  return (
    <section className="panel risk" aria-labelledby="risk-title">
      <div className="panel-head">
        <h2 id="risk-title">Risk signals</h2>
        <span className="muted small">
          {flags ? `${String(flags)} worth a look` : "nothing unusual"} · signals, not decisions
        </span>
      </div>
      <ul className="risk-list">
        <Signal kind={shared ? "flag" : "clear"}>
          {shared
            ? risk.shared_receipts
                .map((s) => `Receipt ${String(s.receipt)} also on ${s.claim_id} (${s.match})`)
                .join("; ")
            : "No receipt seen on another claim"}
        </Signal>
        <Signal kind={risk.earlier_claims === 0 ? "clear" : "fact"}>
          {risk.earlier_claims === 0
            ? "No earlier claims"
            : `${String(risk.earlier_claims)} earlier ${risk.earlier_claims === 1 ? "claim" : "claims"}, ${dollars(risk.earlier_paid)} paid`}
        </Signal>
        <Signal kind={risk.high_amount ? "flag" : risk.typical_amount === null ? "fact" : "clear"}>
          {risk.typical_amount === null
            ? `${dollars(risk.amount_claimed)} claimed`
            : `${dollars(risk.amount_claimed)} claimed, typical for this type ${dollars(risk.typical_amount)}`}
        </Signal>
      </ul>
    </section>
  );
}
