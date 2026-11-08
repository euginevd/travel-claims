import { useCallback, useEffect, useState } from "react";
import type { Api, ClaimSummary } from "../api";
import { StatusChip } from "../components/StatusChip";
import { useFocusHeading } from "../useFocusHeading";
import { date, dollars } from "../format";
import { claimHref } from "../useHashRoute";

interface Figure {
  label: string;
  value: string;
}

// The four figures above the queue, worked out from the claims themselves.
export function figuresOf(claims: ClaimSummary[]): Figure[] {
  const count = (status: ClaimSummary["status"]) =>
    claims.filter((claim) => claim.status === status).length;
  const paid = claims
    .filter((claim) => claim.status === "decided" && claim.decision === "approve")
    .reduce((sum, claim) => sum + (claim.payout ?? 0), 0);
  return [
    { label: "Waiting", value: String(count("waiting") + count("sent_back")) },
    { label: "Waiting for sign-off", value: String(count("waiting_for_sign_off")) },
    { label: "Decided", value: String(count("decided")) },
    { label: "Paid so far", value: dollars(paid) },
  ];
}

function Skeleton() {
  return (
    <div aria-hidden="true">
      <div className="figures">
        {[0, 1, 2, 3].map((key) => (
          <span key={key} className="skeleton skeleton-figure" />
        ))}
      </div>
      {[0, 1, 2, 3, 4, 5].map((key) => (
        <span key={key} className="skeleton skeleton-row" />
      ))}
    </div>
  );
}

export function QueuePage({ api }: { api: Api }) {
  const [claims, setClaims] = useState<ClaimSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const heading = useFocusHeading();
  const retry = useCallback(() => {
    setError(null);
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    let live = true;
    api.listClaims().then(
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
    <section aria-labelledby="queue-heading">
      <p className="eyebrow">Handlers' dashboard</p>
      <h1 id="queue-heading" ref={heading} tabIndex={-1}>
        Claims queue
      </h1>
      {error && (
        <p className="error" role="alert">
          {error}
          <button type="button" className="button secondary" onClick={retry}>
            Try again
          </button>
        </p>
      )}
      {!claims && !error && (
        <>
          <p role="status" className="visually-hidden">
            Loading the queue…
          </p>
          <Skeleton />
        </>
      )}
      {claims?.length === 0 && (
        <div className="panel empty">
          <h2>The queue is empty</h2>
          <p className="muted">New claims appear here as customers submit them.</p>
        </div>
      )}
      {claims && claims.length > 0 && (
        <>
          <ul className="figures" aria-label="The queue at a glance">
            {figuresOf(claims).map((figure) => (
              <li key={figure.label} className="figure">
                <p className="eyebrow">{figure.label}</p>
                <p className="figure-value">{figure.value}</p>
              </li>
            ))}
          </ul>
          <div className="table-wrap">
            <table className="queue">
              <caption className="visually-hidden">
                {claims.length} claims, oldest submitted first
              </caption>
              <thead>
                <tr>
                  <th scope="col">Claim</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Plan</th>
                  <th scope="col">What happened</th>
                  <th scope="col" className="number">
                    Claimed
                  </th>
                  <th scope="col">Submitted</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((claim) => (
                  <tr key={claim.claim_id}>
                    <th scope="row">
                      <a href={claimHref(claim.claim_id)}>{claim.claim_id}</a>
                    </th>
                    <td>{claim.customer_name}</td>
                    <td className="capitalise">{claim.plan}</td>
                    <td dir="auto">{claim.summary}</td>
                    <td className="number">{dollars(claim.amount_claimed)}</td>
                    <td>{date(claim.submitted_on)}</td>
                    <td>
                      <StatusChip status={claim.status} decision={claim.decision} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
