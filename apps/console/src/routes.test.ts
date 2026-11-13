import { parseHash, runHref, traceHref } from "./useHashRoute";

test("every page has a route, old links still work, and anything else is the overview", () => {
  expect(parseHash("#/detections")).toEqual({ page: "detections" });
  expect(parseHash("#/coverage")).toEqual({ page: "redteam" });
  expect(parseHash("#/threats")).toEqual({ page: "redteam" });
  expect(parseHash("#/agents")).toEqual({ page: "agents" });
  expect(parseHash("#/audit")).toEqual({ page: "audit" });
  expect(parseHash("#/versions/3")).toEqual({ page: "version", version: 3 });
  expect(parseHash("#/")).toEqual({ page: "overview" });
  expect(parseHash("#/posture")).toEqual({ page: "posture" });
  expect(parseHash("#/redteam")).toEqual({ page: "redteam" });
  expect(parseHash("#/scoreboard")).toEqual({ page: "scoreboard" });
  expect(parseHash("#/improvement")).toEqual({ page: "improvement" });
  expect(parseHash("#/live")).toEqual({ page: "live" });
  expect(parseHash(runHref(7))).toEqual({ page: "run", runId: 7 });
  expect(parseHash("#/trace")).toEqual({ page: "trace" });
  expect(parseHash(traceHref("CLM-1017"))).toEqual({ page: "trace", claimId: "CLM-1017" });
  expect(parseHash("#/trace/clm-9")).toEqual({ page: "trace", claimId: "CLM-9" });
  expect(parseHash("#/claims/CLM-1001")).toEqual({ page: "overview" });
  expect(parseHash("")).toEqual({ page: "overview" });
});
