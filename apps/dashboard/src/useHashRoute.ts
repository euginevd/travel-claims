import { useEffect, useState } from "react";

export type Route = { page: "queue" } | { page: "redteam" } | { page: "claim"; claimId: string };

const CLAIM_PATH = /^#\/claims\/([^/]+)$/;

export const REDTEAM_HREF = "#/redteam";

export function parseHash(hash: string): Route {
  if (hash === REDTEAM_HREF) return { page: "redteam" };
  const match = CLAIM_PATH.exec(hash);
  return match?.[1] ? { page: "claim", claimId: decodeURIComponent(match[1]) } : { page: "queue" };
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
