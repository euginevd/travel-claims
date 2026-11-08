import {
  claimHref,
  IMPROVEMENT_HREF,
  parseHash,
  QUEUE_HREF,
  REDTEAM_HREF,
  runHref,
  SCOREBOARD_HREF,
} from "./useHashRoute";

test("every page has a route, and anything else is the queue", () => {
  expect(parseHash(REDTEAM_HREF)).toEqual({ page: "redteam" });
  expect(parseHash(SCOREBOARD_HREF)).toEqual({ page: "scoreboard" });
  expect(parseHash(IMPROVEMENT_HREF)).toEqual({ page: "improvement" });
  expect(parseHash(runHref(7))).toEqual({ page: "run", runId: 7 });
  expect(parseHash(claimHref("CLM 1/2"))).toEqual({ page: "claim", claimId: "CLM 1/2" });
  expect(parseHash(QUEUE_HREF)).toEqual({ page: "queue" });
  expect(parseHash("#/nowhere")).toEqual({ page: "queue" });
  expect(parseHash("")).toEqual({ page: "queue" });
});
