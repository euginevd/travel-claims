import { useEffect, useState } from "react";

export type Route =
  | { page: "queue" }
  | { page: "redteam" }
  | { page: "claim"; claimId: string }
  | { page: "scoreboard" }
  | { page: "run"; runId: number }
  | { page: "improvement" };

const CLAIM_PATH = /^#\/claims\/([^/]+)$/;
const RUN_PATH = /^#\/runs\/(\d+)$/;

export const REDTEAM_HREF = "#/redteam";

export function parseHash(hash: string): Route {
  if (hash === REDTEAM_HREF) return { page: "redteam" };
  const match = CLAIM_PATH.exec(hash);
  if (match?.[1]) return { page: "claim", claimId: decodeURIComponent(match[1]) };
  const run = RUN_PATH.exec(hash);
  if (run?.[1]) return { page: "run", runId: Number(run[1]) };
  if (hash === SCOREBOARD_HREF) return { page: "scoreboard" };
  if (hash === IMPROVEMENT_HREF) return { page: "improvement" };
  return { page: "queue" };
}

export const SCOREBOARD_HREF = "#/scoreboard";
export const IMPROVEMENT_HREF = "#/improvement";

export function runHref(runId: number): string {
  return `#/runs/${String(runId)}`;
}

export function claimHref(claimId: string): string {
  return `#/claims/${encodeURIComponent(claimId)}`;
}

export const QUEUE_HREF = "#/";

export function useHashRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash));
    };
    window.addEventListener("hashchange", onChange);
    return () => {
      window.removeEventListener("hashchange", onChange);
    };
  }, []);
  return route;
}
