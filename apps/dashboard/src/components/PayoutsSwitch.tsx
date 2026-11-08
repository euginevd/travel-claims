import { CirclePause, CirclePlay, OctagonX } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ApiError, type Api, type Handler, type PayoutSwitch } from "../api";
import { when } from "../format";

interface Props {
  api: Api;
  handler: Handler;
}

/** The payouts kill switch: a banner on every page while payouts are paused, and for a
 * senior handler the control to pause or resume them, with a reason. */
export function PayoutsSwitch({ api, handler }: Props) {
  const [state, setState] = useState<PayoutSwitch | null>(null);
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const reasonId = useId();

  useEffect(() => {
    let live = true;
    api.getPayouts().then(
      (value) => {
        if (live) setState(value);
      },
      () => {
        // The banner is advisory; the api refuses payments whatever the page shows.
      },
    );
    return () => {
      live = false;
    };
  }, [api]);

  if (!state) return null;
  const senior = handler.can_approve_over_limit;
  if (!state.paused && !senior) return null;

  async function change(paused: boolean) {
    if (inFlight.current || !reason.trim()) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      setState(await api.setPayouts(paused, reason.trim()));
      setEditing(false);
      setReason("");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Couldn't change payouts. Try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const form = editing && (
    <form
      className="payouts-form"
      onSubmit={(event) => {
        event.preventDefault();
        void change(!state.paused);
      }}
    >
      <label htmlFor={reasonId}>Reason</label>
      <input
        id={reasonId}
        value={reason}
        maxLength={500}
        required
        disabled={busy}
        onChange={(event) => {
          setReason(event.target.value);
        }}
      />
      <button className="button" type="submit" disabled={busy || !reason.trim()}>
        {state.paused ? "Resume payouts" : "Pause all payouts"}
      </button>
      <button
        className="button secondary"
        type="button"
        onClick={() => {
          setEditing(false);
        }}
      >
        Cancel
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );

  if (!state.paused) {
    return (
      <div className="payouts-on">
        <span>
          <CirclePlay size={16} strokeWidth={2} aria-hidden="true" /> Payouts are on
        </span>
        {!editing && (
          <button
            className="link-button"
            type="button"
            onClick={() => {
              setEditing(true);
            }}
          >
            <CirclePause size={16} strokeWidth={2} aria-hidden="true" /> Pause all payouts
          </button>
        )}
        {form}
      </div>
    );
  }

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
                setEditing(true);
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
