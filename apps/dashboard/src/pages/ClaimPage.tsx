import { Sparkle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type Api, type Claim, type Handler, type Step } from "../api";
import { ActivityRail, storedTrace } from "../components/ActivityRail";
import { DecisionCard } from "../components/DecisionCard";
import { HeldPayout } from "../components/HeldPayout";
import { NeedsYouBanner } from "../components/NeedsYou";
import { OverridePanel } from "../components/OverridePanel";
import { ReceiptsPanel } from "../components/ReceiptsPanel";
import { SourcesPanel } from "../components/SourcesPanel";
import { StageTracker } from "../components/StageTracker";
import { StatusChip } from "../components/StatusChip";
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
const OVERRIDABLE = new Set<Claim["status"]>(["decided", "waiting_for_sign_off"]);

/** Whether a key press is a shortcut, not typing in a field or a combination. */
function isShortcut(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  const typing = target?.closest("input, textarea, select, [contenteditable='true']");
  return !typing && !event.ctrlKey && !event.metaKey && !event.altKey;
}
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

  return { claim, steps, error, setClaim, reload };
}

export function ClaimPage({ api, claimId, handler, pollMs }: ClaimPageProps) {
  const { claim, steps, error: loadError, setClaim, reload } = useClaim(api, claimId, pollMs);
  // An action's error stays until the next action, even when the claim then loads afresh.
  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError ?? loadError;
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const heading = useFocusHeading();
  const [trace, setTrace] = useState(storedTrace);

  // Keyboard: S to the sign-off button, B to the send-back note, T for the trace, U for the queue.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!isShortcut(event)) return;
      const key = event.key.toLowerCase();
      const focus = (name: string) =>
        document.querySelector<HTMLElement>(`[data-shortcut="${name}"]`)?.focus();
      if (key === "s") focus("sign-off");
      else if (key === "b") focus("send-back");
      else if (key === "t") setTrace((on) => !on);
      else if (key === "u") window.location.hash = QUEUE_HREF;
      else return;
      event.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

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
    setActionError(null);
    try {
      await act(
        () => api.workClaim(claimId),
        () => "The agent has started on this claim.",
      );
    } catch (caught) {
      setActionError(messageOf(caught));
    } finally {
      setStarting(false);
    }
  }

  // One heading for every state, so the focus it takes on opening stays put once loaded.
  return (
    <article className="claim">
      <p className="eyebrow">
        <a href={QUEUE_HREF}>Back to the queue</a>
      </p>
      <div className="claim-title">
        <h1 ref={heading} tabIndex={-1}>
          Claim {claimId}
        </h1>
        {claim && <StatusChip status={claim.status} decision={claim.decision?.decision ?? null} />}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setActionError(null);
              reload();
            }}
          >
            Try again
          </button>
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
      {claim
        ? details(claim)
        : !error && (
            <>
              <p role="status" className="visually-hidden">
                Loading the claim…
              </p>
              <div className="claim-grid" aria-hidden="true">
                <div className="claim-main">
                  <span className="skeleton skeleton-card" />
                  <span className="skeleton skeleton-card" />
                </div>
                <div className="claim-side">
                  <span className="skeleton skeleton-card" />
                </div>
              </div>
            </>
          )}
    </article>
  );

  // A plain render helper, not a component, so React keeps the form state inside it.
  function details(claim: Claim) {
    const held = claim.status === "waiting_for_sign_off";
    const paid = claim.payment !== null;
    const { policy } = claim;
    const travellers = policy.travelers.length;
    const canOverride =
      handler.can_approve_over_limit &&
      OVERRIDABLE.has(claim.status) &&
      !paid &&
      claim.decision !== null;
    return (
      <>
        <p className="muted">
          {claim.customer_name} · <span className="capitalise">{policy.plan}</span> plan · claimed{" "}
          {dollars(claim.amount_claimed)} · submitted {date(claim.submitted_on)}
        </p>
        <StageTracker claim={claim} />
        <NeedsYouBanner claim={claim} />
        {WORKABLE.has(claim.status) && (
          <div className="action-bar">
            <p>
              <strong>Ready for the agent.</strong>{" "}
              <span className="muted">
                It checks for hidden instructions, then assesses the claim against the policy.
              </span>
            </p>
            <button
              type="button"
              className="button"
              disabled={starting}
              onClick={() => {
                void workClaim();
              }}
            >
              <Sparkle size={16} strokeWidth={2} aria-hidden="true" />
              {starting ? "Starting…" : "Work this claim"}
            </button>
          </div>
        )}

        <div className="claim-grid">
          <div className="claim-main">
            <section className="panel" aria-labelledby="story-heading">
              <h2 id="story-heading">Evidence</h2>
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
              <ReceiptsPanel api={api} claimId={claim.claim_id} receipts={claim.receipts} />
              {claim.documents.length > 0 && (
                <>
                  <h3>Documents</h3>
                  {claim.documents.map((document, index) => (
                    <details key={index} className="document">
                      <summary dir="auto">{document.name}</summary>
                      <p dir="auto">{document.content}</p>
                    </details>
                  ))}
                </>
              )}
              <h3>Policy</h3>
              <p className="small">
                {policy.policy_id} · {policy.trip.destination}, {date(policy.trip.departs_on)} to{" "}
                {date(policy.trip.returns_on)} · {travellers}{" "}
                {travellers === 1 ? "traveller" : "travellers"}
                {policy.add_ons.length > 0 && <> · add-ons: {policy.add_ons.join(", ")}</>}
              </p>
            </section>

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

          <aside className="claim-side" aria-label="Recommendation and agent activity">
            {held && (
              <HeldPayout
                claim={claim}
                handler={handler}
                onSignOff={() =>
                  act(
                    () => api.signOff(claimId),
                    (done) => `Signed off and paid ${dollars(done.payment?.amount ?? 0)}.`,
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
                claimed={claim.amount_claimed}
                steps={steps}
              />
            )}
            {canOverride && (
              <OverridePanel
                customerName={claim.customer_name}
                onOverride={(request) =>
                  act(
                    () => api.override(claimId, request),
                    (done) =>
                      done.payment
                        ? `Overridden and paid ${dollars(done.payment.amount)}.`
                        : "Overridden. Your decision is on the record.",
                  )
                }
              />
            )}
            {(steps.length > 0 || working) && (
              <ActivityRail
                api={api}
                claimId={claimId}
                steps={steps}
                working={working}
                trace={trace}
                onTraceChange={setTrace}
              />
            )}
            {trace && steps.some((step) => step.kind === "lookup") && (
              <SourcesPanel steps={steps} />
            )}
            {steps.length === 0 && !working && !claim.decision && (
              <div className="panel waiting-card">
                <p className="ai-line">
                  <Sparkle size={16} strokeWidth={2} aria-hidden="true" />
                  The agent&apos;s recommendation appears here once it has worked the claim.
                </p>
              </div>
            )}
          </aside>
        </div>
      </>
    );
  }
}
