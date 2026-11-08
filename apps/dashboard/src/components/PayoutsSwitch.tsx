import { Check, CirclePlay, OctagonX, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ApiError, type Api, type Handler, type PayoutSwitch } from "../api";
import { when } from "../format";

// Reasons a senior handler picks from, so the audit log reads consistently. "Other" needs a note.
export const PAUSE_REASONS = [
  "Suspected attack or fraud",
  "Agent behaving unexpectedly",
  "Payment provider problem",
  "Investigating an incident",
  "Planned maintenance",
  "Other",
] as const;
export const RESUME_REASONS = [
  "Issue resolved",
  "Checks complete, safe to pay",
  "Paused by mistake",
  "Other",
] as const;

/** The reason recorded in the audit log: the chosen reason, with the note when there is one. */
export function reasonText(choice: string, note: string): string {
  const extra = note.trim();
  if (choice === "Other") return extra;
  return extra ? `${choice}: ${extra}` : choice;
}

/** The payouts switch as the api reports it, loaded once a person is signed in. */
export function usePayouts(api: Api, enabled: boolean) {
  const [state, setState] = useState<PayoutSwitch | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    api.getPayouts().then(
      (value) => {
        if (live) setState(value);
      },
      () => {
        // The status is advisory; the api refuses payments whatever the page shows.
      },
    );
    return () => {
      live = false;
    };
  }, [api, enabled]);
  return { state, setState };
}

interface StatusProps {
  state: PayoutSwitch | null;
  senior: boolean;
  onOpen: () => void;
}

/** The bold status in the header: live or paused, and for a senior the way to change it. */
export function PayoutsStatus({ state, senior, onOpen }: StatusProps) {
  if (!state) return null;
  const paused = state.paused;
  const label = paused ? "Payouts paused" : "Payouts live";
  const Icon = paused ? OctagonX : CirclePlay;
  const content = (
    <>
      <span className="payouts-status-dot" aria-hidden="true" />
      <Icon size={16} strokeWidth={2.4} aria-hidden="true" />
      {label}
    </>
  );
  const className = `payouts-status${paused ? " is-paused" : " is-live"}`;
  if (!senior) {
    return (
      <span className={className} role="status">
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={className}
      onClick={onOpen}
      aria-label={paused ? "Payouts paused. Resume payouts" : "Payouts live. Pause all payouts"}
      title={paused ? "Resume payouts" : "Pause all payouts"}
    >
      {content}
    </button>
  );
}

interface Props {
  api: Api;
  handler: Handler;
  state: PayoutSwitch | null;
  onState: (state: PayoutSwitch) => void;
  editing: boolean;
  onEditing: (editing: boolean) => void;
}

/** The payouts kill switch: a banner on every page while payouts are paused, and for a
 * senior handler the control to pause or resume them, with a reason. */
export function PayoutsSwitch({ api, handler, state, onState, editing, onEditing }: Props) {
  const [choice, setChoice] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const ids = useId();

  // Escape closes the popover, wherever focus is inside it.
  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onEditing(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [editing, onEditing]);

  if (!state) return null;
  const senior = handler.can_approve_over_limit;
  if (!state.paused && !senior) return null;

  const reason = reasonText(choice, note);
  const ready = choice !== "" && reason !== "";
  const reasons = state.paused ? RESUME_REASONS : PAUSE_REASONS;

  function close() {
    onEditing(false);
    setChoice("");
    setNote("");
    setError(null);
  }

  async function change(paused: boolean) {
    if (inFlight.current || !ready) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      onState(await api.setPayouts(paused, reason));
      close();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Couldn't change payouts. Try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const form = editing && (
    <form
      className="payouts-popover"
      role="dialog"
      aria-labelledby={`${ids}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        void change(!state.paused);
      }}
    >
      <div className="payouts-popover-head">
        <h2 id={`${ids}-title`} className="payouts-panel-title">
          {state.paused ? "Resume payouts?" : "Pause all payouts?"}
        </h2>
        <button type="button" className="popover-close" aria-label="Close" onClick={close}>
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      <p className="muted small">
        {state.paused
          ? "Held approvals can then be signed off and paid."
          : "The agent keeps deciding, but nothing is paid until payouts are back on."}
      </p>
      <fieldset className="reason-options" disabled={busy}>
        <legend>Why?</legend>
        {reasons.map((option) => (
          <label key={option} className={`reason-option${choice === option ? " chosen" : ""}`}>
            <input
              type="radio"
              className="visually-hidden"
              name={`${ids}-reason`}
              value={option}
              checked={choice === option}
              onChange={() => {
                setChoice(option);
              }}
            />
            {choice === option && <Check size={14} strokeWidth={2.6} aria-hidden="true" />}
            {option}
          </label>
        ))}
      </fieldset>
      <label htmlFor={`${ids}-note`}>
        {choice === "Other" ? "Tell us why" : "Add a note (optional)"}
      </label>
      <input
        id={`${ids}-note`}
        value={note}
        maxLength={300}
        required={choice === "Other"}
        disabled={busy}
        onChange={(event) => {
          setNote(event.target.value);
        }}
      />
      <div className="actions popover-actions">
        <button className="button secondary small-button" type="button" onClick={close}>
          Cancel
        </button>
        <button
          className={`button small-button${state.paused ? "" : " danger"}`}
          type="submit"
          disabled={busy || !ready}
        >
          {state.paused ? "Resume payouts" : "Pause all payouts"}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );

  if (!state.paused) return form || null;

  return (
    <div className="payouts-paused" role="status">
      <OctagonX size={20} strokeWidth={2} aria-hidden="true" />
      <div>
        <strong>Payouts are paused.</strong> The agent keeps deciding; every approval waits for a
        sign-off once payouts are back on.
        {state.reason && (
          <span className="muted">
            {" "}
            {state.changed_by ?? "A senior handler"}
            {state.changed_at ? `, ${when(state.changed_at)}` : ""}: &ldquo;{state.reason}
            &rdquo;
          </span>
        )}
        {senior && !editing && (
          <div>
            <button
              className="button"
              type="button"
              onClick={() => {
                onEditing(true);
              }}
            >
              <CirclePlay size={16} strokeWidth={2} aria-hidden="true" /> Resume payouts
            </button>
          </div>
        )}
        {form}
      </div>
    </div>
  );
}
