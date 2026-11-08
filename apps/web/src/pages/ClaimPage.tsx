import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type Api, type Claim, type Handler, type Step } from "../api";
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
// After failed polls, wait longer each time, up to this many times the usual wait.
const MOST_BACK_OFF = 16;

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/**
 * The claim and its steps, loaded once and then, while the agent works, again pollMs after
 * each load settles, so loads never overlap. Leaving the page aborts what's in flight; a
 * failed load while the agent works is retried with a longer wait each time.
 */
function useClaim(api: Api, claimId: string, pollMs: number) {
  const [claim, setClaim] = useState<Claim | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => {
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    let failures = 0;
    let working = false;

    async function load() {
      try {
        const [found, foundSteps] = await Promise.all([
          api.getClaim(claimId, controller.signal),
          api.listSteps(claimId, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setClaim(found);
        setSteps(foundSteps);
        setError(null);
        failures = 0;
        working = found.status === "in_progress";
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(messageOf(caught));
        failures += 1;
      }
      if (working) {
        const wait = pollMs * Math.min(2 ** failures, MOST_BACK_OFF);
        timer = window.setTimeout(() => void load(), wait);
      }
    }

    void load();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [api, claimId, pollMs, generation]);

  return { claim, steps, error, setClaim, setError, reload };
}

export function ClaimPage({ api, claimId, handler, pollMs }: ClaimPageProps) {
  const { claim, steps, error, setClaim, setError, reload } = useClaim(api, claimId, pollMs);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const heading = useFocusHeading();

  // Focus the outcome of an action, since the panel it was taken from has gone.
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  const working = claim?.status === "in_progress";

  /** Take an action; on success show its result and load afresh. A 409 means the claim moved
   * on (another handler, or the agent), so load afresh then too, and let the caller say why. */
  async function act(action: () => Promise<Claim>, done: (claim: Claim) => string) {
    try {
      const updated = await action();
      setClaim(updated);
      setNotice(done(updated));
      reload();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) reload();
      throw caught;
    }
  }

  async function workClaim() {
    setStarting(true);
    setError(null);
    try {
      await act(
        () => api.workClaim(claimId),
        () => "The agent has started on this claim.",
      );
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setStarting(false);
    }
  }

  // One heading for every state, so the focus it takes on opening stays put once loaded.
  return (
    <article className="claim">
      <p>
        <a href={QUEUE_HREF}>Back to the queue</a>
      </p>
      <div className="claim-title">
        <h1 ref={heading} tabIndex={-1}>
          Claim {claimId}
        </h1>
        {claim && <StatusChip status={claim.status} />}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p
        ref={noticeRef}
        tabIndex={-1}
        role="status"
        className={notice ? "notice" : "visually-hidden"}
      >
        {notice}
      </p>
      {claim ? details(claim) : !error && <p role="status">Loading the claim…</p>}
    </article>
  );

  // A plain render helper, not a component, so React keeps the form state inside it.
  function details(claim: Claim) {
    const held = claim.status === "waiting_for_sign_off";
    const { policy } = claim;
    const travellers = policy.travelers.length;
    return (
      <>
        <p className="muted">
          {claim.customer_name} · <span className="capitalise">{policy.plan}</span> plan · claimed{" "}
          {dollars(claim.amount_claimed)} · submitted {date(claim.submitted_on)}
        </p>

        <div className="claim-grid">
          <div className="claim-main">
            <section className="panel" aria-labelledby="story-heading">
              <h2 id="story-heading">What happened</h2>
              <p className="muted small">
                {date(claim.incident_date)}, {claim.incident_location}
              </p>
              <p className="story" dir="auto">
                {claim.story}
              </p>
              <table className="items">
                <caption>Items claimed</caption>
                <tbody>
                  {claim.items.map((item, index) => (
                    <tr key={index}>
                      <th scope="row" dir="auto">
                        {item.description}
                      </th>
                      <td className="number">{dollars(item.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3>Documents</h3>
              {claim.documents.length === 0 ? (
                <p className="muted">No documents.</p>
              ) : (
                claim.documents.map((document, index) => (
                  <details key={index} className="document">
                    <summary dir="auto">{document.name}</summary>
                    <p dir="auto">{document.content}</p>
                  </details>
                ))
              )}
              <h3>Policy</h3>
              <p className="small">
                {policy.policy_id} · {policy.trip.destination}, {date(policy.trip.departs_on)} to{" "}
                {date(policy.trip.returns_on)} · {travellers}{" "}
                {travellers === 1 ? "traveller" : "travellers"}
                {policy.add_ons.length > 0 && <> · add-ons: {policy.add_ons.join(", ")}</>}
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
                onSignOff={() =>
                  act(
                    () => api.signOff(claimId),
                    (paid) => `Signed off and paid ${dollars(paid.payment?.amount ?? 0)}.`,
                  )
                }
                onSendBack={(note) =>
                  act(
                    () => api.sendBack(claimId, note),
                    () => "Sent back to the agent with your note.",
                  )
                }
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
                  {claim.sent_back_decisions.map((sent, index) => (
                    <li key={index}>
                      <p>
                        <strong>{sent.sent_back_by}</strong>{" "}
                        <span className="muted">{when(sent.sent_back_at)}</span>
                      </p>
                      <blockquote dir="auto">{sent.note}</blockquote>
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
              <p className="muted small">
                {working
                  ? `The agent is working on this claim: ${String(steps.length)} steps so far.`
                  : `${String(steps.length)} steps.`}
              </p>
              <StepList steps={steps} />
            </section>
            <SourcesPanel steps={steps} />
          </div>
        </div>
      </>
    );
  }
}
