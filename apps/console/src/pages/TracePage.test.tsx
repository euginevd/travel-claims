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
  expect(await screen.findByText(/2 model calls/)).toBeInTheDocument();
  expect(screen.getByText("$0.0125")).toBeInTheDocument();
  expect(screen.getByText("2.4s")).toBeInTheDocument();
  await user.clear(screen.getByLabelText("Claim"));
  await user.type(screen.getByLabelText("Claim"), "CLM-9");
  await user.click(screen.getByRole("button", { name: /Show/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Claim CLM-9 not found");
});
