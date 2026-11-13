// Today, the verdict's next step, a handler deciding a referral, the agent switch, the reset and
// the spot check (docs/plan-dashboard.md).
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi, type AgentSwitch, type Api, type ClaimSummary } from "./api";
import { useState } from "react";
import { AgentToggle } from "./components/AgentSwitch";
import { DemoControls } from "./components/DemoControls";
import { StatusLine } from "./components/StatusLine";
import { draftRequest, headlineOf } from "./components/Verdict";
import { briefOf, todayFigures, TodayPage, whyOf } from "./pages/TodayPage";
import { ClaimPage } from "./pages/ClaimPage";
import { claim, DANA, fakeFetch, MARCUS, REFERRAL, SUMMARY } from "./testing";

const OFF: AgentSwitch = {
  on: false,
  changed_by: null,
  changed_at: null,
  working: 0,
  waiting: 3,
};

const referred: ClaimSummary = {
  ...SUMMARY,
  claim_id: "CLM-1003",
  status: "decided",
  decision: "refer",
  flag: "Receipt image: it couldn't be read",
  reason: "A receipt couldn't be read. A person should look.",
};
const held: ClaimSummary = {
  ...SUMMARY,
  claim_id: "CLM-1004",
  status: "waiting_for_sign_off",
  decision: "approve",
  payout: 2400,
};

test("the brief says where to start, and when the agent is off", () => {
  expect(briefOf([SUMMARY, referred], false, OFF).text).toMatch(
    /One claim needs you, and 1 is overdue\. Start with Maya Patel's trip delay claim: the agent stopped at/,
  );
  expect(briefOf([SUMMARY], true, OFF).text).toBe(
    "Nothing needs you yet. 1 claim waits for the agent.",
  );
  const senior = briefOf([held, referred], true, OFF);
  expect(senior.text).toMatch(/^One payout waits for your sign-off, \$2,400.00\./);
  expect(senior.start?.claim_id).toBe("CLM-1004");
  expect(briefOf([], false, { ...OFF, on: true }).text).toMatch(/agent is working the queue/);
});

test("each row says why it needs you, and the figures count today's work", () => {
  expect(whyOf(referred).why).toBe("Receipt image: it couldn't be read");
  expect(whyOf({ ...referred, review_requested: true, flag: null }).why).toBe(
    "Asked for a review of a decline",
  );
  expect(whyOf({ ...referred, documents_in: true }).why).toBe("What you asked for came in");
  expect(whyOf({ ...referred, stalled: true }).why).toBe("The agent stopped working it");
  expect(whyOf(held).agent).toBe("Agent approves $2,400.00");
  expect(todayFigures([SUMMARY, referred, held], false).map((f) => f.value)).toEqual([1, 1, 1, 0]);
});

test("the next step is drafted from the check that failed", () => {
  const found = claim({ status: "decided", decision: REFERRAL });
  expect(draftRequest(found).title).toBe("Ask Maya about: instructions hidden in the claim");
  const receipt = claim({
    status: "decided",
    decision: {
      ...REFERRAL,
      by_screening: false,
      checklist: [{ label: "Receipt image", result: "fail", detail: "", source: "Receipt 1" }],
    },
  });
  expect(draftRequest(receipt).text).toMatch(/couldn't read the receipt/);
  expect(headlineOf(receipt)).toBe("Referred to you.");
});

test("a handler sends the drafted request, or decides the referral within their limit", async () => {
  const user = userEvent.setup();
  const found = claim({ status: "decided", decision: { ...REFERRAL, by_screening: false } });
  const fetchFn = fakeFetch({
    "GET /api/staff/claims/CLM-1001": () => [200, found],
    "GET /api/staff/claims/CLM-1001/steps": () => [200, []],
    "GET /api/staff/claims": () => [200, [referred]],
    "POST /api/staff/claims/CLM-1001/requests": () => [200, found],
    "POST /api/staff/claims/CLM-1001/decide": () => [
      200,
      claim({ status: "decided", decision: { ...REFERRAL, decision: "decline" } }),
    ],
  });
  render(
    <ClaimPage
      api={createApi(fetchFn, () => "t")}
      claimId="CLM-1001"
      handler={MARCUS}
      pollMs={10}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "Send to Maya" }));
  await waitFor(() => {
    expect(fetchFn.calls.some((c) => c.path.endsWith("/requests"))).toBe(true);
  });
  expect(await screen.findByRole("link", { name: /Next: CLM-1003/ })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Approve" }));
  await user.type(screen.getByLabelText("Amount to pay (US dollars)"), "5000");
  await user.type(screen.getByLabelText("Note for the record"), "Checked");
  await user.click(screen.getByRole("button", { name: "Confirm decision" }));
  expect(screen.getByRole("alert")).toHaveTextContent("over your $1,000.00 limit");
  await user.selectOptions(screen.getByLabelText("Decision"), "Decline");
  await user.click(screen.getByRole("button", { name: "Confirm decision" }));
  await waitFor(() => {
    expect(fetchFn.calls.find((c) => c.path.endsWith("/decide"))?.body).toMatchObject({
      decision: "decline",
      payout: 0,
    });
  });
});

test("a senior handler turns the agent on; everyone else sees its state", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    "PUT /api/staff/agent": () => [200, { ...OFF, on: true, working: 2 }],
  });
  const api = createApi(fetchFn, () => "t");
  let seen: AgentSwitch | null = null;
  const { rerender } = render(<Toggle api={api} onState={(value) => (seen = value)} />);
  await user.click(screen.getByRole("button", { name: /Agent off/ }));
  await user.type(screen.getByLabelText(/Why\?/), "Starting the demo");
  await user.click(screen.getByRole("button", { name: "Turn the agent on" }));
  await waitFor(() => {
    expect(seen?.on).toBe(true);
  });
  rerender(
    <AgentToggle
      editing={false}
      onEditing={() => undefined}
      api={api}
      state={{ ...OFF, on: true, working: 2 }}
      senior={false}
      onState={() => undefined}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Agent on2");
});

test("the reset clears what's ticked, after a confirm", async () => {
  const user = userEvent.setup();
  const view = {
    claims_worked: 4,
    customer_claims: 1,
    evaluation_runs: 2,
    red_team_runs: 1,
    agent_on: true,
    payouts_paused: false,
    blocked: "turn the agent off first.",
    evaluations_blocked: "wait for the evaluation run to finish.",
    red_team_blocked: null,
  };
  const fetchFn = fakeFetch({
    "GET /api/staff/demo/reset": () => [200, view],
    "POST /api/staff/demo/reset": () => [200, { ...view, claims_worked: 0 }],
    "GET /api/staff/agent": () => [200, OFF],
  });
  render(<DemoControls api={createApi(fetchFn, () => "t")} onReset={() => undefined} />);
  await user.click(await screen.findByRole("checkbox", { name: /Evaluations/ }));
  expect(screen.getByText(/Not now: wait for the evaluation run/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reset the demo" })).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: /Evaluations/ }));
  await user.click(screen.getByRole("button", { name: "Reset the demo" }));
  await user.click(screen.getByRole("button", { name: "Yes, reset" }));
  expect(await screen.findByText("Reset. The demo starts fresh.")).toBeInTheDocument();
  expect(fetchFn.calls.find((c) => c.method === "POST")?.body).toEqual({
    claims: true,
    evaluations: false,
    red_team: false,
    agent_off: true,
    payouts_off: true,
  });
});

test("a senior's Today has sign-offs, findings and a spot check", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    "GET /api/staff/claims": () => [200, [held, referred]],
    "GET /api/staff/insights": () => [
      200,
      {
        noticed: [
          {
            headline: "Handlers kept 9 of the agent's last 10 decisions.",
            detail: "",
            claim_ids: [],
          },
        ],
        spot_checks: [
          {
            claim_id: "CLM-1009",
            customer_name: "Sofia Reyes",
            claim_type: "baggage",
            summary: "Camera snatched",
            payout: 930,
            reason: "Covered.",
          },
        ],
        paid_alone: 4,
      },
    ],
    "POST /api/staff/claims/CLM-1009/spot-check": () => [201, { verdict: "right" }],
  });
  render(<TodayPage api={createApi(fetchFn, () => "t")} handler={DANA} agent={OFF} />);
  expect(
    await screen.findByRole("heading", { name: "Waiting for your sign-off" }),
  ).toBeInTheDocument();
  expect(await screen.findByText(/Handlers kept 9/)).toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: "Looks right" }));
  expect(await screen.findByText("Looks right")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /Everything else/ }));
  expect(screen.getByRole("table")).toBeInTheDocument();
});

// The header's agent switch with its card's open state, as App holds it.
function Toggle({ api, onState }: { api: Api; onState: (value: AgentSwitch) => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <AgentToggle
      api={api}
      state={OFF}
      senior
      onState={onState}
      editing={editing}
      onEditing={setEditing}
    />
  );
}

test("the status line says what's off, and only a senior gets the way back on", () => {
  const off = {
    ...OFF,
    changed_by: "Dana",
    changed_at: "2026-11-13T05:00:00Z",
    reason: "Fresh start",
  };
  const live = { paused: false, changed_by: null, changed_at: null, reason: null };
  const paused = {
    paused: true,
    changed_by: "Dana",
    changed_at: "2026-11-13T06:00:00Z",
    reason: "Odd approvals",
  };
  const noop = () => undefined;
  const { rerender } = render(
    <StatusLine
      agent={{ ...OFF, on: true }}
      payouts={live}
      senior
      onTurnOn={noop}
      onResume={noop}
    />,
  );
  expect(screen.queryByRole("status")).toBeNull();
  rerender(<StatusLine agent={off} payouts={live} senior onTurnOn={noop} onResume={noop} />);
  expect(screen.getByRole("status")).toHaveTextContent("Agent off by Dana");
  expect(screen.getByRole("button", { name: "Turn the agent on" })).toBeInTheDocument();
  rerender(
    <StatusLine agent={off} payouts={paused} senior={false} onTurnOn={noop} onResume={noop} />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Agent off and payouts paused");
  expect(screen.getByRole("status")).toHaveTextContent("Odd approvals");
  expect(screen.queryByRole("button")).toBeNull();
  rerender(
    <StatusLine
      agent={{ ...OFF, on: true }}
      payouts={{ ...paused, changed_at: null }}
      senior
      onTurnOn={noop}
      onResume={noop}
    />,
  );
  expect(screen.getByRole("button", { name: "Resume payouts" })).toBeInTheDocument();
});

test("an open agent card keeps what the handler asked for when the status changes under it", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({ "PUT /api/staff/agent": () => [200, { ...OFF, on: true }] });
  const api = createApi(fetchFn, () => "t");
  const on: AgentSwitch = { ...OFF, on: true, working: 1 };
  function Polled({ state }: { state: AgentSwitch }) {
    const [editing, setEditing] = useState(false);
    return (
      <AgentToggle
        api={api}
        state={state}
        senior
        onState={() => undefined}
        editing={editing}
        onEditing={setEditing}
      />
    );
  }
  const { rerender } = render(<Polled state={on} />);
  await user.click(screen.getByRole("button", { name: /Agent on/ }));
  expect(screen.getByRole("button", { name: "Turn the agent off" })).toBeInTheDocument();
  // Another senior handler, or the daily budget, turns it off while the card is open.
  rerender(<Polled state={OFF} />);
  await waitFor(() => {
    expect(screen.queryByRole("button", { name: "Turn the agent off" })).not.toBeInTheDocument();
  });
  // The card closes; it never becomes "Turn the agent on" under the reason being typed.
  expect(screen.queryByRole("button", { name: "Turn the agent on" })).not.toBeInTheDocument();
  expect(fetchFn.calls.filter((c) => c.path.endsWith("/agent"))).toHaveLength(0);
});
