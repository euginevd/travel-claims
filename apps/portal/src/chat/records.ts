// The signed-in customer's records, loaded once for the whole portal and refreshed after a change.
import { useCallback, useEffect, useState } from "react";
import type {
  Api,
  Cover,
  CustomerClaimSummary,
  DelayOffer,
  Notice,
  Policy,
  SavedDraft,
} from "../api";

export interface Records {
  policies: Policy[];
  claims: CustomerClaimSummary[];
  cover: Cover[];
  delays: DelayOffer[];
  draft: SavedDraft | null;
  notices: Notice[];
}

const EMPTY: Records = {
  policies: [],
  claims: [],
  cover: [],
  delays: [],
  draft: null,
  notices: [],
};

/** Each part loads on its own: one that fails leaves the rest of the portal working. */
export function useRecords(api: Api): {
  records: Records;
  loaded: boolean;
  refresh: () => void;
} {
  const [records, setRecords] = useState<Records>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let live = true;
    const quietly = <T>(call: Promise<T>, fallback: T) => call.catch(() => fallback);
    void Promise.all([
      quietly(api.myPolicies(), [] as Policy[]),
      quietly(api.myClaims(), [] as CustomerClaimSummary[]),
      quietly(api.myCover(), [] as Cover[]),
      quietly(api.myDelays(), [] as DelayOffer[]),
      quietly(api.myDraft(), null),
      quietly(api.myNotices(), [] as Notice[]),
    ]).then(([policies, claims, cover, delays, draft, notices]) => {
      if (!live) return;
      setRecords({ policies, claims, cover, delays, draft, notices });
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [api, generation]);

  const refresh = useCallback(() => {
    setGeneration((value) => value + 1);
  }, []);
  return { records, loaded, refresh };
}
