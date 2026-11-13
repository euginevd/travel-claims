import { useCallback, useEffect, useState } from "react";
import type { Api, Handler, PayoutSwitch } from "../api";
import { ReasonCard } from "./ReasonCard";

// How often the header asks again: another senior handler may pause payouts at any time.
export const PAYOUTS_POLL_MS = 15000;

/** The payouts switch as the api reports it, followed while a person is signed in. */
export function usePayouts(api: Api, enabled: boolean, pollMs = PAYOUTS_POLL_MS) {
  const [state, setState] = useState<PayoutSwitch | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let timer: number | undefined;
    const load = () => {
      api
        .getPayouts()
        .then(
          (value) => {
            if (live) setState(value);
          },
          () => {
            // The status is advisory; the api refuses payments whatever the page shows.
          },
        )
        .finally(() => {
          if (live) timer = window.setTimeout(load, pollMs);
        });
    };
    load();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [api, enabled, pollMs]);
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
  // What the handler asked for when the card opened: pause (true) or resume. The status keeps
  // polling under the open card, so the card never reads it: another senior handler pausing
  // first would turn "Pause all payouts" into "Resume" under a reason written for pausing.
  const [target, setTarget] = useState<boolean | null>(null);
  if (editing && target === null && state) setTarget(!state.paused);
  if (!editing && target !== null) setTarget(null);
  const done = editing && target !== null && state?.paused === target;
  useEffect(() => {
    // Someone else already made the change: nothing left to confirm.
    if (done) onEditing(false);
  }, [done, onEditing]);
  if (!state) return null;
  const senior = handler.can_approve_over_limit;
  if (!state.paused && !senior) return null;
  const pause = target ?? !state.paused;

  const form = editing && !done && (
    <ReasonCard
      title={pause ? "Pause all payouts?" : "Resume payouts?"}
      detail={
        pause
          ? "The agent keeps deciding, but nothing is paid until payouts are back on."
          : "Held approvals can then be signed off and paid."
      }
      example={pause ? "e.g. Checking a run of odd approvals" : "e.g. Checks done, safe to pay"}
      confirm={pause ? "Pause all payouts" : "Resume payouts"}
      failed="Couldn't change payouts. Try again."
      onConfirm={async (reason) => {
        onState(await api.setPayouts(pause, reason));
        close();
      }}
      onClose={close}
    />
  );

  return form || null;
}
