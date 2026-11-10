import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi, type Dispatch } from "../api";
import { DANA, fakeFetch, MARCUS } from "../testing";
import { DispatchCard } from "./DispatchCard";

const RUNNING: Dispatch = {
  dispatch_id: 4,
  concurrency: 3,
  status: "running",
  started_by: "Dana Whitfield",
  started_at: "2026-11-10T04:41:00+00:00",
  finished_at: null,
  stopped_reason: null,
  claims: [
    {
      claim_id: "CLM-1001",
      summary: "Delayed flight",
      status: "decided",
      decision: "approve",
      payout: 420,
      cost: 0.031,
    },
    {
      claim_id: "CLM-1003",
      summary: "Lost bag",
      status: "in_progress",
      decision: null,
      payout: null,
      cost: 0.01,
    },
  ],
  worked: 1,
  decided: 1,
  waiting_for_sign_off: 0,
  referred: 0,
  not_started: 0,
  total_cost: 0.041,
};

const noop = () => undefined;

test("a senior handler confirms, then starts a dispatch of the waiting claims", async () => {
  const user = userEvent.setup();
  let started = false;
  const fetchFn = fakeFetch({
    "GET /api/staff/dispatches/latest": () => [
      200,
      started ? { waiting: 0, dispatch: RUNNING } : { waiting: 14, dispatch: null },
    ],
    "POST /api/staff/dispatches": () => {
      started = true;
      return [201, RUNNING];
    },
  });
  render(<DispatchCard api={createApi(fetchFn, () => "t")} handler={DANA} onProgress={noop} />);
  await user.click(await screen.findByRole("button", { name: "Work the waiting claims" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Work 14 waiting claims?");
  await user.click(screen.getByRole("button", { name: "Start the dispatch" }));
  expect(await screen.findByText("Dispatch #4")).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Claims worked" })).toBeInTheDocument();
  expect(screen.getByText("1 decided")).toBeInTheDocument();
});

test("a handler who isn't senior sees the queue's state but no way to start one", async () => {
  const fetchFn = fakeFetch({
    "GET /api/staff/dispatches/latest": () => [
      200,
      { waiting: 2, dispatch: { ...RUNNING, status: "finished" } },
    ],
  });
  render(<DispatchCard api={createApi(fetchFn, () => "t")} handler={MARCUS} onProgress={noop} />);
  expect(await screen.findByText(/A senior handler can have claim agents/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Work the waiting claims" })).toBeNull();
  expect(screen.getByText(/Last dispatch: #4, finished/)).toBeInTheDocument();
});

test("a refused start says why", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    "GET /api/staff/dispatches/latest": () => [200, { waiting: 1, dispatch: null }],
    "POST /api/staff/dispatches": () => [409, { detail: "An evaluation run is going." }],
  });
  render(<DispatchCard api={createApi(fetchFn, () => "t")} handler={DANA} onProgress={noop} />);
  await user.click(await screen.findByRole("button", { name: "Work the waiting claims" }));
  await user.click(screen.getByRole("button", { name: "Start the dispatch" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("An evaluation run is going.");
});
