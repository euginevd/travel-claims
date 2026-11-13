import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi } from "../api";
import { fakeFetch } from "../testing";
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
  const fetchFn = fakeFetch({
    "GET /api/engineering/redteam": () => [200, { ...IDLE, report: REPORT }],
  });
  render(<RedTeamPage api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findByText("1 of 2 attacks held")).toBeInTheDocument();
  expect(screen.getByText("Held")).toBeInTheDocument();
  expect(screen.getByText("Failed")).toBeInTheDocument();
  expect(screen.getAllByText("CLM-1902")).toHaveLength(2);
});

test("an AI engineer runs it, sees it running, then the report", async () => {
  const user = userEvent.setup();
  let checks = 0;
  const running = { ...IDLE, running: true, started_at: "2026-11-08T11:00:00Z" };
  const fetchFn = fakeFetch({
    "GET /api/engineering/redteam": () => {
      checks += 1;
      if (checks === 1) return [200, IDLE];
      return [200, checks < 4 ? running : { ...IDLE, report: REPORT }];
    },
    "POST /api/engineering/redteam/runs": () => [202, running],
  });
  render(<RedTeamPage api={createApi(fetchFn, () => "t")} pollMs={10} />);
  await user.click(await screen.findByRole("button", { name: /run the red team/i }));
  expect(await screen.findByText(/running 9 attack claims/i)).toBeInTheDocument();
  expect(await screen.findByText("1 of 2 attacks held")).toBeInTheDocument();
});

test("says why when a run can't start", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    "GET /api/engineering/redteam": () => [200, IDLE],
    "POST /api/engineering/redteam/runs": () => [
      409,
      { detail: "The red team is already running." },
    ],
  });
  render(<RedTeamPage api={createApi(fetchFn, () => "t")} />);
  await user.click(await screen.findByRole("button", { name: /run the red team/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent("already running");
});
