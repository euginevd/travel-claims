import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi } from "../api";
import { fakeFetch } from "../testing";
import { RisksTable } from "./RisksTable";

function row(id: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    was: "",
    risk: `Risk ${id}`,
    atlas: "",
    control: "A control",
    note: "",
    status,
    attacks: [],
    last_fired: null,
    fired: 0,
    ...extra,
  };
}

const COVERAGE = {
  redteam_run_at: "2026-11-09T01:00:00Z",
  frameworks: [
    {
      key: "llm",
      name: "OWASP LLM Top 10",
      version: "2026",
      risks: [
        row("LLM01", "failing", {
          risk: "Prompt injection",
          atlas: "AML.T0051",
          attacks: [
            { attack_id: "RT-01", name: "Receipt", passed: true },
            { attack_id: "RT-02", name: "Story", passed: false },
          ],
          last_fired: "2026-11-09T01:00:00Z",
          fired: 3,
        }),
        row("LLM03", "tested", {
          risk: "Excessive agency",
          was: "LLM06",
          attacks: [{ attack_id: "RT-06", name: "Inflation", passed: true }],
        }),
        row("LLM04", "built_in", { note: "Checked on every PR, not by an attack" }),
        row("LLM06", "gap"),
      ],
      mapped: 4,
      tested: 2,
      failing: 1,
      built_in: 1,
      gaps: 1,
    },
    {
      key: "maestro",
      name: "CSA MAESTRO",
      version: "seven layers",
      risks: [row("L1", "tested", { risk: "Foundation models" })],
      mapped: 1,
      tested: 1,
      failing: 0,
      built_in: 0,
      gaps: 0,
    },
  ],
  agents: [],
  payouts: { paused: false, changed_by: null, changed_at: null, reason: null },
};

test("shows each framework's coverage and status, switching between them, after a retry", async () => {
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
  expect(
    screen.getByText(
      "OWASP LLM Top 10: 4 of 4 mapped · 2 tested · 1 got through · 1 built in · 1 gap",
    ),
  ).toBeInTheDocument();
  expect(screen.getByText("was LLM06 (2025)")).toBeInTheDocument();
  expect(screen.getByLabelText("Failed")).toBeInTheDocument();
  expect(screen.getByText("Got through")).toBeInTheDocument();
  expect(screen.getByText("Gap")).toBeInTheDocument();
  expect(screen.getByText("Checked on every PR, not by an attack")).toBeInTheDocument();
  expect(screen.getByText("3 times")).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: /MAESTRO/ }));
  expect(screen.getByRole("columnheader", { name: "Layer" })).toBeInTheDocument();
  expect(screen.getByText(/Foundation models/)).toBeInTheDocument();
  expect(screen.queryByText(/Prompt injection/)).toBeNull();
});
