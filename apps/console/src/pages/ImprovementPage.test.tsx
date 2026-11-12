import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi, type Configuration, type Round, type Run, type RunClaim } from "../api";
import { fakeFetch } from "../testing";
import { ImprovementPage } from "./ImprovementPage";

const SCORES = {
  claims: 25,
  decided: 25,
  accuracy: 0.8,
  payout_accuracy: 0.8,
  straight_through: 0.6,
  cost_per_claim: 0.03,
  seconds_per_claim: 20,
  total_cost: 0.75,
  grade: null,
  graded: 0,
  judge_cost: 0,
};

const ROUND: Round = {
  round_id: 2,
  status: "kept",
  baseline_version: 1,
  candidate_version: 2,
  baseline_eval_run: 4,
  baseline_held_run: 5,
  candidate_held_run: 6,
  proposal: { reason: "Haiku should hold accuracy for less" },
  review: null,
  verdict: {
    kept: true,
    outcome: "better",
    why: "Kept: better on cost per claim and worse on none",
    baseline: SCORES,
    candidate: { ...SCORES, accuracy: 0.84, cost_per_claim: 0.009 },
  },
  improver_cost: 0.01,
  spend_limit: 2,
  spent: 1.2,
  diff: "--- version 1\n+++ version 2\n-model: claude-sonnet-5-5\n+model: claude-haiku-5-5",
  started_by: "Sam Carter",
  started_at: "2026-11-12T08:00:00Z",
};

const VERSION: Configuration = {
  version: 1,
  instructions: "Decide the claim.",
  model: "claude-sonnet-5-5",
  effort: "medium",
  reason: "The first configuration",
  diff: "",
  status: "kept",
  parent_version: null,
  proposed_by: "UnderCover Agent",
  reviewed_by: null,
  created_at: "2026-11-08T10:00:00Z",
  current: false,
};
const VERSIONS: Configuration[] = [
  { ...VERSION, version: 2, model: "claude-haiku-5-5", proposed_by: "Improver", current: true },
  VERSION,
];

function claim(id: string, decision: "approve" | "refer", matched: boolean): RunClaim {
  return {
    claim_id: `CLM-9${id}`,
    original_claim_id: `CLM-1${id}`,
    summary: `Claim ${id}`,
    status: "decided",
    decision,
    payout: 0,
    reason: null,
    handler_decision: "approve",
    handler_payout: 0,
    handler_reason: null,
    matched,
    payout_matched: matched,
    cost: 0.01,
    judged: false,
    grade: null,
    same_grounds: null,
    same_section: null,
    grade_note: null,
  };
}

const RUN: Run = {
  run_id: 5,
  label_set: "held_out",
  size: "whole",
  concurrency: 5,
  config_version: 2,
  round_id: 2,
  status: "finished",
  started_by: "Sam Carter",
  started_at: "2026-11-12T08:00:00Z",
  finished_at: "2026-11-12T08:05:00Z",
  scores: { ...SCORES, accuracy: 0.84, cost_per_claim: 0.009 },
  grading: false,
};

test("a finished round shows before and after, claim by claim, and the version rolls back", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    "GET /api/engineering/rounds": () => [200, [ROUND]],
    "GET /api/engineering/configuration": () => [200, VERSIONS],
    "GET /api/engineering/runs": () => [200, [RUN]],
    "GET /api/engineering/runs/5": () => [
      200,
      { ...RUN, claims: [claim("01", "approve", true), claim("02", "refer", false)] },
    ],
    "GET /api/engineering/runs/6": () => [
      200,
      { ...RUN, run_id: 6, claims: [claim("01", "refer", false), claim("02", "approve", true)] },
    ],
    "POST /api/engineering/configuration/1/restore": () => [200, { ...VERSION, current: true }],
  });
  render(<ImprovementPage api={createApi(fetchFn, () => "t")} />);

  expect(
    await screen.findByText("Switch Sonnet → Haiku, instructions unchanged"),
  ).toBeInTheDocument();
  const table = screen.getByRole("region", { name: "Before and after table" });
  expect(within(table).getByText("+1 claim")).toBeInTheDocument();
  expect(within(table).getByText("70% cheaper")).toBeInTheDocument();

  const pairs = await screen.findByRole("region", { name: "Claims decided differently table" });
  const [, first, second] = within(pairs).getAllByRole("row");
  expect(first).toHaveTextContent("Worse");
  expect(second).toHaveTextContent("Better");
  expect(within(pairs).getAllByRole("link")[0]).toHaveAttribute("href", "#/trace/CLM-901");

  expect(screen.getByRole("heading", { name: /In use: v2/ })).toBeInTheDocument();
  expect(screen.getByText("84% of 25")).toBeInTheDocument();
  await user.click(screen.getByText("Roll back to an earlier version"));
  await user.click(screen.getByRole("button", { name: "Roll back to v1" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Say why");
  await user.type(screen.getByLabelText("Why"), "Haiku misses medical claims");
  await user.click(screen.getByRole("button", { name: "Roll back to v1" }));
  expect(fetchFn.calls.at(-4)?.body).toEqual({ reason: "Haiku misses medical claims" });
});
