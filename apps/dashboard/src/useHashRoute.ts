import { useEffect, useState } from "react";

export type Route =
  | { page: "queue" }
  | { page: "claim"; claimId: string }
  | { page: "my-claims" }
  | { page: "my-claim"; claimId: string }
  | { page: "new-claim" };

const CLAIM_PATH = /^#\/claims\/([^/]+)$/;
const MY_CLAIM_PATH = /^#\/my\/claims\/([^/]+)$/;

export function parseHash(hash: string): Route {
  const mine = MY_CLAIM_PATH.exec(hash);
  if (mine?.[1]) return { page: "my-claim", claimId: decodeURIComponent(mine[1]) };
  if (hash === NEW_CLAIM_HREF) return { page: "new-claim" };
  if (hash === MY_CLAIMS_HREF) return { page: "my-claims" };
  const match = CLAIM_PATH.exec(hash);
  return match?.[1] ? { page: "claim", claimId: decodeURIComponent(match[1]) } : { page: "queue" };
}

export function claimHref(claimId: string): string {
  return `#/claims/${encodeURIComponent(claimId)}`;
}

export function myClaimHref(claimId: string): string {
  return `#/my/claims/${encodeURIComponent(claimId)}`;
}

export const QUEUE_HREF = "#/";
export const MY_CLAIMS_HREF = "#/my";
export const NEW_CLAIM_HREF = "#/my/new";

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
