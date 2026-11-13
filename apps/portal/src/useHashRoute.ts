import { useEffect, useState } from "react";

// The portal is one screen; a link only opens the side panel at the right place, so the links
// in our emails and texts (#/claims/CLM-1001) still land somewhere useful.
export type Route =
  | { page: "home" }
  | { page: "new-claim" }
  | { page: "claims"; claimId?: string }
  | { page: "messages" }
  | { page: "settings" };

const CLAIM_PATH = /^#\/claims\/([^/]+)$/;

export const HOME_HREF = "#/";

export function parseHash(hash: string): Route {
  const match = CLAIM_PATH.exec(hash);
  if (match?.[1]) return { page: "claims", claimId: decodeURIComponent(match[1]) };
  if (hash === "#/claims") return { page: "claims" };
  if (hash === "#/new") return { page: "new-claim" };
  if (hash === "#/messages" || hash === "#/updates") return { page: "messages" };
  if (hash === "#/settings") return { page: "settings" };
  return { page: "home" };
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
