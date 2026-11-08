import { Check } from "lucide-react";
import type { CustomerStatus } from "../api";

export type StepState = "done" | "current" | "upcoming";

export interface Step {
  label: string;
  state: StepState;
}

function steps(labels: string[], current: number): Step[] {
  return labels.map((label, index) => ({
    label,
    state: index < current ? "done" : index === current ? "current" : "upcoming",
  }));
}

/** Where a claim is, as the customer sees it: what's done, what's happening now and what's next. */
export function stepsFor(status: CustomerStatus): Step[] {
  switch (status) {
    case "received":
    case "assessing":
      return steps(["Received", "Assessing", "Decision", "Paid"], 1);
    case "reviewing":
      return steps(["Received", "Assessing", "Final check", "Decision", "Paid"], 2);
    case "with_a_handler":
      // A person has it, so there's no payment to promise yet.
      return steps(["Received", "Assessing", "With a person", "Decision"], 2);
    case "approved":
      return steps(["Received", "Assessing", "Decision", "Paid"], 3);
    case "paid":
      return steps(["Received", "Assessing", "Decision", "Paid"], 4);
    case "declined":
      // Declined claims stop at the decision; there's nothing to pay.
      return steps(["Received", "Assessing", "Decision"], 3);
  }
}

export function ClaimTracker({ status, mini = false }: { status: CustomerStatus; mini?: boolean }) {
  return (
    <ol className={`tracker${mini ? " tracker-mini" : ""}`} aria-label="Where your claim is">
      {stepsFor(status).map(({ label, state }) => (
        <li
          key={label}
          className={`tracker-stage${state === "done" ? " done" : ""}${state === "current" ? " active" : ""}`}
          aria-current={state === "current" ? "step" : undefined}
        >
          <span className="tracker-dot" aria-hidden="true">
            {state === "done" && <Check size={mini ? 13 : 16} strokeWidth={3} />}
          </span>
          <span className="tracker-label">
            {label}
            {state === "current" && <span className="visually-hidden"> (now)</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
