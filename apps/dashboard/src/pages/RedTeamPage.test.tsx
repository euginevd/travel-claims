import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi } from "../api";
import { DANA, fakeFetch, MARCUS } from "../testing";
import { RedTeamPage } from "./RedTeamPage";

const RESULT = {
  attack_id: "RT-01",
  name: "Instruction printed on a receipt image",
  technique: "Visible text",
  owasp: "LLM01",
  claim_id: "CLM-1902",
  outcome: "Referred to a handler",
  decided_by: "Hidden-instruction check",
  paid: 0,
  passed: true,
  note: "No money left.",
};
const REPORT = {
  run_at: "2026-11-08T11:00:00Z",
  run_by: "Dana Whitfield",
  results: [RESULT, { ...RESULT, attack_id: "RT-02", passed: false, paid: 950 }],
};
const IDLE = { running: false, started_at: null, started_by: null, report: null };

test("shows each attack and how many held", async () => {
  const fetchFn = fakeFetch({ "GET /api/staff/redteam": () => [200, { ...IDLE, report: REPORT }] });
  render(<RedTeamPage api={createApi(fetchFn, () => "t")} handler={MARCUS} />);
  expect(await screen.findByText("1 of 2 attacks held")).toBeInTheDocument();
  expect(screen.getByText("Held")).toBeInTheDocument();
  expect(screen.getByText("Failed")).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "CLM-1902" })).toHaveLength(2);
});

test("a handler without sign-off rights can't run it and is told why", async () => {
  const fetchFn = fakeFetch({ "GET /api/staff/redteam": () => [200, IDLE] });
  render(<RedTeamPage api={createApi(fetchFn, () => "t")} handler={MARCUS} />);
  expect(await screen.findByText("No run yet")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /run the red team/i })).toBeDisabled();
  expect(screen.getByText(/only a senior handler/i)).toBeInTheDocument();
});

test("a senior runs it, sees it running, then the report", async () => {
  const user = userEvent.setup();
  let checks = 0;
  const running = { ...IDLE, running: true, started_at: "2026-11-08T11:00:00Z" };
  const fetchFn = fakeFetch({
    "GET /api/staff/redteam": () => {
      checks += 1;
      if (checks === 1) return [200, IDLE];
      return [200, checks < 4 ? running : { ...IDLE, report: REPORT }];
    },
    "POST /api/staff/redteam/runs": () => [202, running],
  });
  render(<RedTeamPage api={createApi(fetchFn, () => "t")} handler={DANA} pollMs={10} />);
  await user.click(await screen.findByRole("button", { name: /run the red team/i }));
  expect(await screen.findByText(/running 8 attack claims/i)).toBeInTheDocument();
  expect(await screen.findByText("1 of 2 attacks held")).toBeInTheDocument();
});

test("says why when a run can't start", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    "GET /api/staff/redteam": () => [200, IDLE],
    "POST /api/staff/redteam/runs": () => [409, { detail: "The red team is already running." }],
  });
  render(<RedTeamPage api={createApi(fetchFn, () => "t")} handler={DANA} />);
  await user.click(await screen.findByRole("button", { name: /run the red team/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent("already running");
});
