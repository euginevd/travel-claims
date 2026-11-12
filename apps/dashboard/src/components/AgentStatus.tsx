import { ShieldAlert, ShieldCheck, Sparkle } from "lucide-react";
import type { Step } from "../api";
import { plainStep } from "../format";

/** What the hidden-instruction check found, from its own step: nothing, something, or (when
 * the check hasn't run) null. */
export function screeningOf(steps: Step[]): "clear" | "found" | null {
  const check = steps.find((step) => step.kind === "screening");
  if (!check) return null;
  return check.content.startsWith("Instructions found") ? "found" : "clear";
}

/** The hidden-instruction check's result, as one small note. */
export function ScreeningNote({ steps }: { steps: Step[] }) {
  const screening = screeningOf(steps);
  if (screening === null) return null;
  return (
    <p className="screening-note">
      {screening === "clear" ? (
        <span className="chip chip-good">
          <ShieldCheck size={13} strokeWidth={1.75} aria-hidden="true" />
          Screened first: no hidden instructions
        </span>
      ) : (
        <span className="chip chip-bad">
          <ShieldAlert size={13} strokeWidth={1.75} aria-hidden="true" />
          Screened first: hidden instructions found
        </span>
      )}
    </p>
  );
}

/** Before there's a decision: one line on what the agent is doing, its latest step in plain
 * words. The step-by-step trace is the AI assurance console's, not the handler's. */
export function AgentStatus({ steps, working }: { steps: Step[]; working: boolean }) {
  const latest = steps
    .map((step) => plainStep(step.kind, step.content))
    .filter((text): text is string => text !== null)
    .at(-1);
  return (
    <section className="panel agent-status" aria-label="What the agent is doing" aria-live="polite">
      <p className="ai-line">
        <Sparkle size={16} strokeWidth={1.75} aria-hidden="true" />
        {working ? "The agent is working…" : "The agent's last step"}
      </p>
      {latest && <p className="agent-status-step">{latest}</p>}
      <ScreeningNote steps={steps} />
    </section>
  );
}
