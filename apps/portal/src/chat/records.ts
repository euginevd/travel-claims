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
  /** Their PayID as the api shows it (masked), or null when there's none. */
  payid: string | null;
}

const EMPTY: Records = {
  policies: [],
  claims: [],
  cover: [],
  delays: [],
  draft: null,
  notices: [],
  payid: null,
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
      quietly(api.myPayId(), null),
    ]).then(([policies, claims, cover, delays, draft, notices, payid]) => {
      if (!live) return;
      setRecords({ policies, claims, cover, delays, draft, notices, payid });
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
