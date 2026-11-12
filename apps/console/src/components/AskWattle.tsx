import type { Api } from "../api";
import type { Route } from "../useHashRoute";
import { WattlePanel } from "./Wattle";

/** Questions that fit the console page the engineer is on. */
export function startersFor(route: Route): string[] {
  switch (route.page) {
    case "run":
      return [
        `Summarise run ${String(route.runId)}`,
        `Which claims did run ${String(route.runId)} get wrong?`,
        "How does this run compare with the last one?",
      ];
    case "live":
      return [
        "How often do handlers disagree with the agent on live claims?",
        "What share of live claims went straight through?",
        "What do customers think of the explanations?",
      ];
    case "improvement":
      return ["What changed in the latest round?", "Did the last round pass the red team?"];
    case "redteam":
      return ["Which attack got closest?", "Which risks have no test yet?"];
    case "trace":
      return ["Explain the trace for CLM-1001", "Which step costs the most on CLM-1001?"];
    case "posture":
    case "detections":
      return [
        "Would an attack get past the hidden-instruction check?",
        "Which OWASP risks have no red-team attack?",
        "Which guardrails have fired, and when?",
      ];
    default:
      return [
        "How accurate is the agent right now?",
        "What does a claim cost on average?",
        "Where does the agent disagree with claims experts?",
      ];
  }
}

/** Wattle AI for the AI engineers: read-only answers about quality and security. */
export function AskWattle({
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
      scope="Ask about evaluation runs, improvement rounds, the red team, threat coverage, live monitoring and claim traces. Read-only: it explains, it changes nothing."
      starters={startersFor(route)}
      placeholder="Ask about quality, security or a trace"
      onClose={onClose}
    />
  );
}
