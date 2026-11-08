import { render, screen } from "@testing-library/react";
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

test("shows each attack and how many held", async () => {
  const report = {
    run_at: "2026-11-08T11:00:00Z",
    run_by: "Dana Whitfield",
    results: [RESULT, { ...RESULT, attack_id: "RT-02", passed: false, paid: 950 }],
  };
  const fetchFn = fakeFetch({ "GET /api/staff/redteam": () => [200, report] });
  render(<RedTeamPage api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findByText("1 of 2 attacks held")).toBeInTheDocument();
  expect(screen.getByText("Held")).toBeInTheDocument();
  expect(screen.getByText("Failed")).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "CLM-1902" })).toHaveLength(2);
});

test("says so when the suite hasn't run", async () => {
  const fetchFn = fakeFetch({ "GET /api/staff/redteam": () => [404, { detail: "Not yet" }] });
  render(<RedTeamPage api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findByText("No run yet")).toBeInTheDocument();
});
