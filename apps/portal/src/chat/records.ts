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
  /** The parts that couldn't be loaded, so an empty list is never shown as "you have none". */
  failed: Part[];
}

export type Part = "policies" | "claims" | "cover" | "delays" | "draft" | "notices" | "payid";

const EMPTY: Records = {
  policies: [],
  claims: [],
  cover: [],
  delays: [],
  draft: null,
  notices: [],
  payid: null,
  failed: [],
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
    const failed: Part[] = [];
    const quietly = <T>(part: Part, call: Promise<T>, fallback: T) =>
      call.catch(() => {
        failed.push(part);
        return fallback;
      });
    void Promise.all([
      quietly("policies", api.myPolicies(), [] as Policy[]),
      quietly("claims", api.myClaims(), [] as CustomerClaimSummary[]),
      quietly("cover", api.myCover(), [] as Cover[]),
      quietly("delays", api.myDelays(), [] as DelayOffer[]),
      quietly("draft", api.myDraft(), null),
      quietly("notices", api.myNotices(), [] as Notice[]),
      quietly("payid", api.myPayId(), null),
    ]).then(([policies, claims, cover, delays, draft, notices, payid]) => {
      if (!live) return;
      setRecords({ policies, claims, cover, delays, draft, notices, payid, failed });
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
