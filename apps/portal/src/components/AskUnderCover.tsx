import type { Api } from "../api";
import { MY_CLAIMS_HREF, NEW_CLAIM_HREF, type Route } from "../useHashRoute";
import { WattlePanel } from "./Wattle";

/** Questions that fit the page the customer is on. */
export function startersFor(route: Route): string[] {
  switch (route.page) {
    case "my-claim":
      return [
        `What's holding up ${route.claimId}?`,
        `What happens next with ${route.claimId}?`,
        "What counts as proof for my claim?",
      ];
    case "new-claim":
      return [
        "What can I claim for?",
        "What proof do I need for a delay?",
        "How long does a decision take?",
      ];
    case "updates":
      return ["What does my latest update mean?", "When will I be paid?"];
    default:
      return [
        "Am I covered if my flight is delayed?",
        "What's my excess?",
        "Where is my latest claim up to?",
      ];
  }
}

/** Wattle AI for customers: questions about their own policy and claims, answered from their
 * policy wording and records. It explains and cites, and never promises cover or payment. */
export function AskUnderCover({
  api,
  route,
  onClose,
}: {
  api: Api;
  route: Route;
  onClose: () => void;
}) {
  return (
    <WattlePanel
      ask={(question, history) => api.ask(question, history)}
      scope="Ask about your policy and your claims. Answers come from your policy wording and your own records. Only a decision on a claim can say what is paid."
      starters={startersFor(route)}
      placeholder="Ask about your policy or claims"
      onClose={onClose}
      extra={(answer) =>
        answer.suggest === "start_claim" ? (
          <a className="button small-button wattle-next" href={NEW_CLAIM_HREF}>
            Start a claim
          </a>
        ) : answer.suggest === "ask_person" ? (
          <a className="button secondary small-button wattle-next" href={MY_CLAIMS_HREF}>
            Ask a person from your claim
          </a>
        ) : null
      }
    />
  );
}
