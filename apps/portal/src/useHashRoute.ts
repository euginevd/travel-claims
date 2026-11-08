import { useEffect, useState } from "react";

export type Route =
  | { page: "my-claims" }
  | { page: "my-claim"; claimId: string }
  | { page: "new-claim" }
  | { page: "updates" };

const CLAIM_PATH = /^#\/claims\/([^/]+)$/;

export const MY_CLAIMS_HREF = "#/";
export const NEW_CLAIM_HREF = "#/new";
export const UPDATES_HREF = "#/updates";

export function parseHash(hash: string): Route {
  const match = CLAIM_PATH.exec(hash);
  if (match?.[1]) return { page: "my-claim", claimId: decodeURIComponent(match[1]) };
  if (hash === NEW_CLAIM_HREF) return { page: "new-claim" };
  if (hash === UPDATES_HREF) return { page: "updates" };
  return { page: "my-claims" };
}

export function myClaimHref(claimId: string): string {
  return `#/claims/${encodeURIComponent(claimId)}`;
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

/** Go to a page of the portal. */
export function goTo(href: string): void {
  window.location.hash = href;
}
