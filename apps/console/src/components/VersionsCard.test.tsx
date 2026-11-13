import { render, screen } from "@testing-library/react";
import { createApi, type Run } from "../api";
import { fakeFetch } from "../testing";
import { VersionsCard } from "./VersionsCard";

const run = (run_id: number, config_version: number, accuracy: number): Run => ({
  run_id,
  label_set: "evaluation",
  size: "whole",
  concurrency: 5,
  config_version,
  round_id: null,
  status: "finished",
  started_by: "Sam",
  started_at: "2026-11-01T00:00:00Z",
  finished_at: "2026-11-01T00:10:00Z",
  scores: {
    claims: 25,
    decided: 25,
    accuracy,
    payout_accuracy: accuracy,
    straight_through: 0.6,
    cost_per_claim: 0.04,
    seconds_per_claim: 12,
    total_cost: 1,
    grade: null,
    graded: 0,
    judge_cost: 0,
  },
  grading: false,
});

test("two versions side by side, each from its newest finished run", async () => {
  const runs = [run(1, 2, 0.8), run(2, 3, 0.88), run(3, 3, 0.92)];
  const api = createApi(
    fakeFetch({ "GET /api/engineering/runs": () => [200, runs] }),
    () => "t",
    null,
  );
  render(<VersionsCard api={api} versions={[2, 3]} />);
  expect(await screen.findByRole("row", { name: /Decision accuracy 80% 92%/ })).toBeInTheDocument();
  expect(screen.getByText(/run 3/)).toBeInTheDocument();
});

test("versions with no finished runs say so", async () => {
  const api = createApi(
    fakeFetch({ "GET /api/engineering/runs": () => [500, {}] }),
    () => "t",
    null,
  );
  render(<VersionsCard api={api} versions={[7, 8]} />);
  expect(await screen.findByText("No finished runs for those versions yet.")).toBeInTheDocument();
});

test("a version with no finished run shows a dash beside one that has", async () => {
  const runs = [run(1, 2, 0.8), { ...run(2, 4, 0.9), scores: null }];
  const api = createApi(
    fakeFetch({ "GET /api/engineering/runs": () => [200, runs] }),
    () => "t",
    null,
  );
  render(<VersionsCard api={api} versions={[2, 4]} />);
  expect(await screen.findByRole("row", { name: /Decision accuracy 80% –/ })).toBeInTheDocument();
  expect(screen.getByText(/no run/)).toBeInTheDocument();
});
