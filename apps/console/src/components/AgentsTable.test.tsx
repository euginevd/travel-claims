import { render, screen } from "@testing-library/react";
import { AgentsTable } from "./AgentsTable";

const AGENT = {
  agent: "Claim agent",
  model: "claude-sonnet-5-5",
  tools: "get_claim, record_decision",
  sources: "its own claim and customer",
  worst_case: "Approves a claim it shouldn't, up to the approval limit",
  stopped_by: "The payout is worked out in code",
};

test("shows each agent's worst case and what stops it", () => {
  render(<AgentsTable agents={[AGENT]} />);
  expect(screen.getByRole("rowheader", { name: /Claim agent/ })).toBeInTheDocument();
  expect(screen.getByText(/up to the approval limit/)).toBeInTheDocument();
  expect(screen.getByText("The payout is worked out in code")).toBeInTheDocument();
});

test("says when no agents are listed", () => {
  render(<AgentsTable agents={[]} />);
  expect(screen.getByText("No agents are listed.")).toBeInTheDocument();
});
