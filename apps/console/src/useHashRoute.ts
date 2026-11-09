import { useEffect, useState } from "react";

export type Route =
  | { page: "scoreboard" }
  | { page: "run"; runId: number }
  | { page: "improvement" }
  | { page: "redteam" }
  | { page: "trace" }
  | { page: "threats" };

const RUN_PATH = /^#\/runs\/(\d+)$/;

export const SCOREBOARD_HREF = "#/";
export const IMPROVEMENT_HREF = "#/improvement";
export const REDTEAM_HREF = "#/redteam";
export const TRACE_HREF = "#/trace";
export const THREATS_HREF = "#/threats";

export function parseHash(hash: string): Route {
  if (hash === REDTEAM_HREF) return { page: "redteam" };
  if (hash === IMPROVEMENT_HREF) return { page: "improvement" };
  if (hash === TRACE_HREF) return { page: "trace" };
  if (hash === THREATS_HREF) return { page: "threats" };
  const run = RUN_PATH.exec(hash);
  if (run?.[1]) return { page: "run", runId: Number(run[1]) };
  return { page: "scoreboard" };
}

export function runHref(runId: number): string {
  return `#/runs/${String(runId)}`;
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
