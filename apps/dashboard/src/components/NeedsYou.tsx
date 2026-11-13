import type { Claim } from "../api";
import { dollars } from "../format";

// The hold reason the api gives an approval while payouts are paused.
const PAUSED = "Payouts are paused";

/** What the claim needs from a handler, or null when it needs nothing. */
export function needsYou(claim: Claim): string | null {
  const decision = claim.decision;
  if (claim.status === "waiting_for_sign_off" && decision?.hold_reason?.startsWith(PAUSED)) {
    return `Held: payouts are paused. Sign off ${dollars(decision.payout)} once they're back on.`;
  }
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
      : "Referred to you: the agent couldn't decide this one alone. Its reason is in the recommendation.";
  }
  return null;
}
