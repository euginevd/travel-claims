import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi } from "../api";
import { fakeFetch } from "../testing";
import { RisksTable } from "./RisksTable";

const COVERAGE = {
  redteam_run_at: "2026-11-09T01:00:00Z",
  threats: [
    {
      owasp: "LLM01",
      risk: "Prompt injection",
      atlas: "AML.T0051",
      control: "Hidden-instruction check",
      attacks: [
        { attack_id: "RT-01", name: "Receipt", passed: true },
        { attack_id: "RT-02", name: "Story", passed: false },
      ],
      last_fired: "2026-11-09T01:00:00Z",
      fired: 3,
    },
    {
      owasp: "LLM03",
      risk: "Supply chain",
      atlas: "",
      control: "Pinned",
      attacks: [],
      last_fired: null,
      fired: 0,
    },
  ],
  agents: [
    {
      agent: "Claim agent",
      model: "claude-sonnet-5-5",
      tools: "get_claim",
      sources: "context",
      worst_case: "Approves a claim it shouldn't",
      stopped_by: "The payout code",
    },
  ],
  payouts: {
    paused: true,
    changed_by: "Dana Whitfield",
    changed_at: "2026-11-09T01:00:00Z",
    reason: "Test",
  },
};

test("shows each risk with its tests and what fired, then the agents, after a retry", async () => {
  const user = userEvent.setup();
  let fail = true;
  const fetchFn = fakeFetch({
    "GET /api/engineering/threats": () => (fail ? [500, { detail: "Down" }] : [200, COVERAGE]),
  });
  render(<RisksTable api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findByRole("status")).toHaveTextContent("Down");
  fail = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText(/Prompt injection/)).toBeInTheDocument();
  expect(screen.getByText(/1 of 2 tested by an attack/)).toBeInTheDocument();
  expect(screen.getByLabelText("Held")).toBeInTheDocument();
  expect(screen.getByLabelText("Failed")).toBeInTheDocument();
  expect(screen.getByText("No attack yet")).toBeInTheDocument();
  expect(screen.getByText("3 times")).toBeInTheDocument();
  expect(screen.getByText("MITRE ATLAS AML.T0051")).toBeInTheDocument();
  expect(screen.getByRole("rowheader", { name: /Claim agent/ })).toBeInTheDocument();
});
