import { useMemo, useRef } from "react";
import type { Api, ClaimDraft } from "../api";

export interface DraftSaves {
  /** Keeps the claim so far to finish later; dropped while a claim is being sent. */
  save: (draft: ClaimDraft) => void;
  /** From the tap on Send claim until it's made or fails. */
  sending: (on: boolean) => void;
  /** Removes the saved draft once the claim is made, after any save already on its way. */
  discard: () => Promise<void>;
}

// Saves and the discard after a send reach the api one at a time, in order, so a save still on
// its way can't land after the claim is made and bring the draft back. A failed save is
// dropped: the next one carries everything again.
export function useDraftSaves(api: Pick<Api, "saveDraft" | "discardDraft">): DraftSaves {
  const queue = useRef<Promise<void>>(Promise.resolve());
  const sendingNow = useRef(false);
  return useMemo(() => {
    const after = (work: () => Promise<unknown>) => {
      const next = queue.current.then(work).then(
        () => undefined,
        () => undefined,
      );
      queue.current = next;
      return next;
    };
    return {
      save: (draft) => {
        if (!sendingNow.current) void after(() => api.saveDraft(draft));
      },
      sending: (on) => {
        sendingNow.current = on;
      },
      // A failed discard is tried once more, or the draft would come back on the next visit.
      discard: () => after(() => api.discardDraft().catch(() => api.discardDraft())),
    };
  }, [api]);
}
