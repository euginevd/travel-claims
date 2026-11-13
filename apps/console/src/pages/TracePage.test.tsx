import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi } from "../api";
import { fakeFetch } from "../testing";
import { TracePage } from "./TracePage";

const TRACE = {
  steps: [
    {
      step_id: 1,
      kind: "screening",
      content: "No hidden instructions",
      created_at: "2026-11-09T01:00:00Z",
    },
  ],
  model_calls: [
    {
      model: "claude-sonnet-5-5",
      input_tokens: 1200,
      output_tokens: 300,
      cost: 0.0125,
      latency_ms: 2400,
      created_at: "2026-11-09T01:00:00Z",
    },
    {
      model: "claude-haiku-5-5",
      input_tokens: 100,
      output_tokens: 20,
      cost: 0.0004,
      latency_ms: null,
      created_at: "2026-11-09T01:00:01Z",
    },
  ],
  total_cost: 0.0129,
  total_tokens: 1620,
  summary: "Flight UL 503 was 4h 40m late",
  status: "decided",
  outcome: {
    decision: "refer",
    payout: 0,
    section: "Policy wording 3",
    reason: "No receipt, and the cause of the delay couldn't be found.",
    decided_by: "UnderCover Agent",
    decided_at: "2026-11-09T01:00:02Z",
  },
  config_version: 1,
  average_cost: 0.0043,
};

test("shows a claim's model calls, tokens and cost, or why it can't", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    "GET /api/engineering/claims/CLM-1017/trace": () => [200, TRACE],
    "GET /api/engineering/claims/CLM-9/trace": () => [404, { detail: "Claim CLM-9 not found" }],
  });
  render(<TracePage api={createApi(fetchFn, () => "t")} />);
  await user.type(screen.getByLabelText("Claim"), "clm-1017");
  await user.click(screen.getByRole("button", { name: /Show/ }));
  expect(await screen.findByText("Referred to a handler")).toBeInTheDocument();
  expect(screen.getByText(/the cause of the delay couldn't be found/)).toBeInTheDocument();
  expect(screen.getByText(/claim agent version 1/)).toBeInTheDocument();
  expect(
    screen.getByText(/Claude Sonnet · 1,200 in \/ 300 out · \$0.0125 · 2.4s/),
  ).toBeInTheDocument();
  expect(screen.getByText("Screening: no instructions found")).toBeInTheDocument();
  expect(screen.getByText(/3.0× the average live claim/)).toBeInTheDocument();
  expect(screen.getByText("Screened first: clean")).toBeInTheDocument();
  await user.clear(screen.getByLabelText("Claim"));
  await user.type(screen.getByLabelText("Claim"), "CLM-9");
  await user.click(screen.getByRole("button", { name: /Show/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Claim CLM-9 not found");
});

test("opens the suggested claim's trace straight away", async () => {
  const fetchFn = fakeFetch({
    "GET /api/engineering/trace-suggestion": () => [200, { claim_id: "CLM-1017", model_calls: 9 }],
    "GET /api/engineering/claims/CLM-1017/trace": () => [200, TRACE],
  });
  render(<TracePage api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findByDisplayValue("CLM-1017")).toBeInTheDocument();
  expect(await screen.findByText("Referred to a handler")).toBeInTheDocument();
});

test("a claim's link opens its trace straight away", async () => {
  const fetchFn = fakeFetch({
    "GET /api/engineering/claims/CLM-1017/trace": () => [200, TRACE],
  });
  render(<TracePage api={createApi(fetchFn, () => "t")} claimId="CLM-1017" />);
  expect(await screen.findByText("Referred to a handler")).toBeInTheDocument();
  expect(fetchFn.calls.some((c) => c.path.includes("trace-suggestion"))).toBe(false);
});
