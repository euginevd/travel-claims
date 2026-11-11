import { Check, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Api, SimilarClaims } from "../api";
import { date, dollars } from "../format";
import { claimHref } from "../useHashRoute";

/** Decided claims of the same type, the closest in amount first, each linking to its claim.
 * Worked out in code as a guide to how like claims went; never a decision. */
export function SimilarPanel({ api, claimId }: { api: Api; claimId: string }) {
  const [found, setFound] = useState<SimilarClaims | null>(null);

  useEffect(() => {
    let live = true;
    api.getSimilar(claimId).then(
      (similar) => {
        if (live) setFound(similar);
      },
      () => {
        // The panel is a help; the claim still works without it.
      },
    );
    return () => {
      live = false;
    };
  }, [api, claimId]);

  // Another claim's list is never shown while this one's loads.
  if (found?.claim_id !== claimId) return null;
  return (
    <section className="panel similar" aria-labelledby="similar-title">
      <div className="panel-head">
        <h2 id="similar-title">Similar claims</h2>
        <span className="muted small">a guide, not a decision</span>
      </div>
      {found.similar.length === 0 ? (
        <p className="muted small">{found.summary}</p>
      ) : (
        <>
          <p className="similar-summary">{found.summary}</p>
          <ul className="similar-list">
            {found.similar.map((claim) => {
              const approved = claim.outcome === "approve";
              return (
                <li key={claim.claim_id}>
                  <a className="nowrap" href={claimHref(claim.claim_id)}>
                    {claim.claim_id}
                  </a>
                  <span className={`chip ${approved ? "chip-good" : ""}`}>
                    {approved ? (
                      <Check size={13} strokeWidth={1.75} aria-hidden="true" />
                    ) : (
                      <X size={13} strokeWidth={1.75} aria-hidden="true" />
                    )}
                    {approved ? `Approved ${dollars(claim.payout)}` : "Declined"}
                  </span>
                  <span className="muted small nowrap">
                    {dollars(claim.amount_claimed)} claimed · {date(claim.decided_at.slice(0, 10))}
                  </span>
                  {claim.overridden && (
                    <span className="chip chip-warn">
                      <UserRound size={13} strokeWidth={1.75} aria-hidden="true" />
                      Overridden by a person
                    </span>
                  )}
                  <p className="similar-reason" dir="auto">
                    <span className="similar-section">{claim.section}</span> {claim.reason}
                  </p>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
