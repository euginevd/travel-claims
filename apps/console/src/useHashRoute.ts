import { useEffect, useState } from "react";

export type Route =
  | { page: "posture" }
  | { page: "detections" }
  | { page: "coverage" }
  | { page: "redteam" }
  | { page: "agents" }
  | { page: "scoreboard" }
  | { page: "live" }
  | { page: "run"; runId: number }
  | { page: "improvement" }
  | { page: "trace"; claimId?: string };

const RUN_PATH = /^#\/runs\/(\d+)$/;
const TRACE_PATH = /^#\/trace\/(CLM-\d{1,10})$/i;

export const POSTURE_HREF = "#/";
export const DETECTIONS_HREF = "#/detections";
export const COVERAGE_HREF = "#/coverage";
export const REDTEAM_HREF = "#/redteam";
export const AGENTS_HREF = "#/agents";
export const SCOREBOARD_HREF = "#/scoreboard";
export const LIVE_HREF = "#/live";
export const IMPROVEMENT_HREF = "#/improvement";
export const TRACE_HREF = "#/trace";
// Threat coverage's old address, kept so saved links still open it.
const OLD_THREATS_HREF = "#/threats";

const PAGES: Record<string, Route> = {
  [DETECTIONS_HREF]: { page: "detections" },
  [COVERAGE_HREF]: { page: "coverage" },
  [OLD_THREATS_HREF]: { page: "coverage" },
  [REDTEAM_HREF]: { page: "redteam" },
  [AGENTS_HREF]: { page: "agents" },
  [SCOREBOARD_HREF]: { page: "scoreboard" },
  [LIVE_HREF]: { page: "live" },
  [IMPROVEMENT_HREF]: { page: "improvement" },
  [TRACE_HREF]: { page: "trace" },
};

export function parseHash(hash: string): Route {
  const found = PAGES[hash];
  if (found) return found;
  const run = RUN_PATH.exec(hash);
  if (run?.[1]) return { page: "run", runId: Number(run[1]) };
  const trace = TRACE_PATH.exec(hash);
  if (trace?.[1]) return { page: "trace", claimId: trace[1].toUpperCase() };
  return { page: "posture" };
}

export function runHref(runId: number): string {
  return `#/runs/${String(runId)}`;
}

/** The address that opens a claim's trace straight away. */
export function traceHref(claimId: string): string {
  return `${TRACE_HREF}/${encodeURIComponent(claimId)}`;
}

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
