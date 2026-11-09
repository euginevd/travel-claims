import { parseHash, runHref } from "./useHashRoute";

test("every page has a route, and anything else is the scoreboard", () => {
  expect(parseHash("#/improvement")).toEqual({ page: "improvement" });
  expect(parseHash("#/redteam")).toEqual({ page: "redteam" });
  expect(parseHash(runHref(7))).toEqual({ page: "run", runId: 7 });
  expect(parseHash("#/claims/CLM-1001")).toEqual({ page: "scoreboard" });
  expect(parseHash("")).toEqual({ page: "scoreboard" });
});
