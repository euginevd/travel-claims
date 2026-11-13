import { ArrowLeft, ArrowRight, ChevronDown, FileText, Sparkle } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, type Api, type Claim, type Handler, type Step } from "../api";
import { AgentStatus, ScreeningNote } from "../components/AgentStatus";
import { DecisionCard } from "../components/DecisionCard";
import { HeldPayout } from "../components/HeldPayout";
import { Checklist } from "../components/Checklist";
import { NextStep, Verdict } from "../components/Verdict";
import { OverridePanel } from "../components/OverridePanel";
import { ReceiptsPanel } from "../components/ReceiptsPanel";
import { StageTracker } from "../components/StageTracker";
import { StatusChip } from "../components/StatusChip";
import { date, dollars, when, words } from "../format";
import { useFocusHeading } from "@undercover/web-core/useFocusHeading";
import { claimHref, QUEUE_HREF } from "../useHashRoute";
import { arrange } from "./QueuePage";
import { AskedPanel } from "../components/AskedPanel";
import { RiskPanel } from "../components/RiskPanel";
import { SimilarPanel } from "../components/SimilarPanel";
import { LetterPanel } from "../components/LetterPanel";

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
  const typing =
    event.target instanceof Element &&
    event.target.closest("input, textarea, select, [contenteditable='true']");
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
  const [tab, setTab] = useState<Tab>("story");

  // Keyboard: S to the sign-off button, B to the send-back note, U for the queue.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!isShortcut(event)) return;
      const key = event.key.toLowerCase();
      const focus = (name: string) =>
        document.querySelector<HTMLElement>(`[data-shortcut="${name}"]`)?.focus();
      if (key === "s") focus("sign-off");
      else if (key === "b") focus("send-back");
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

  async function retryClaim() {
    setStarting(true);
    setActionError(null);
    try {
      await act(
        () => api.retryClaim(claimId),
        () => "The agent is carrying this claim on from where it stopped.",
      );
    } catch (caught) {
      setActionError(messageOf(caught));
    } finally {
      setStarting(false);
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
    <article className="claim page-in">
      <a className="crumb" href={QUEUE_HREF}>
        <ArrowLeft size={15} strokeWidth={1.75} aria-hidden="true" />
        Today
      </a>
      <div className="claim-head">
        <div className="claim-title">
          {claim && (
            <p className="eyebrow">
              {words(claim.claim_type)} · <span className="capitalise">{claim.policy.plan}</span>{" "}
              plan
            </p>
          )}
          <h1 ref={heading} tabIndex={-1}>
            Claim {claimId}
          </h1>
          {claim && (
            <p className="claim-summary" dir="auto">
              {claim.summary}
            </p>
          )}
        </div>
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
    const decision = claim.decision;
    const senior = handler.can_approve_over_limit;
    const canOverride = senior && OVERRIDABLE.has(claim.status) && !paid && decision !== null;
    const referred =
      decision?.decision === "refer" &&
      !decision.override &&
      (claim.status === "decided" || claim.status === "left_for_handler");
    const received = claim.receipts.length + claim.documents.length;
    const itemsTotal = claim.items.reduce((sum, item) => sum + item.amount, 0);
    const updated = (next: Claim, message: string) => {
      setClaim(next);
      setNotice(message);
      reload();
    };

    let action: ReactNode = null;
    let more: ReactNode = null;
    if (claim.stalled) {
      action = (
        <div className="action-row">
          <button
            type="button"
            className="button"
            disabled={starting}
            onClick={() => {
              void retryClaim();
            }}
          >
            <Sparkle size={16} strokeWidth={1.75} aria-hidden="true" />
            {starting ? "Retrying…" : "Retry"}
          </button>
          <span className="muted small">
            Carries it on from the last step it saved; nothing is decided or paid twice.
          </span>
        </div>
      );
    } else if (WORKABLE.has(claim.status)) {
      action = (
        <div className="action-row">
          <button
            type="button"
            className="button"
            disabled={starting}
            onClick={() => {
              void workClaim();
            }}
          >
            <Sparkle size={16} strokeWidth={1.75} aria-hidden="true" />
            {starting ? "Starting…" : "Work this claim"}
          </button>
          <span className="muted small">
            It checks for hidden instructions, then assesses the claim against the policy.
          </span>
        </div>
      );
    } else if (working) {
      action = <AgentStatus steps={steps} working={working} />;
    } else if (held && !senior) {
      action = (
        <p className="muted">
          A senior handler signs this off or sends it back; nothing is paid until they do.
        </p>
      );
    } else if (held) {
      action = (
        <HeldPayout
          claim={claim}
          handler={handler}
          onSignOff={() =>
            act(
              () => api.signOff(claimId, claim.decision?.payout ?? 0),
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
      );
    } else if (referred) {
      action = <NextStep api={api} claim={claim} onUpdated={updated} />;
      more = (
        <>
          <p className="muted small">
            Or decide it yourself
            {senior ? "" : `, within your ${dollars(claim.approval_limit)} limit`}
          </p>
          <OverridePanel
            mode="decide"
            customerName={claim.customer_name}
            suggested={decision.calculation?.payout || undefined}
            limit={senior ? null : claim.approval_limit}
            onOverride={(request) =>
              act(
                () => api.decide(claimId, request),
                (done) =>
                  done.payment
                    ? `Decided and paid ${dollars(done.payment.amount)}.`
                    : "Decided. Your decision is on the record.",
              )
            }
          />
        </>
      );
    } else if (decision && claim.status === "decided" && decision.decision !== "refer") {
      action = <LetterPanel api={api} claim={claim} onUpdated={setClaim} />;
    }
    if (canOverride && !referred) {
      more = (
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
      );
    }

    const tabs: { key: Tab; label: string }[] = [
      { key: "story", label: "Story and items" },
      { key: "documents", label: `Documents ${String(received)}` },
      ...(decision ? [{ key: "decision" as const, label: "Decision in full" }] : []),
      { key: "signals", label: "Signals" },
      {
        key: "history",
        label: `Asked and history${claim.requests.length ? ` ${String(claim.requests.length)}` : ""}`,
      },
    ];
    const shown = tabs.some((one) => one.key === tab) ? tab : "story";

    return (
      <>
        <dl className="claim-facts">
          <div>
            <dt>Customer</dt>
            <dd>{claim.customer_name}</dd>
          </div>
          <div>
            <dt>Claimed</dt>
            <dd>{dollars(claim.amount_claimed)}</dd>
          </div>
          <div>
            <dt>Submitted</dt>
            <dd>{date(claim.submitted_on)}</dd>
          </div>
          <div>
            <dt>Policy</dt>
            <dd>
              {policy.policy_id}
              {policy.add_ons.length > 0 && <> · add-ons: {policy.add_ons.join(", ")}</>}
            </dd>
          </div>
          <div>
            <dt>Trip</dt>
            <dd>
              {policy.trip.destination}, {date(policy.trip.departs_on)} to{" "}
              {date(policy.trip.returns_on)} · {travellers}{" "}
              {travellers === 1 ? "traveller" : "travellers"}
            </dd>
          </div>
        </dl>
        <StageTracker claim={claim} />
        <Verdict claim={claim} senior={senior} action={action} more={more} />

        <div className="claim-tabs" role="tablist" aria-label="The claim's evidence">
          {tabs.map((one) => (
            <button
              key={one.key}
              type="button"
              role="tab"
              id={`tab-${one.key}`}
              aria-selected={shown === one.key}
              aria-controls={`panel-${one.key}`}
              className={shown === one.key ? "on" : undefined}
              onClick={() => {
                setTab(one.key);
              }}
            >
              {one.label}
            </button>
          ))}
        </div>
        <div
          className="claim-tab-body"
          role="tabpanel"
          id={`panel-${shown}`}
          aria-labelledby={`tab-${shown}`}
        >
          {shown === "story" && (
            <>
              <section aria-labelledby="story-heading">
                <div className="panel-head">
                  <h2 id="story-heading">In the customer&apos;s words</h2>
                  <span className="muted small">
                    {date(claim.incident_date)}, {claim.incident_location}
                  </span>
                </div>
                <p className="story" dir="auto">
                  {claim.story}
                </p>
              </section>
              <section aria-labelledby="items-heading">
                <div className="panel-head">
                  <h2 id="items-heading">Items</h2>
                  <span className="muted small">{claim.items.length} claimed</span>
                </div>
                <div className="table-scroll">
                  <table className="items">
                    <caption className="visually-hidden">Items claimed</caption>
                    <thead>
                      <tr>
                        <th scope="col">Item</th>
                        <th scope="col">Category</th>
                        <th scope="col" className="number">
                          Claimed
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {claim.items.map((item, index) => (
                        <tr key={index}>
                          <th scope="row" dir="auto">
                            {item.description}
                          </th>
                          <td>{words(item.category)}</td>
                          <td className="number">{dollars(item.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th scope="row" colSpan={2}>
                          Total
                        </th>
                        <td className="number">{dollars(itemsTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>
              {decision && decision.checklist.length > 0 && (
                <Checklist checks={decision.checklist} steps={steps} />
              )}
            </>
          )}
          {shown === "documents" && (
            <section aria-labelledby="documents-heading">
              <div className="panel-head">
                <h2 id="documents-heading">Documents</h2>
                <span className="muted small">{received} received</span>
              </div>
              {received === 0 && (
                <p className="muted small">No receipts or documents came with this claim.</p>
              )}
              <ReceiptsPanel api={api} claimId={claim.claim_id} receipts={claim.receipts} />
              {claim.documents.length > 0 && (
                <ul className="doc-list">
                  {claim.documents.map((document, index) => (
                    <li key={index}>
                      <details className="document">
                        <summary>
                          <span className="icon-tile" aria-hidden="true">
                            <FileText size={15} strokeWidth={1.75} />
                          </span>
                          <span className="doc-name" dir="auto">
                            {document.name}
                          </span>
                          <span className="muted small doc-type">{words(document.type)}</span>
                          <ChevronDown
                            className="chevron"
                            size={16}
                            strokeWidth={1.75}
                            aria-hidden="true"
                          />
                        </summary>
                        <p dir="auto">{document.content}</p>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {shown === "decision" && decision && (
            <>
              <DecisionCard
                decision={decision}
                payment={claim.payment}
                claimed={claim.amount_claimed}
                steps={steps}
              />
              <ScreeningNote steps={steps} />
            </>
          )}
          {shown === "signals" && (
            <>
              <RiskPanel api={api} claimId={claim.claim_id} />
              <SimilarPanel api={api} claimId={claim.claim_id} />
            </>
          )}
          {shown === "history" && (
            <>
              <AskedPanel api={api} claim={claim} onUpdated={setClaim} />
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
            </>
          )}
        </div>
        {notice && <NextClaim api={api} claimId={claimId} notice={notice} senior={senior} />}
      </>
    );
  }
}

type Tab = "story" | "documents" | "decision" | "signals" | "history";

/** After an action: what was done, and the next claim that needs the handler, so the list is
 * worked one claim at a time. */
function NextClaim({
  api,
  claimId,
  notice,
  senior,
}: {
  api: Api;
  claimId: string;
  notice: string;
  senior: boolean;
}) {
  const [next, setNext] = useState<string | null | undefined>(undefined);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    let live = true;
    api.listClaims().then(
      (claims) => {
        if (!live) return;
        const mine = arrange(claims, "needs_me", "", "", "queue").filter(
          (claim) =>
            claim.claim_id !== claimId && (senior || claim.status !== "waiting_for_sign_off"),
        );
        setLeft(mine.length);
        setNext(mine[0]?.claim_id ?? null);
      },
      () => {
        if (live) setNext(null);
      },
    );
    return () => {
      live = false;
    };
  }, [api, claimId, notice, senior]);
  if (next === undefined) return null;
  return (
    <div className="next-claim">
      <span>Done.</span>
      <span className="next-claim-left">
        {left === 0 ? "Nothing else needs you." : `${String(left)} more need you.`}
      </span>
      <a className="button" href={next ? claimHref(next) : QUEUE_HREF}>
        {next ? `Next: ${next}` : "Back to Today"}
        <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
      </a>
    </div>
  );
}
