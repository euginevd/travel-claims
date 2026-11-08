import { Check } from "lucide-react";
import type { CustomerStatus } from "../api";

const STAGES = ["Received", "Assessing", "Decision", "Paid"] as const;

/** How far a claim has got, as the customer sees it: the stage it's reached, ticked. */
export function stageOf(status: CustomerStatus): number {
  switch (status) {
    case "received":
      return 0;
    case "assessing":
    case "reviewing":
      return 1;
    case "approved":
    case "declined":
    case "with_a_handler":
      return 2;
    case "paid":
      return 3;
  }
}

export function ClaimTracker({ status }: { status: CustomerStatus }) {
  const reached = stageOf(status);
  // A declined claim or one with a person stops at the decision; there's nothing to pay.
  const stages = status === "declined" || status === "with_a_handler" ? STAGES.slice(0, 3) : STAGES;
  return (
    <ol className="tracker" aria-label="Where your claim is">
      {stages.map((label, index) => {
        const done = index <= reached;
        const active = index === reached + 1 && (status === "received" || status === "assessing");
        return (
          <li
            key={label}
            className={`tracker-stage${done ? " done" : ""}${active ? " active" : ""}`}
            aria-current={index === reached ? "step" : undefined}
          >
            <span className="tracker-dot" aria-hidden="true">
              {done && <Check size={12} strokeWidth={3} />}
            </span>
            <span className="tracker-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
