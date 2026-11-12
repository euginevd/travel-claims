import {
  CircleCheck,
  CircleStop,
  Clock,
  Hand,
  Hourglass,
  Inbox,
  LoaderCircle,
  Play,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ApiError, type Api, type Dispatch, type Handler, type LatestDispatch } from "../api";
import { dollars, when } from "../format";
import { claimHref } from "../useHashRoute";
import { StatusChip } from "./StatusChip";

const POLL_MS = 3000;
// Claude's cost per claim, as a range for the confirm step (costs.md).
const LOW_PER_CLAIM = 0.02;
const HIGH_PER_CLAIM = 0.04;

function costRange(claims: number): string {
  return `${dollars(claims * LOW_PER_CLAIM)} to ${dollars(claims * HIGH_PER_CLAIM)}`;
}

function outcome(claim: Dispatch["claims"][number]): string {
  if (!claim.decision) return "–";
  return claim.decision === "approve" ? `Approve ${dollars(claim.payout ?? 0)}` : claim.decision;
}

function Progress({ dispatch }: { dispatch: Dispatch }) {
  const total = dispatch.claims.length;
  const running = dispatch.status === "running";
  return (
    <>
      <div className="dispatch-head">
        <h2 id="dispatch-heading">
          Dispatch #{dispatch.dispatch_id}{" "}
          {running ? (
            <span className="chip chip-info">
              <LoaderCircle size={14} strokeWidth={1.75} aria-hidden="true" />
              Running
            </span>
          ) : (
            <span className={`chip ${dispatch.status === "stopped" ? "chip-bad" : "chip-good"}`}>
              {dispatch.status === "stopped" ? (
                <CircleStop size={13} strokeWidth={1.75} aria-hidden="true" />
              ) : (
                <CircleCheck size={13} strokeWidth={1.75} aria-hidden="true" />
              )}
              {dispatch.status === "stopped" ? "Stopped" : "Finished"}
            </span>
          )}
        </h2>
        <p className="muted small">
          Started {when(dispatch.started_at)} by {dispatch.started_by} · {dispatch.concurrency} at
          once · {dollars(dispatch.total_cost)}
          {running ? " so far" : ""}
        </p>
      </div>
      {dispatch.stopped_reason && <p className="muted small">{dispatch.stopped_reason}</p>}
      <progress
        className="dispatch-bar"
        max={Math.max(total, 1)}
        value={dispatch.worked}
        aria-label="Claims worked"
      />
      <p className="small">
        <strong>
          {dispatch.worked} of {total}
        </strong>{" "}
        worked
      </p>
      <ul className="dispatch-counts" aria-label="Where the dispatch's claims are">
        <li className="chip chip-good">
          <CircleCheck size={14} strokeWidth={1.75} aria-hidden="true" />
          {dispatch.decided} decided
        </li>
        <li className="chip chip-warn">
          <Hourglass size={14} strokeWidth={1.75} aria-hidden="true" />
          {dispatch.waiting_for_sign_off} waiting for sign-off
        </li>
        <li className="chip chip-refer">
          <Hand size={14} strokeWidth={1.75} aria-hidden="true" />
          {dispatch.referred} referred
        </li>
        <li className="chip chip-info">
          <Clock size={14} strokeWidth={1.75} aria-hidden="true" />
          {dispatch.not_started} not started
        </li>
      </ul>
      <details className="dispatch-claims">
        <summary>This dispatch's claims</summary>
        <div className="table-wrap">
          <table>
            <caption className="visually-hidden">This dispatch's claims, oldest first</caption>
            <thead>
              <tr>
                <th scope="col">Claim</th>
                <th scope="col">Where it is</th>
                <th scope="col">Decision</th>
                <th scope="col" className="number">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody>
              {dispatch.claims.map((claim) => (
                <tr key={claim.claim_id}>
                  <th scope="row" className="nowrap">
                    <a href={claimHref(claim.claim_id)}>{claim.claim_id}</a>
                  </th>
                  <td className="nowrap">
                    <StatusChip status={claim.status} decision={claim.decision} />
                  </td>
                  <td>{outcome(claim)}</td>
                  <td className="number">${claim.cost.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

interface Props {
  api: Api;
  handler: Handler;
  /** Called on each poll while a dispatch runs, so the queue below refreshes too. */
  onProgress: () => void;
}

/** The queue's dispatch card: for a senior handler, the way to send claim agents through the
 * waiting claims; for every handler, the latest dispatch's progress. */
export function DispatchCard({ api, handler, onProgress }: Props) {
  const [latest, setLatest] = useState<LatestDispatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [agents, setAgents] = useState(3);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const agentsTouched = useRef(false);
  const ids = useId();
  const senior = handler.can_approve_over_limit;

  // Start from the number on the Settings page, unless the handler has already typed one.
  useEffect(() => {
    if (!senior) return;
    let live = true;
    api.getSettings().then(
      (found) => {
        if (live && !agentsTouched.current) setAgents(found.values.agents_at_once);
      },
      () => {
        // Only a starting value: the form works without it.
      },
    );
    return () => {
      live = false;
    };
  }, [api, senior]);

  const refresh = useCallback(() => {
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api.getLatestDispatch(controller.signal).then(
      (found) => {
        setLatest(found);
        setError(null);
      },
      (caught: unknown) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      },
    );
    return () => {
      controller.abort();
    };
  }, [api, generation]);

  const running = latest?.dispatch?.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => {
      refresh();
      onProgress();
    }, POLL_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [running, refresh, onProgress, latest]);

  async function start() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.startDispatch(agents);
      setConfirming(false);
      refresh();
      onProgress();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Couldn't start the dispatch.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const waiting = latest?.waiting ?? 0;
  const dispatch = latest?.dispatch ?? null;
  // With nothing waiting and nothing running, the card folds down to one quiet line.
  const quiet = !error && (latest === null || (!running && waiting === 0));

  return (
    <section
      className={quiet ? "dispatch dispatch-quiet" : "panel dispatch"}
      aria-labelledby="dispatch-heading"
      aria-busy={!latest}
    >
      {!latest && !error && (
        <>
          <h2 id="dispatch-heading" className="visually-hidden">
            Dispatch
          </h2>
          <p role="status" className="muted small dispatch-line">
            Loading the latest dispatch…
          </p>
        </>
      )}
      {error && (
        <>
          {!dispatch && <h2 id="dispatch-heading">Dispatch</h2>}
          <p className="error" role="alert">
            {error}
            <button type="button" className="button secondary" onClick={refresh}>
              Try again
            </button>
          </p>
        </>
      )}
      {latest && running && dispatch && <Progress dispatch={dispatch} />}
      {latest && !running && (
        <>
          {!error && (
            <h2 id="dispatch-heading" className={quiet ? "visually-hidden" : undefined}>
              Dispatch
            </h2>
          )}
          {waiting === 0 ? (
            <p className="muted small dispatch-line">
              <span className="icon-tile" aria-hidden="true">
                <Inbox size={15} strokeWidth={1.75} />
              </span>
              Nothing is waiting, so there&apos;s nothing to dispatch. New claims from the portal
              land here.
            </p>
          ) : senior ? (
            <p className="muted small">
              {waiting} {waiting === 1 ? "claim is" : "claims are"} waiting. Claim agents work them
              oldest first; approvals over the limit still wait for you.
            </p>
          ) : (
            <p className="muted small">
              {waiting} {waiting === 1 ? "claim is" : "claims are"} waiting. A senior handler can
              have claim agents work them.
            </p>
          )}
          {senior && waiting > 0 && !confirming && (
            <form
              className="dispatch-form"
              onSubmit={(event) => {
                event.preventDefault();
                setConfirming(true);
              }}
            >
              <div>
                <label htmlFor={`${ids}-agents`}>Claims worked at once</label>
                <input
                  id={`${ids}-agents`}
                  type="number"
                  min={1}
                  max={25}
                  value={agents}
                  aria-describedby={`${ids}-hint`}
                  onChange={(event) => {
                    agentsTouched.current = true;
                    setAgents(Math.min(25, Math.max(1, Number(event.target.value) || 1)));
                  }}
                />
                <p id={`${ids}-hint`} className="muted small">
                  1 to 25
                </p>
              </div>
              <button className="button" type="submit">
                <Play size={16} strokeWidth={1.75} aria-hidden="true" />
                Work the waiting claims
              </button>
            </form>
          )}
          {senior && confirming && (
            <div role="dialog" aria-labelledby={`${ids}-confirm`} className="dispatch-confirm">
              <h3 id={`${ids}-confirm`}>
                Work {Math.min(waiting, 50)} waiting {waiting === 1 ? "claim" : "claims"}?
              </h3>
              <p className="muted small">
                {agents} claim {agents === 1 ? "agent" : "agents"} at once. About{" "}
                {costRange(Math.min(waiting, 50))} of Claude. Payouts over the limit will wait for
                your sign-off.
              </p>
              <div className="actions">
                <button
                  className="button secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setConfirming(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="button"
                  type="button"
                  disabled={busy}
                  onClick={() => void start()}
                >
                  Start the dispatch
                </button>
              </div>
            </div>
          )}
          {dispatch && (
            <p className="muted small dispatch-last">
              Last time claim agents worked the queue: {dispatch.status}{" "}
              {when(dispatch.finished_at ?? dispatch.started_at)} by {dispatch.started_by},{" "}
              {dispatch.claims.length} {dispatch.claims.length === 1 ? "claim" : "claims"}
              {dispatch.stopped_reason ? ` · ${dispatch.stopped_reason}` : ""}
            </p>
          )}
        </>
      )}
    </section>
  );
}
