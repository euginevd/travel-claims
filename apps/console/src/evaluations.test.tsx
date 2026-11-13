import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi, type Round, type Run, type RunClaim, type RunInFull } from "./api";
import { ImprovementPage } from "./pages/ImprovementPage";
import { RunPage } from "./pages/RunPage";
import { measures, ScoreboardPage } from "./pages/ScoreboardPage";
import { rangeText, wilson } from "./stats";
import { fakeFetch } from "./testing";

const SCORES = {
  claims: 5,
  decided: 5,
  accuracy: 0.8,
  payout_accuracy: 0.6,
  straight_through: 0.8,
  cost_per_claim: 0.031,
  seconds_per_claim: 22,
  total_cost: 0.155,
  grade: 2,
  graded: 2,
  judge_cost: 0.004,
};

const RUN: Run = {
  run_id: 3,
  label_set: "evaluation",
  size: "tiny",
  concurrency: 5,
  config_version: 1,
  round_id: null,
  status: "finished",
  started_by: "Dana Whitfield",
  started_at: "2026-11-08T10:00:00+00:00",
  finished_at: "2026-11-08T10:02:00+00:00",
  scores: SCORES,
  grading: false,
};

const RUN_IN_FULL: RunInFull = {
  ...RUN,
  claims: [
    {
      claim_id: "CLM-90000301",
      original_claim_id: "CLM-1007",
      summary: "Lost bag",
      status: "decided",
      decision: "approve",
      payout: 50,
      reason: "Covered.",
      handler_decision: "approve",
      handler_payout: 50,
      handler_reason: "Covered under section 6.",
      matched: true,
      payout_matched: true,
      cost: 0.03,
      judged: true,
      grade: 3,
      same_grounds: true,
      same_section: true,
      grade_note: "Same grounds and section.",
    },
    {
      claim_id: "CLM-90000302",
      original_claim_id: "CLM-1017",
      summary: "Missed connection",
      status: "decided",
      decision: "decline",
      payout: 0,
      reason: "Not covered.",
      handler_decision: "refer",
      handler_payout: 0,
      handler_reason: "Needs the carrier's report.",
      matched: false,
      payout_matched: false,
      cost: 0.02,
      judged: true,
      grade: 1,
      same_grounds: false,
      same_section: true,
      grade_note: "Missed that the carrier's report is needed.",
    },
  ],
};

test("the measures read as percentages, dollars and seconds", () => {
  expect(measures(SCORES).map((m) => m.value)).toEqual([
    "80%",
    "60%",
    "80%",
    "2.0 of 3",
    "$0.031",
    "22s",
  ]);
});

test("an AI engineer starts a run from the scoreboard", async () => {
  const fetchFn = fakeFetch({
    "GET /api/engineering/runs": () => [200, [RUN]],
    "POST /api/engineering/runs": () => [
      201,
      { ...RUN, run_id: 4, status: "running", scores: null },
    ],
  });
  render(<ScoreboardPage api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findByRole("link", { name: "Run 3" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Start the practice run" }));
  expect(fetchFn.calls.some((c) => c.method === "POST" && c.path === "/api/engineering/runs")).toBe(
    true,
  );
});

test("a run shows each claim beside the handler's decision, misses first", async () => {
  const fetchFn = fakeFetch({ "GET /api/engineering/runs/3": () => [200, RUN_IN_FULL] });
  render(<RunPage api={createApi(fetchFn, () => "t")} runId={3} />);
  const rows = await screen.findAllByRole("row");
  expect(rows[1]).toHaveTextContent("CLM-1017");
  expect(rows[1]).toHaveTextContent("Miss");
  expect(rows[2]).toHaveTextContent("Match");
  expect(rows[1]).toHaveTextContent("C · 1");
  expect(rows[1]).toHaveTextContent("Same grounds: No · Same section: Yes");
  expect(rows[2]).toHaveTextContent("A · 3");
});

test("a run the judge is grading says so, and a copy it couldn't grade says not graded", async () => {
  const [graded, waiting] = RUN_IN_FULL.claims as [RunClaim, RunClaim];
  const grading: RunInFull = {
    ...RUN_IN_FULL,
    grading: true,
    scores: { ...SCORES, grade: null, graded: 0 },
    claims: [
      { ...graded, judged: true, grade: null, same_grounds: null, same_section: null },
      { ...waiting, judged: false, grade: null, grade_note: null },
    ],
  };
  const fetchFn = fakeFetch({ "GET /api/engineering/runs/3": () => [200, grading] });
  render(<RunPage api={createApi(fetchFn, () => "t")} runId={3} />);
  expect(await screen.findByText(/grading…/)).toBeInTheDocument();
  expect(screen.getByText("Grading…")).toBeInTheDocument();
  expect(screen.getByText("Not graded", { selector: "span" })).toBeInTheDocument();
  expect(screen.getByText("Not graded", { selector: "p" })).toBeInTheDocument();
});

const ROUND: Round = {
  round_id: 1,
  status: "awaiting_review",
  baseline_version: 1,
  candidate_version: 2,
  baseline_eval_run: 5,
  baseline_held_run: 6,
  candidate_held_run: null,
  proposal: { reason: "Refer when documents are thin", model: "claude-sonnet-5-5" },
  review: null,
  verdict: null,
  improver_cost: 0.02,
  spend_limit: 2,
  spent: 0.33,
  diff: "+Refer when the documents are thin.",
  started_by: "Dana Whitfield",
  started_at: "2026-11-08T10:00:00+00:00",
};

test("an AI engineer approves the improver's proposal with a reason", async () => {
  const fetchFn = fakeFetch({
    "GET /api/engineering/rounds": () => [200, [ROUND]],
    "GET /api/engineering/configuration": () => [200, []],
    "POST /api/engineering/rounds/1/review": () => [200, { ...ROUND, status: "evaluating" }],
  });
  render(<ImprovementPage api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findByText("+Refer when the documents are thin.")).toBeInTheDocument();
  const approve = screen.getByRole("button", { name: /Approve and run the exam/ });
  await userEvent.click(approve);
  expect(await screen.findByRole("alert")).toHaveTextContent("Say why");
  await userEvent.type(screen.getByLabelText("Your reason"), "Worth trying");
  await userEvent.click(approve);
  const review = fetchFn.calls.find((c) => c.path === "/api/engineering/rounds/1/review");
  expect(review?.body).toEqual({ approve: true, reason: "Worth trying" });
});

const VERSION_ONE = {
  version: 1,
  instructions: "Decide claims.",
  model: "claude-sonnet-5-5",
  effort: "medium",
  reason: "First",
  diff: "",
  status: "kept",
  parent_version: null,
  proposed_by: "UnderCover Agent",
  reviewed_by: null,
  created_at: "2026-11-08T10:00:00+00:00",
  current: true,
};

test("a rejection and a finished round read plainly", async () => {
  const finished: Round = {
    ...ROUND,
    round_id: 2,
    status: "rolled_back",
    candidate_held_run: 7,
    verdict: { why: "Rolled back: no measure improved on the held-out set" },
  };
  const fetchFn = fakeFetch({
    "GET /api/engineering/rounds": () => [200, [ROUND, finished]],
    "GET /api/engineering/configuration": () => [200, [VERSION_ONE]],
    "POST /api/engineering/rounds/1/review": () => [200, { ...ROUND, status: "rejected" }],
    "POST /api/engineering/rounds/1/stop": () => [200, { ...ROUND, status: "stopped" }],
  });
  render(<ImprovementPage api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findByText(/no measure improved/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Your reason"), "Too risky");
  await userEvent.click(screen.getByRole("button", { name: "Reject" }));
  const review = fetchFn.calls.find((c) => c.path === "/api/engineering/rounds/1/review");
  expect(review?.body).toEqual({ approve: false, reason: "Too risky" });
  await userEvent.click(screen.getByRole("button", { name: "Stop the round" }));
  expect(fetchFn.calls.some((c) => c.path === "/api/engineering/rounds/1/stop")).toBe(true);
});

test("a stopped run offers to carry on with its unfinished claims", async () => {
  const second = RUN_IN_FULL.claims[1];
  if (!second) throw new Error("The fixture run needs two claims");
  const unfinished = { ...second, status: "in_progress" as const };
  const stopped: RunInFull = {
    ...RUN_IN_FULL,
    status: "stopped",
    scores: null,
    claims: [{ ...unfinished, decision: null, payout: null }],
  };
  const fetchFn = fakeFetch({
    "GET /api/engineering/runs/3": () => [200, stopped],
    "POST /api/engineering/runs/3/resume": () => [200, { ...RUN, status: "running" }],
  });
  render(<RunPage api={createApi(fetchFn, () => "t")} runId={3} />);
  expect(await screen.findByText("Not decided")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Carry on/ }));
  expect(fetchFn.calls.some((c) => c.path === "/api/engineering/runs/3/resume")).toBe(true);
});

test("the scoreboard says what went wrong and tries again", async () => {
  let fail = true;
  const fetchFn = fakeFetch({
    "GET /api/engineering/runs": () => (fail ? [500, { detail: "Database down" }] : [200, [RUN]]),
  });
  render(<ScoreboardPage api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Database down");
  fail = false;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("link", { name: "Run 3" })).toBeInTheDocument();
});

test("a run that can't load says why, and a resume that fails says so", async () => {
  const user = userEvent.setup();
  const missing = fakeFetch({ "GET /api/engineering/runs/9": () => [404, { detail: "No run 9" }] });
  render(<RunPage api={createApi(missing, () => "t")} runId={9} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("No run 9");

  const stopped: RunInFull = {
    ...RUN_IN_FULL,
    status: "stopped",
    claims: RUN_IN_FULL.claims.map((claim) => ({ ...claim, status: "waiting" })),
  };
  const failing = fakeFetch({
    "GET /api/engineering/runs/3": () => [200, stopped],
    "POST /api/engineering/runs/3/resume": () => [409, { detail: "Already running" }],
  });
  render(<RunPage api={createApi(failing, () => "t")} runId={3} />);
  await user.click(await screen.findByRole("button", { name: /Carry on/ }));
  expect(await screen.findByText("Already running")).toBeInTheDocument();
});

test("the scoreboard charts each version's exam, scores claim types and compares two runs", async () => {
  const user = userEvent.setup();
  const exam = (run_id: number, version: number, accuracy: number): Run => ({
    ...RUN,
    run_id,
    label_set: "held_out",
    size: "whole",
    config_version: version,
    round_id: 1,
    scores: { ...SCORES, claims: 25, accuracy },
  });
  const typed = (decision: "approve" | "refer", matched: boolean): RunInFull["claims"] =>
    RUN_IN_FULL.claims.map((claim, index) => ({
      ...claim,
      claim_type: index === 0 ? "baggage" : "trip_delay",
      decision: index === 0 ? claim.decision : decision,
      matched: index === 0 ? claim.matched : matched,
    }));
  const fetchFn = fakeFetch({
    "GET /api/engineering/runs": () => [200, [exam(6, 2, 0.84), exam(5, 1, 0.6), RUN]],
    "GET /api/engineering/configuration": () => [200, []],
    "GET /api/engineering/runs/6": () => [
      200,
      { ...exam(6, 2, 0.84), claims: typed("refer", true) },
    ],
    "GET /api/engineering/runs/5": () => [
      200,
      { ...exam(5, 1, 0.6), claims: typed("approve", false) },
    ],
  });
  render(<ScoreboardPage api={createApi(fetchFn, () => "t")} />);

  // Both versions' exams on one chart, each with its likely range; claim types weakest first.
  expect(await screen.findByRole("img", { name: /v1 60% .*v2 84%/ })).toBeInTheDocument();
  const types = await screen.findByRole("region", { name: "By claim type table" });
  const [, first] = within(types).getAllByRole("row");
  expect(first).toHaveTextContent("Baggage");

  // The latest two exams compared: the trip delay claim went from wrong to right.
  const diff = await screen.findByRole("region", { name: "Claims decided differently table" });
  expect(within(diff).getByText("Better")).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Before"), "6");
  expect(screen.getByText("Pick two different runs.")).toBeInTheDocument();
});

test("a range stays honest at the edges of a small test", () => {
  expect(rangeText(wilson(1, 5))).toBe("57–100%");
  expect(rangeText(wilson(0.84, 25))).toBe("65–94%");
  expect(wilson(0.5, 0)).toBeNull();
});
