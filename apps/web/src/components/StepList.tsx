import type { Step } from "../api";
import { STEP_LABELS, when } from "../format";

// Tool results can be long JSON, so they open on request; everything else shows in full.
const FOLDED = new Set<Step["kind"]>(["tool_result"]);
const ALERTS = new Set<Step["kind"]>(["refusal", "error"]);

export function StepList({ steps }: { steps: Step[] }) {
  if (steps.length === 0) return <p className="muted">No steps yet.</p>;
  return (
    <ol className="steps">
      {steps.map((step) => (
        <li
          key={step.step_id}
          className={`step step-${step.kind}${ALERTS.has(step.kind) ? " step-alert" : ""}`}
        >
          <div className="step-head">
            <strong>{STEP_LABELS[step.kind]}</strong>
            <time dateTime={step.at} className="muted">
              {when(step.at)}
            </time>
          </div>
          {FOLDED.has(step.kind) ? (
            <details>
              <summary>Show the result</summary>
              <pre>{step.content}</pre>
            </details>
          ) : (
            <p className="step-content">{step.content}</p>
          )}
          {step.sources.length > 0 && (
            <p className="muted small">From {step.sources.map((s) => s.file).join(", ")}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
