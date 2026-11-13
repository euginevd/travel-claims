import { useCallback, useEffect, useState } from "react";
import type { Api, Handler, PayoutSwitch } from "../api";
import { ReasonCard } from "./ReasonCard";

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
  const content = (
    <>
      <span className="status-dot" aria-hidden="true" />
      <span className="payouts-status-label">{label}</span>
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

/** The payouts kill switch's card: a senior handler pauses or resumes every payment, with a
 * reason. The line saying payouts are paused is the status line's. */
export function PayoutsSwitch({ api, handler, state, onState, editing, onEditing }: Props) {
  const close = useCallback(() => {
    onEditing(false);
  }, [onEditing]);
  if (!state) return null;
  const senior = handler.can_approve_over_limit;
  if (!state.paused && !senior) return null;

  const form = editing && (
    <ReasonCard
      title={state.paused ? "Resume payouts?" : "Pause all payouts?"}
      detail={
        state.paused
          ? "Held approvals can then be signed off and paid."
          : "The agent keeps deciding, but nothing is paid until payouts are back on."
      }
      example={
        state.paused ? "e.g. Checks done, safe to pay" : "e.g. Checking a run of odd approvals"
      }
      confirm={state.paused ? "Resume payouts" : "Pause all payouts"}
      failed="Couldn't change payouts. Try again."
      onConfirm={async (reason) => {
        onState(await api.setPayouts(!state.paused, reason));
        close();
      }}
      onClose={close}
    />
  );

  return form || null;
}
