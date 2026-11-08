import { useEffect, useState } from "react";
import type { Api, ClaimSummary } from "../api";
import { StatusChip } from "../components/StatusChip";
import { useFocusHeading } from "../useFocusHeading";
import { date, dollars } from "../format";
import { claimHref } from "../useHashRoute";

export function QueuePage({ api }: { api: Api }) {
  const [claims, setClaims] = useState<ClaimSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const heading = useFocusHeading();

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
  }, [api]);

  return (
    <section aria-labelledby="queue-heading">
      <h1 id="queue-heading" ref={heading} tabIndex={-1}>
        Claims queue
      </h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!claims && !error && <p role="status">Loading the queue…</p>}
      {claims?.length === 0 && <p>The queue is empty.</p>}
      {claims && claims.length > 0 && (
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
                <td>{claim.summary}</td>
                <td className="number">{dollars(claim.amount_claimed)}</td>
                <td>{date(claim.submitted_on)}</td>
                <td>
                  <StatusChip status={claim.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
