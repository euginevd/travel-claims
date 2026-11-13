import { RotateCcw } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { Api, ResetRequest, ResetView } from "../api";

interface Props {
  api: Api;
  /** After a reset: the header's agent and payouts load again. */
  onReset: () => void;
}

const TICKS: { key: keyof ResetRequest; label: string; detail: (view: ResetView) => string }[] = [
  {
    key: "claims",
    label: "Claims and decisions",
    detail: (view) =>
      `${String(view.claims_worked)} back to waiting${view.customer_claims ? `, ${String(view.customer_claims)} test claims removed` : ""}`,
  },
  {
    key: "evaluations",
    label: "Evaluations",
    detail: (view) =>
      `${String(view.evaluation_runs)} runs; the Scoreboard stays empty until the next`,
  },
  {
    key: "red_team",
    label: "Red-team results",
    detail: (view) => `${String(view.red_team_runs)} runs`,
  },
  {
    key: "agent_off",
    label: "Agent off",
    detail: (view) => (view.agent_on ? "On now; turned off first" : "Already off"),
  },
  {
    key: "payouts_off",
    label: "Payouts off",
    detail: (view) => (view.payouts_paused ? "Already paused" : "Live now; paused"),
  },
];

/** A senior handler's reset of the demo, ticking what to clear. Shown only where the api offers
 * it (the demo sign-in). */
export function DemoControls({ api, onReset }: Props) {
  const ids = useId();
  const [view, setView] = useState<ResetView | null>(null);
  const [ticked, setTicked] = useState<ResetRequest>({
    claims: true,
    evaluations: false,
    red_team: false,
    agent_off: true,
    payouts_off: true,
  });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let live = true;
    api.getReset().then(
      (found) => {
        if (live) setView(found);
      },
      () => {
        // Not the demo: no reset here.
      },
    );
    return () => {
      live = false;
    };
  }, [api, generation]);

  if (!view) return null;
  const any = Object.values(ticked).some(Boolean);
  // The agent being on stops a reset of the claims only if this reset won't turn it off.
  const claimsBlocked =
    view.blocked && !(ticked.agent_off && view.blocked.startsWith("turn the agent off"))
      ? view.blocked
      : null;
  const reason =
    (ticked.claims && claimsBlocked) ||
    (ticked.evaluations && view.evaluations_blocked) ||
    (ticked.red_team && view.red_team_blocked) ||
    null;
  return (
    <section className="panel demo-controls" aria-labelledby={`${ids}-title`}>
      <div className="panel-head">
        <h2 id={`${ids}-title`}>Reset the demo</h2>
        <span className="muted small">Back to a clean start.</span>
      </div>
      <fieldset className="reset" disabled={busy}>
        <legend className="visually-hidden">What to reset</legend>
        {TICKS.map((tick) => (
          <label key={tick.key} className="tick">
            <input
              type="checkbox"
              checked={ticked[tick.key]}
              onChange={(event) => {
                setConfirming(false);
                setDone(false);
                setTicked({ ...ticked, [tick.key]: event.target.checked });
              }}
            />
            <span>
              {tick.label}
              <small className="muted">{tick.detail(view)}</small>
            </span>
          </label>
        ))}
        {reason && (
          <p className="muted small" role="status">
            Not now: {reason}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {done && (
          <p className="chip chip-good" role="status">
            Reset. The demo starts fresh.
          </p>
        )}
        {confirming ? (
          <div className="action-row">
            <button
              type="button"
              className="button"
              onClick={() => {
                setBusy(true);
                setError(null);
                api.reset(ticked).then(
                  (after) => {
                    setBusy(false);
                    setConfirming(false);
                    setDone(true);
                    setView(after);
                    onReset();
                  },
                  (caught: unknown) => {
                    setBusy(false);
                    setError(caught instanceof Error ? caught.message : String(caught));
                    setGeneration((n) => n + 1);
                    onReset();
                  },
                );
              }}
            >
              {busy ? "Resetting…" : "Yes, reset"}
            </button>
            <button
              type="button"
              className="popover-cancel"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </button>
            <span className="muted small">This can&apos;t be undone.</span>
          </div>
        ) : (
          <button
            type="button"
            className="button secondary"
            disabled={!any || reason !== null}
            onClick={() => {
              setConfirming(true);
              setDone(false);
            }}
          >
            <RotateCcw size={15} strokeWidth={1.75} aria-hidden="true" />
            Reset the demo
          </button>
        )}
      </fieldset>
    </section>
  );
}
