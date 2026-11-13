import { useEffect, useState } from "react";

export type Route =
  | { page: "overview" }
  | { page: "agents" }
  | { page: "audit" }
  | { page: "budgets" }
  | { page: "version"; version: number }
  | { page: "posture" }
  | { page: "detections" }
  | { page: "redteam" }
  | { page: "scoreboard" }
  | { page: "live" }
  | { page: "run"; runId: number }
  | { page: "improvement" }
  | { page: "trace"; claimId?: string };

const RUN_PATH = /^#\/runs\/(\d+)$/;
const VERSION_PATH = /^#\/versions\/(\d+)$/;
const TRACE_PATH = /^#\/trace\/(CLM-\d{1,10})$/i;

export const HOME_HREF = "#/";
export const OVERVIEW_HREF = "#/overview";
export const AGENTS_HREF = "#/agents";
export const AUDIT_HREF = "#/audit";
export const BUDGETS_HREF = "#/budgets";
export const POSTURE_HREF = "#/posture";
export const DETECTIONS_HREF = "#/guardrails";
export const REDTEAM_HREF = "#/redteam";
export const SCOREBOARD_HREF = "#/scoreboard";
export const LIVE_HREF = "#/live";
export const IMPROVEMENT_HREF = "#/versions";
export const TRACE_HREF = "#/trace";
// Old addresses, kept so saved links still open their page: threat coverage is now a part of the
// red team's page.
const OLD_COVERAGE_HREF = "#/coverage";
const OLD_THREATS_HREF = "#/threats";
// Detections is now Guardrails, and Improvement is Versions: the field's own words.
const OLD_DETECTIONS_HREF = "#/detections";
const OLD_IMPROVEMENT_HREF = "#/improvement";

const PAGES: Record<string, Route> = {
  [DETECTIONS_HREF]: { page: "detections" },
  [OLD_DETECTIONS_HREF]: { page: "detections" },
  [OLD_IMPROVEMENT_HREF]: { page: "improvement" },
  [OLD_COVERAGE_HREF]: { page: "redteam" },
  [OLD_THREATS_HREF]: { page: "redteam" },
  [REDTEAM_HREF]: { page: "redteam" },
  [HOME_HREF]: { page: "overview" },
  [OVERVIEW_HREF]: { page: "overview" },
  [AGENTS_HREF]: { page: "agents" },
  [AUDIT_HREF]: { page: "audit" },
  [BUDGETS_HREF]: { page: "budgets" },
  [POSTURE_HREF]: { page: "posture" },
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
  const version = VERSION_PATH.exec(hash);
  if (version?.[1]) return { page: "version", version: Number(version[1]) };
  const trace = TRACE_PATH.exec(hash);
  if (trace?.[1]) return { page: "trace", claimId: trace[1].toUpperCase() };
  return { page: "overview" };
}

export function versionHref(version: number): string {
  return `#/versions/${String(version)}`;
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
