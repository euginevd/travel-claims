import { FilePlus2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Api, CustomerClaimSummary } from "../api";
import { CustomerStatusChip } from "../components/StatusChip";
import { CLAIM_TYPES } from "./NewClaimPage";
import { date, dollars } from "../format";
import { useFocusHeading } from "../useFocusHeading";
import { myClaimHref, NEW_CLAIM_HREF } from "../useHashRoute";

export function MyClaimsPage({ api }: { api: Api }) {
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

  return (
    <section aria-labelledby="my-claims-heading" className="narrow">
      <div className="page-head">
        <div>
          <p className="eyebrow">Your claims</p>
          <h1 id="my-claims-heading" ref={heading} tabIndex={-1}>
            My claims
          </h1>
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
        <ul className="claim-cards">
          {claims.map((claim) => (
            <li key={claim.claim_id} className="claim-card panel">
              <div className="claim-card-head">
                <a href={myClaimHref(claim.claim_id)} className="claim-card-link">
                  {claim.summary}
                </a>
                <CustomerStatusChip status={claim.status} />
              </div>
              <p className="muted">{claim.status_text}</p>
              <dl className="facts inline">
                <dt>Claim</dt>
                <dd className="nowrap">{claim.claim_id}</dd>
                <dt>Type</dt>
                <dd>{CLAIM_TYPES[claim.claim_type] ?? claim.claim_type}</dd>
                <dt>Claimed</dt>
                <dd className="number">{dollars(claim.amount_claimed)}</dd>
                <dt>Made</dt>
                <dd className="nowrap">{date(claim.submitted_on)}</dd>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
