import { Check } from "lucide-react";
import type { Claim } from "../api";
import { date, when } from "../format";

const STAGES = [
  { key: "received", label: "Received" },
  { key: "checked", label: "Checked" },
  { key: "assessed", label: "Assessed" },
  { key: "decided", label: "Decided" },
  { key: "paid", label: "Paid" },
] as const;

/** Where the claim has got to, like a delivery tracker: each stage ticks with its time, and the
 * next one pulses while the agent works. */
export function StageTracker({ claim }: { claim: Claim }) {
  const working = claim.status === "in_progress";
  const reached = STAGES.map((stage) => claim.stages[stage.key]);
  // A stage passed without its own time (checked, on a claim decided straight away) still ticks.
  const last = reached.findLastIndex((at) => at !== null);
  const current = reached.findIndex((at, index) => at === null && index > last);
  return (
    <ol className="tracker" aria-label="Where this claim is">
      {STAGES.map((stage, index) => {
        const at = reached[index] ?? null;
        const done = at !== null || index < last;
        const active = working && index === current;
        const label = stage.key === "received" && at ? date(at) : at ? when(at) : "";
        return (
          <li
            key={stage.key}
            className={`tracker-stage${done ? " done" : ""}${active ? " active" : ""}`}
            aria-current={active ? "step" : undefined}
          >
            <span className="tracker-dot" aria-hidden="true">
              {done && <Check size={11} strokeWidth={1.75} nonScalingStroke />}
            </span>
            <span className="tracker-label">{stage.label}</span>
            <span className="tracker-time muted small">
              {done ? label : active ? "In progress" : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
