import type { AgentSwitch, PayoutSwitch } from "../api";
import { when } from "../format";

interface Props {
  agent: AgentSwitch | null;
  payouts: PayoutSwitch | null;
  senior: boolean;
  onTurnOn: () => void;
  onResume: () => void;
}

/** What's switched off, in one quiet line under the top bar: who, when and why, and for a senior
 * handler the way back on. Nothing when the agent and payouts are both on. */
export function StatusLine({ agent, payouts, senior, onTurnOn, onResume }: Props) {
  const agentOff = agent !== null && !agent.on;
  const paused = payouts?.paused === true;
  if (!agentOff && !paused) return null;
  const what =
    agentOff && paused ? "Agent off and payouts paused" : agentOff ? "Agent off" : "Payouts paused";
  // Who, when and why come from whichever was switched last.
  const changes = [agentOff ? agent : null, paused ? payouts : null].filter(
    (change): change is AgentSwitch | PayoutSwitch => change?.changed_at != null,
  );
  const last = changes.sort((a, b) => (b.changed_at ?? "").localeCompare(a.changed_at ?? ""))[0];
  return (
    <div className="status-line" role="status">
      <span className="status-dot" aria-hidden="true" />
      <p>
        <strong>{what}</strong>
        {last && (
          <span className="muted">
            {" "}
            by {last.changed_by ?? "a senior handler"}
            {last.changed_at ? `, ${when(last.changed_at)}` : ""}
            {last.reason ? <> · &ldquo;{last.reason}&rdquo;</> : null}
          </span>
        )}
      </p>
      {senior && agentOff && (
        <button
          type="button"
          className="status-line-action"
          aria-label="Turn the agent on"
          onClick={onTurnOn}
        >
          Turn on
        </button>
      )}
      {senior && paused && (
        <button
          type="button"
          className="status-line-action"
          aria-label="Resume payouts"
          onClick={onResume}
        >
          Resume
        </button>
      )}
    </div>
  );
}
