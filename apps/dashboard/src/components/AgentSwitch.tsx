import { useCallback, useEffect, useState } from "react";
import { ReasonCard } from "./ReasonCard";
import type { AgentSwitch, Api } from "../api";

// While the agent is on, the header and Today follow it every few seconds.
export const AGENT_POLL_MS = 4000;

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
          if (value.on || value.working > 0) timer = window.setTimeout(load, pollMs);
        },
        () => {
          // Advisory: the api decides what the agent may do whatever the page shows.
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
  const close = useCallback(() => {
    onEditing(false);
  }, [onEditing]);
  if (!state) return null;
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
          onEditing(true);
        }}
      >
        {content}
      </button>
      {editing && (
        <ReasonCard
          title={state.on ? "Turn the agent off?" : "Turn the agent on?"}
          detail={
            state.on
              ? "Claims it's working finish; nothing new starts until it's back on."
              : "It works every waiting claim, a few at once, and each new one as it comes in. Payouts over the limit still wait for a sign-off."
          }
          example={state.on ? "e.g. Odd decisions on trip delays" : "e.g. Starting the demo"}
          confirm={state.on ? "Turn the agent off" : "Turn the agent on"}
          failed="Couldn't change the agent. Try again."
          onConfirm={async (reason) => {
            onState(await api.setAgent({ on: !state.on, reason }));
            close();
          }}
          onClose={close}
        />
      )}
    </span>
  );
}
