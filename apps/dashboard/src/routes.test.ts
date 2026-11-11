import { claimHref, parseHash, QUEUE_HREF, SETTINGS_HREF } from "./useHashRoute";

test("every page has a route, and anything else is the queue", () => {
  expect(parseHash(QUEUE_HREF)).toEqual({ page: "queue" });
  expect(parseHash(claimHref("CLM-1001"))).toEqual({ page: "claim", claimId: "CLM-1001" });
  expect(parseHash(SETTINGS_HREF)).toEqual({ page: "settings" });
  // The AI engineers' pages moved to their own console.
  expect(parseHash("#/scoreboard")).toEqual({ page: "queue" });
  expect(parseHash("#/redteam")).toEqual({ page: "queue" });
  expect(parseHash("")).toEqual({ page: "queue" });
});
