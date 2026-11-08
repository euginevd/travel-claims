import { FilePlus2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Api, CustomerClaimSummary } from "../api";
import { ClaimTracker } from "../components/ClaimTracker";
import { ClaimTypeIcon } from "../components/ClaimTypeIcon";
import { CustomerStatusChip, STATUS_LINE } from "../components/StatusChip";
import { CLAIM_TYPES } from "./NewClaimPage";
import { date, dollars } from "../format";
import { useFocusHeading } from "../useFocusHeading";
import { myClaimHref, NEW_CLAIM_HREF } from "../useHashRoute";

/** Claims still moving: not yet paid, declined or with a person. */
// Paid and declined claims are finished; everything else is still moving.
const COMPLETED = new Set(["paid", "declined"]);

function onTheirWay(claims: CustomerClaimSummary[]): number {
  return claims.filter((c) => ["received", "assessing", "reviewing", "approved"].includes(c.status))
    .length;
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
    <section aria-labelledby="my-claims-heading" className="narrow">
      <div className="page-head">
        <div>
          <p className="greeting">{first ? `Hi ${first}` : "Welcome back"}</p>
          <h1 id="my-claims-heading" ref={heading} tabIndex={-1}>
            My claims
          </h1>
          {claims && claims.length > 0 && (
            <p className="lead">
              {onTheirWay(claims) === 0
                ? "Everything's settled. Safe travels."
                : `${String(onTheirWay(claims))} ${onTheirWay(claims) === 1 ? "claim is" : "claims are"} on the way.`}
            </p>
          )}
        </div>
        <a className="button" href={NEW_CLAIM_HREF}>
          <FilePlus2 size={18} strokeWidth={2} aria-hidden="true" />
          Make a claim
        </a>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
          <button type="button" className="button secondary" onClick={retry}>
            Try again
          </button>
        </p>
      )}
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
            If something went wrong on your trip, make a claim and we&apos;ll take it from there.
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
                          {CLAIM_TYPES[claim.claim_type] ?? claim.claim_type} · {claim.claim_id} ·
                          Made {date(claim.submitted_on)}
                        </p>
                      </div>
                      <p className="claim-amount">
                        <span className="number">{dollars(claim.amount_claimed)}</span>
                        <span className="claim-amount-label">claimed</span>
                      </p>
                    </div>
                    <p className="claim-card-line">
                      <span className="status-dot" aria-hidden="true" />
                      {STATUS_LINE[claim.status]}
                    </p>
                    <ClaimTracker status={claim.status} mini />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {done.length > 0 && (
            <section aria-labelledby="completed-heading" className="claims-group">
              <details open={done.length <= 3 || open.length === 0}>
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
                      <span className="number done-amount">{dollars(claim.amount_claimed)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          )}
        </>
      )}
    </section>
  );
}
