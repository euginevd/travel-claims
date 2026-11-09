import { useEffect, useState } from "react";

export type Route = { page: "queue" } | { page: "claim"; claimId: string };

const CLAIM_PATH = /^#\/claims\/([^/]+)$/;

export function parseHash(hash: string): Route {
  const match = CLAIM_PATH.exec(hash);
  if (match?.[1]) return { page: "claim", claimId: decodeURIComponent(match[1]) };
  return { page: "queue" };
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
