import { useEffect, useState } from "react";
import type { Api, Claim, Handler, Step } from "../api";
import { DecisionCard } from "../components/DecisionCard";
import { HeldPayout } from "../components/HeldPayout";
import { SourcesPanel } from "../components/SourcesPanel";
import { StatusChip } from "../components/StatusChip";
import { StepList } from "../components/StepList";
import { date, dollars, when } from "../format";
import { useFocusHeading } from "../useFocusHeading";
import { QUEUE_HREF } from "../useHashRoute";

interface ClaimPageProps {
  api: Api;
  claimId: string;
  handler: Handler;
  pollMs: number;
}

const WORKABLE = new Set<Claim["status"]>(["waiting", "sent_back"]);

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

export function ClaimPage({ api, claimId, handler, pollMs }: ClaimPageProps) {
  const [claim, setClaim] = useState<Claim | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const heading = useFocusHeading();

  const working = claim?.status === "in_progress";

  // Load the claim and its steps, then, while the agent works, again every pollMs.
  useEffect(() => {
    let live = true;
    const refresh = () =>
      Promise.all([api.getClaim(claimId), api.listSteps(claimId)]).then(
        ([found, foundSteps]) => {
          if (!live) return;
          setClaim(found);
          setSteps(foundSteps);
          setError(null);
        },
        (caught: unknown) => {
          if (live) setError(messageOf(caught));
        },
      );
    void refresh();
    const timer = working ? window.setInterval(() => void refresh(), pollMs) : undefined;
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [api, claimId, working, pollMs]);

  async function act(action: () => Promise<Claim>) {
    setClaim(await action());
    setSteps(await api.listSteps(claimId));
  }

  async function workClaim() {
    setStarting(true);
    setError(null);
    try {
      await act(() => api.workClaim(claimId));
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setStarting(false);
    }
  }

  if (!claim) {
    return (
      <section>
        <p>
          <a href={QUEUE_HREF}>Back to the queue</a>
        </p>
        <h1 ref={heading} tabIndex={-1}>
          Claim {claimId}
        </h1>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          <p role="status">Loading the claim…</p>
        )}
      </section>
    );
  }

  const held = claim.status === "waiting_for_sign_off";

  return (
    <article className="claim">
      <p>
        <a href={QUEUE_HREF}>Back to the queue</a>
      </p>
      <div className="claim-title">
        <h1 ref={heading} tabIndex={-1}>
          Claim {claim.claim_id}
        </h1>
        <StatusChip status={claim.status} />
      </div>
      <p className="muted">
        {claim.customer_name} · <span className="capitalise">{claim.policy.plan}</span> plan ·
        claimed {dollars(claim.amount_claimed)} · submitted {date(claim.submitted_on)}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="claim-grid">
        <div className="claim-main">
          <section className="panel" aria-labelledby="story-heading">
            <h2 id="story-heading">What happened</h2>
            <p className="muted small">
              {date(claim.incident_date)}, {claim.incident_location}
            </p>
            <p className="story">{claim.story}</p>
            <table className="items">
              <caption>Items claimed</caption>
              <tbody>
                {claim.items.map((item, index) => (
                  <tr key={index}>
                    <th scope="row">{item.description}</th>
                    <td className="number">{dollars(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>Documents</h3>
            {claim.documents.length === 0 ? (
              <p className="muted">No documents.</p>
            ) : (
              claim.documents.map((document) => (
                <details key={document.name} className="document">
                  <summary>{document.name}</summary>
                  <p>{document.content}</p>
                </details>
              ))
            )}
            <h3>Policy</h3>
            <p className="small">
              {claim.policy.policy_id} · {claim.policy.destination}, {date(claim.policy.trip_start)}{" "}
              to {date(claim.policy.trip_end)} · {claim.policy.travelers}{" "}
              {claim.policy.travelers === 1 ? "traveller" : "travellers"}
              {claim.policy.add_ons.length > 0 && (
                <> · add-ons: {claim.policy.add_ons.join(", ")}</>
              )}
            </p>
          </section>

          {WORKABLE.has(claim.status) && (
            <div className="work">
              <button
                type="button"
                className="button"
                disabled={starting}
                onClick={() => {
                  void workClaim();
                }}
              >
                {starting ? "Starting…" : "Work this claim"}
              </button>
              <p className="muted small">
                The agent checks the claim for hidden instructions, then decides it.
              </p>
            </div>
          )}

          {held && (
            <HeldPayout
              claim={claim}
              handler={handler}
              onSignOff={() => act(() => api.signOff(claimId))}
              onSendBack={(note) => act(() => api.sendBack(claimId, note))}
            />
          )}

          {claim.decision && (
            <DecisionCard
              decision={claim.decision}
              payment={claim.payment}
              heading={held ? "The agent's decision" : "Decision"}
            />
          )}

          {claim.sent_back_decisions.length > 0 && (
            <section className="panel" aria-labelledby="sent-back-heading">
              <h2 id="sent-back-heading">Sent back</h2>
              <ol className="sent-back-list">
                {claim.sent_back_decisions.map((sent) => (
                  <li key={sent.sent_back_at}>
                    <p>
                      <strong>{sent.sent_back_by}</strong>{" "}
                      <span className="muted">{when(sent.sent_back_at)}</span>
                    </p>
                    <blockquote>{sent.note}</blockquote>
                    <p className="muted small">
                      The decision sent back: {sent.decision.decision},{" "}
                      {dollars(sent.decision.payout)}. {sent.decision.reason}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        <div className="claim-side">
          <section className="panel" aria-labelledby="steps-heading">
            <h2 id="steps-heading">What the agent did</h2>
            <p role="status" className="muted small">
              {working
                ? `The agent is working on this claim: ${String(steps.length)} steps so far.`
                : `${String(steps.length)} steps.`}
            </p>
            <StepList steps={steps} />
          </section>
          <SourcesPanel steps={steps} />
        </div>
      </div>
    </article>
  );
}
