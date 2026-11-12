import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi } from "../api";
import { fakeFetch } from "../testing";
import { AgentsPage } from "./AgentsPage";

const COVERAGE = {
  redteam_run_at: null,
  threats: [],
  agents: [
    {
      agent: "Claim agent",
      model: "claude-sonnet-5-5",
      tools: "get_claim, record_decision",
      sources: "its own claim and customer",
      worst_case: "Approves a claim it shouldn't, up to the approval limit",
      stopped_by: "The payout is worked out in code",
    },
  ],
  payouts: { paused: false, changed_by: null, changed_at: null, reason: null },
};

test("shows each agent's worst case and what stops it, after a retry", async () => {
  const user = userEvent.setup();
  let fail = true;
  const fetchFn = fakeFetch({
    "GET /api/engineering/threats": () => (fail ? [500, { detail: "Down" }] : [200, COVERAGE]),
  });
  render(<AgentsPage api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Down");
  fail = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("rowheader", { name: "Claim agent" })).toBeInTheDocument();
  expect(screen.getByText(/up to the approval limit/)).toBeInTheDocument();
  expect(screen.getByText("The payout is worked out in code")).toBeInTheDocument();
});

test("says when no agents are listed", async () => {
  const fetchFn = fakeFetch({
    "GET /api/engineering/threats": () => [200, { ...COVERAGE, agents: [] }],
  });
  render(<AgentsPage api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findByText("No agents are listed.")).toBeInTheDocument();
});
