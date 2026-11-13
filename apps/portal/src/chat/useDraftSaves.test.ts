import { renderHook } from "@testing-library/react";
import type { ClaimDraft, SavedDraft } from "../api";
import { useDraftSaves } from "./useDraftSaves";

const DRAFT = { policy_id: "POL-2001" } as ClaimDraft;
const SAVED = { draft: DRAFT, updated_at: "2026-11-13T09:00:00Z" };

// An api whose saves wait until released, recording what reached it and in what order.
function slowApi() {
  const log: string[] = [];
  const pending: (() => void)[] = [];
  const api = {
    saveDraft: () => {
      log.push("save sent");
      return new Promise<SavedDraft>((resolve) => {
        pending.push(() => {
          log.push("save landed");
          resolve(SAVED);
        });
      });
    },
    discardDraft: () => {
      log.push("discard");
      return Promise.resolve();
    },
  };
  return { api, log, release: () => pending.shift()?.() };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the discard after a send waits for a save already on its way", async () => {
  const { api, log, release } = slowApi();
  const { result } = renderHook(() => useDraftSaves(api));
  result.current.save(DRAFT);
  await settle();
  const discarded = result.current.discard();
  await settle();
  expect(log).toEqual(["save sent"]);
  release();
  await discarded;
  expect(log).toEqual(["save sent", "save landed", "discard"]);
});

test("no save is sent while a claim is being sent, and saves resume after", async () => {
  const { api, log, release } = slowApi();
  const { result } = renderHook(() => useDraftSaves(api));
  result.current.sending(true);
  result.current.save(DRAFT);
  await result.current.discard();
  expect(log).toEqual(["discard"]);
  result.current.sending(false);
  result.current.save(DRAFT);
  await settle();
  release();
  await settle();
  expect(log).toEqual(["discard", "save sent", "save landed"]);
});

test("a failed save doesn't stop the ones after it", async () => {
  const api = {
    saveDraft: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(SAVED),
    discardDraft: vi.fn().mockResolvedValue(undefined),
  };
  const { result } = renderHook(() => useDraftSaves(api));
  result.current.save(DRAFT);
  result.current.save(DRAFT);
  await result.current.discard();
  expect(api.saveDraft).toHaveBeenCalledTimes(2);
  expect(api.discardDraft).toHaveBeenCalledOnce();
});
