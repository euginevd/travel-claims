import { useCallback, useEffect, useState } from "react";
import { ReasonCard } from "./ReasonCard";
import type { AgentSwitch, Api } from "../api";

// While the agent is on, the header and Today follow it every few seconds; while it's off, or
// after a failed read, less often, so another handler's change or the budget's still shows.
export const AGENT_POLL_MS = 4000;
const IDLE_POLLS = 4;

/** The agent switch as the api reports it, followed while someone is signed in. */
export function useAgent(api: Api, enabled: boolean, pollMs = AGENT_POLL_MS) {
  const [state, setState] = useState<AgentSwitch | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => {
    setTick((n) => n + 1);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let timer: number | undefined;
    const load = () => {
      api.getAgent().then(
        (value) => {
          if (!live) return;
          setState(value);
          const busy = value.on || value.working > 0;
          timer = window.setTimeout(load, busy ? pollMs : pollMs * IDLE_POLLS);
        },
        () => {
          // Advisory: the api decides what the agent may do whatever the page shows. One failed
          // read mustn't freeze the status, so it's asked again.
          if (live) timer = window.setTimeout(load, pollMs * IDLE_POLLS);
        },
      );
    };
    load();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [api, enabled, pollMs, tick]);
  return { state, setState, refresh };
}

interface AgentToggleProps {
  api: Api;
  state: AgentSwitch | null;
  senior: boolean;
  onState: (state: AgentSwitch) => void;
  editing: boolean;
  onEditing: (editing: boolean) => void;
}

/** The agent on or off for the live queue: a senior handler's switch, everyone else's status. */
export function AgentToggle({ api, state, senior, onState, editing, onEditing }: AgentToggleProps) {
  // What the handler asked for when the card opened. The status keeps polling under the open
  // card, so the card never reads "on or off" from it: a change by someone else would turn
  // "Turn the agent off" into "on" under the handler's reason.
  const [target, setTarget] = useState<boolean | null>(null);
  const close = useCallback(() => {
    setTarget(null);
    onEditing(false);
  }, [onEditing]);
  const done = editing && target !== null && state?.on === target;
  useEffect(() => {
    // Someone else, or the daily budget, already made the change: nothing left to confirm.
    if (done) onEditing(false);
  }, [done, onEditing]);
  if (!state) return null;
  const turnOn = target ?? !state.on;
  const working = state.working > 0;
  const content = (
    <>
      <span className="status-dot" aria-hidden="true" />
      <span>Agent {state.on ? "on" : "off"}</span>
      <span
        className="agent-switch-count"
        title={`${String(state.working)} claims being worked`}
        aria-label={`, ${String(state.working)} working`}
      >
        {working ? state.working : ""}
      </span>
    </>
  );
  const className = `agent-switch${state.on ? " is-on" : ""}${working ? " is-working" : ""}`;
  if (!senior) {
    return (
      <span className={className} role="status">
        {content}
      </span>
    );
  }
  return (
    <span className="agent-switch-wrap">
      <button
        type="button"
        className={className}
        aria-pressed={state.on}
        aria-label={state.on ? "Agent on. Turn the agent off" : "Agent off. Turn the agent on"}
        onClick={() => {
          setTarget(!state.on);
          onEditing(true);
        }}
      >
        {content}
      </button>
      {editing && !done && (
        <ReasonCard
          title={turnOn ? "Turn the agent on?" : "Turn the agent off?"}
          detail={
            turnOn
              ? "It works every waiting claim, a few at once, and each new one as it comes in. Payouts over the limit still wait for a sign-off."
              : "Claims it's working finish; nothing new starts until it's back on."
          }
          example={turnOn ? "e.g. Starting the demo" : "e.g. Odd decisions on trip delays"}
          confirm={turnOn ? "Turn the agent on" : "Turn the agent off"}
          failed="Couldn't change the agent. Try again."
          onConfirm={async (reason) => {
            onState(await api.setAgent({ on: turnOn, reason }));
            close();
          }}
          onClose={close}
        />
      )}
    </span>
  );
}
