import { FilePlus2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Api, CustomerClaimSummary, CustomerStatus } from "../api";
import { DelayOffers, PayoutCard, ResumeDraft } from "../components/AccountCards";
import { ClaimTracker } from "../components/ClaimTracker";
import { CoverCards } from "../components/CoverCards";
import { ClaimTypeIcon } from "../components/ClaimTypeIcon";
import { CustomerStatusChip, STATUS_LINE } from "../components/StatusChip";
import { CLAIM_TYPES } from "./NewClaimPage";
import { date, dollars } from "../format";
import { useFocusHeading } from "../useFocusHeading";
import { myClaimHref, NEW_CLAIM_HREF } from "../useHashRoute";

/** How long the stage a claim is at usually takes, so the customer knows when to expect news. */
export const STAGE_TIME: Record<CustomerStatus, string> = {
  received: "Most claims start being assessed within a few minutes.",
  assessing: "Most claims are decided within a few minutes.",
  reviewing: "Final checks usually take less than a business day.",
  with_a_handler: "Most decisions at this stage take 1 to 2 business days.",
  approved: "Payments to a PayID usually land within seconds.",
  paid: "",
  declined: "",
};

// Paid and declined claims are finished; everything else, a person's review included, is in progress.
const COMPLETED = new Set(["paid", "declined"]);

/** The headline under My claims, counting the same claims as the In progress section. */
export function progressLine(claims: CustomerClaimSummary[]): string {
  const moving = claims.filter((claim) => !COMPLETED.has(claim.status)).length;
  if (moving === 0) return "Everything's settled. Safe travels.";
  return `${String(moving)} ${moving === 1 ? "claim" : "claims"} in progress.`;
}

export function MyClaimsPage({ api, name = "" }: { api: Api; name?: string }) {
  const first = name.split(/\s+/)[0] ?? "";
  const [claims, setClaims] = useState<CustomerClaimSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const heading = useFocusHeading();
  const retry = useCallback(() => {
    setError(null);
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    let live = true;
    api.myClaims().then(
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

  const open = claims?.filter((claim) => !COMPLETED.has(claim.status)) ?? [];
  const done = claims?.filter((claim) => COMPLETED.has(claim.status)) ?? [];

  return (
    <section aria-labelledby="my-claims-heading" className="narrow home">
      <div className="page-head">
        <div>
          <h1 id="my-claims-heading" ref={heading} tabIndex={-1}>
            {first ? `Hi ${first}` : "Your claims"}
          </h1>
          {claims && claims.length > 0 && <p className="lead">{progressLine(claims)}</p>}
        </div>
        <a className="button" href={NEW_CLAIM_HREF}>
          <FilePlus2 size={18} strokeWidth={1.75} aria-hidden="true" />
          Make a claim
        </a>
      </div>
      <div className="home-grid">
        <div className="home-main">
          {error && (
            <p className="error" role="alert">
              {error}
              <button type="button" className="button secondary" onClick={retry}>
                Try again
              </button>
            </p>
          )}
          <ResumeDraft api={api} />
          <DelayOffers api={api} />
          {!claims && !error && (
            <div aria-hidden="true">
              {[0, 1, 2].map((key) => (
                <span key={key} className="skeleton skeleton-card" />
              ))}
              <p role="status" className="visually-hidden">
                Loading your claims…
              </p>
            </div>
          )}
          {claims?.length === 0 && (
            <div className="panel empty">
              <h2>No claims yet</h2>
              <p className="muted">
                If something went wrong on your trip, make a claim and we&apos;ll take it from
                there.
              </p>
            </div>
          )}
          {claims && claims.length > 0 && (
            <>
              {open.length > 0 && (
                <section aria-labelledby="in-progress-heading" className="claims-group">
                  <h2 id="in-progress-heading" className="group-heading">
                    In progress <span className="group-count">{open.length}</span>
                  </h2>
                  <ul className="claim-cards">
                    {open.map((claim) => (
                      <li key={claim.claim_id} className={`claim-card panel tone-${claim.status}`}>
                        <div className="claim-card-top">
                          <ClaimTypeIcon claimType={claim.claim_type} />
                          <div className="claim-card-main">
                            {/* The link stretches over the whole card, so anywhere on it opens the claim. */}
                            <a href={myClaimHref(claim.claim_id)} className="claim-card-link">
                              {claim.summary}
                            </a>
                            <p className="claim-meta">
                              {CLAIM_TYPES[claim.claim_type] ?? claim.claim_type} · {claim.claim_id}{" "}
                              · Made {date(claim.submitted_on)}
                            </p>
                          </div>
                          <p className="claim-amount">
                            <span className="number">{dollars(claim.amount_claimed)}</span>
                            <span className="claim-amount-label">claimed</span>
                          </p>
                        </div>
                        {claim.open_requests > 0 ? (
                          <p className="claim-card-line needs-line">
                            <span className="status-dot" aria-hidden="true" />
                            We need{" "}
                            {claim.open_requests === 1
                              ? "one thing"
                              : `${String(claim.open_requests)} things`}{" "}
                            from you to finish this claim.
                            <a
                              className="button soft small-button"
                              href={myClaimHref(claim.claim_id)}
                            >
                              Send it<span className="visually-hidden"> for {claim.claim_id}</span>
                            </a>
                          </p>
                        ) : (
                          <p className="claim-card-line">
                            <span className="status-dot" aria-hidden="true" />
                            {STATUS_LINE[claim.status]}
                          </p>
                        )}
                        <ClaimTracker status={claim.status} mini />
                        {STAGE_TIME[claim.status] && (
                          <p className="claim-eta">{STAGE_TIME[claim.status]}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {done.length > 0 && (
                <section
                  aria-labelledby="completed-heading"
                  className="claims-group done-group panel"
                >
                  {/* Finished claims stay tucked away until the customer opens them. */}
                  <details>
                    <summary>
                      <h2 id="completed-heading" className="group-heading">
                        Completed <span className="group-count">{done.length}</span>
                      </h2>
                    </summary>
                    <ul className="done-rows">
                      {done.map((claim) => (
                        <li key={claim.claim_id} className="done-row">
                          <ClaimTypeIcon claimType={claim.claim_type} />
                          <div className="claim-card-main">
                            <a href={myClaimHref(claim.claim_id)} className="claim-card-link">
                              {claim.summary}
                            </a>
                            <p className="claim-meta">
                              {claim.claim_id} · Made {date(claim.submitted_on)}
                            </p>
                          </div>
                          <CustomerStatusChip status={claim.status} />
                          <span className="number done-amount">
                            {dollars(claim.amount_claimed)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </section>
              )}
            </>
          )}
        </div>
        <aside className="home-side" aria-label="Your cover and payouts">
          <div className="side-ring">
            <CoverCards api={api} />
            <PayoutCard api={api} />
          </div>
        </aside>
      </div>
    </section>
  );
}
