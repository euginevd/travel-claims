import { CircleAlert } from "lucide-react";
import type { Claim } from "../api";
import { dollars } from "../format";

/** What the claim needs from a handler, or null when it needs nothing. */
export function needsYou(claim: Claim): string | null {
  const decision = claim.decision;
  if (claim.status === "waiting_for_sign_off" && decision) {
    return `Waiting for your sign-off: ${dollars(decision.payout)} is over the ${dollars(
      claim.approval_limit,
    )} limit.`;
  }
  if (claim.review_requested_at && !decision?.override) {
    return "The customer asked for a person to review this decision.";
  }
  const settled = claim.status === "decided" || claim.status === "left_for_handler";
  if (settled && decision?.decision === "refer" && !decision.override) {
    return decision.by_screening
      ? "Referred to you: the claim contains text that tries to instruct whoever assesses it."
      : `Referred to you: ${decision.reason}`;
  }
  return null;
}

export function NeedsYouBanner({ claim }: { claim: Claim }) {
  const message = needsYou(claim);
  if (!message) return null;
  return (
    <p className="needs-you" role="status">
      <CircleAlert size={18} strokeWidth={2} aria-hidden="true" />
      <span>
        {message}
        {claim.review_note && claim.review_requested_at && (
          <span className="muted"> They said: &ldquo;{claim.review_note}&rdquo;</span>
        )}
      </span>
    </p>
  );
}
