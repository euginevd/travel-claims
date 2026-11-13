// The control plane's additions: alerts, budgets, recent traces, shadow tests, the Overview's
// widgets and the red team's attack list (docs/features.md 20a, 25, 26, 28c to 28e, 29).
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi, type AgentsMap, type Budget, type VersionCard } from "./api";
import { AlertBell } from "./components/AlertBell";
import { ExamGrowth } from "./components/ExamGrowth";
import { AgentsWidget, AlertsList, KpiRow, ReleasesWidget } from "./components/OverviewWidgets";
import { RecentTraces } from "./components/RecentTraces";
import { ReleaseHistory } from "./components/ReleaseHistory";
import { TrendsPanels } from "./components/TrendsPanels";
import { AgentsPage, pathOf } from "./pages/AgentsPage";
import { AuditPage } from "./pages/AuditPage";
import { CostPage } from "./pages/CostPage";
import { RedTeamPage } from "./pages/RedTeamPage";
import { fakeFetch } from "./testing";

const ALERTS = [
  { severity: "high", text: "The agent stopped: Daily budget of $5.00 reached", link: "budgets" },
  { severity: "medium", text: "2 runs stalled", link: "elsewhere" },
];

const BUDGET: Budget = {
  limit: 5,
  spent_today: 5.2,
  share: 1.04,
  by_model: [{ model: "claude-haiku-5-5", calls: 40, cost: 5.2 }],
  changed_by: "Sam Carter",
  changed_at: "2026-11-13T06:00:00Z",
};

const CARD: VersionCard = {
  version: 3,
  title: "Cheaper model: Sonnet → Haiku",
  model: "claude-haiku-5-5",
  effort: "medium",
  status: "kept",
  in_use: true,
  reason: "",
  diff: "",
  parent_version: 1,
  proposed_by: "Improver",
  reviewed_by: "Sam Carter",
  created_at: "2026-11-12T06:40:00Z",
  exam: null,
  red_team: null,
  tools: [],
};

const MAP: AgentsMap = {
  days: 14,
  agent_on: true,
  payouts_paused: false,
  claim_agent_model: "claude-haiku-5-5",
  nodes: [
    {
      key: "claim_agent",
      label: "Claim agent",
      model: "claude-haiku-5-5",
      who: "system",
      calls: 3,
      detail: "1 decided",
      working: 1,
      failed: 0,
    },
  ],
};

test("the bell counts the alerts and opens them; with none it says so", async () => {
  const user = userEvent.setup();
  const first = render(
    <AlertBell
      api={createApi(fakeFetch({ "GET /api/engineering/alerts": () => [200, ALERTS] }), () => "t")}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "2 alerts" }));
  const list = screen.getByRole("region", { name: "Alerts" });
  expect(within(list).getByRole("link", { name: /budget of \$5.00/ })).toHaveAttribute(
    "href",
    "#/cost",
  );
  expect(within(list).getByRole("link", { name: "2 runs stalled" })).toHaveAttribute(
    "href",
    "#/overview",
  );
  await user.click(within(list).getByRole("link", { name: "2 runs stalled" }));
  expect(screen.queryByRole("region", { name: "Alerts" })).toBeNull();
  first.unmount();
  render(
    <AlertBell
      api={createApi(fakeFetch({ "GET /api/engineering/alerts": () => [200, []] }), () => "t")}
    />,
  );
  await user.click(await screen.findByRole("button", { name: "No alerts" }));
  expect(screen.getByText("Nothing needs you now.")).toBeInTheDocument();
});

const COSTS = {
  days: [
    { day: "2026-11-13", live: 0.2, redteam: 0, evaluation: 0.1, assistants: 0.05, total: 0.35 },
    { day: "2026-11-14", live: 0.5, redteam: 0.1, evaluation: 0, assistants: 0, total: 0.6 },
  ],
  by_source: [
    { key: "live", label: "Live claims", calls: 40, cost: 0.7 },
    { key: "wattle", label: "Wattle", calls: 3, cost: 0.05 },
    { key: "copilot", label: "Copilot", calls: 0, cost: 0 },
  ],
  period_total: 0.95,
  today: 0.6,
  month_to_date: 2.4,
  projected_month: 5.14,
  cost_per_claim: 0.035,
  dearest: [{ claim_id: "CLM-1024", kind: "live", calls: 14, cost: 0.12 }],
};

test("cost shows the spend at a glance, where it goes and the dearest claims", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    "GET /api/engineering/budget": () => [200, BUDGET],
    "GET /api/engineering/costs?days=14": () => [200, COSTS],
    "GET /api/engineering/costs?days=30": () => [200, { ...COSTS, month_to_date: 9 }],
  });
  render(<CostPage api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findByText("On course for $5.14 by the month's end")).toBeInTheDocument();
  expect(screen.getByText("Live claims")).toBeInTheDocument();
  expect(screen.queryByText("Copilot")).toBeNull();
  expect(screen.getByRole("link", { name: "CLM-1024" })).toHaveAttribute(
    "href",
    "#/trace/CLM-1024",
  );
  await user.click(screen.getByRole("radio", { name: "30 days" }));
  expect(await screen.findByText("$9.00")).toBeInTheDocument();
});

test("budgets show today's spend by model, refuse a silly budget and save one", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    "GET /api/engineering/budget": () => [200, BUDGET],
    "PUT /api/engineering/budget": () => [200, { ...BUDGET, limit: 8, share: 0.65 }],
  });
  render(<CostPage api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findAllByText("Budget reached")).not.toHaveLength(0);
  expect(screen.getByRole("rowheader", { name: /haiku/i })).toBeInTheDocument();
  expect(screen.getByText(/Last set by Sam Carter/)).toBeInTheDocument();
  const limit = screen.getByLabelText("Dollars a day");
  await user.clear(limit);
  await user.type(limit, "0.1");
  await user.click(screen.getByRole("button", { name: "Save the budget" }));
  expect(screen.getByRole("alert")).toHaveTextContent("between $0.50 and $1,000");
  await user.clear(limit);
  await user.type(limit, "8");
  await user.type(screen.getByLabelText("Why? (optional)"), "Busy week");
  await user.click(screen.getByRole("button", { name: "Save the budget" }));
  expect(await screen.findAllByText("Within budget")).not.toHaveLength(0);
  expect(fetchFn.calls.find((c) => c.method === "PUT")?.body).toEqual({
    limit: 8,
    reason: "Busy week",
  });
});

test("a budget with no spend, nearly spent, and one that fails to load", async () => {
  const quiet = { ...BUDGET, spent_today: 4.1, share: 0.82, by_model: [], changed_by: null };
  const first = render(
    <CostPage
      api={createApi(fakeFetch({ "GET /api/engineering/budget": () => [200, quiet] }), () => "t")}
    />,
  );
  expect(await screen.findAllByText("Nearly spent")).not.toHaveLength(0);
  expect(screen.getByText("No model calls yet today.")).toBeInTheDocument();
  expect(screen.getByText(/no one has changed it/)).toBeInTheDocument();
  first.unmount();
  render(
    <CostPage
      api={createApi(
        fakeFetch({ "GET /api/engineering/budget": () => [500, { detail: "Down" }] }),
        () => "t",
      )}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Down");
});

test("recent traces list each claim the agent worked, and say how to make one", async () => {
  const rows = [
    {
      claim_id: "CLM-1031",
      summary: "Bag delayed",
      status: "paid",
      red_team: false,
      model_calls: 9,
      tokens: 12000,
      cost: 0.0213,
      seconds: 14.2,
      started_at: "2026-11-13T06:00:00Z",
    },
    {
      claim_id: "CLM-1032",
      summary: "Attack",
      status: "some_new_status",
      red_team: true,
      model_calls: 2,
      tokens: 900,
      cost: 0.001,
      seconds: 3,
      started_at: "2026-11-13T06:10:00Z",
    },
  ];
  const first = render(
    <RecentTraces
      api={createApi(fakeFetch({ "GET /api/engineering/traces": () => [200, rows] }), () => "t")}
    />,
  );
  const table = await screen.findByRole("region", { name: "Recent traces table" });
  expect(within(table).getByRole("link", { name: "CLM-1031" })).toHaveAttribute(
    "href",
    "#/trace/CLM-1031",
  );
  expect(within(table).getByText("Paid")).toBeInTheDocument();
  expect(within(table).getByText("some new status")).toBeInTheDocument();
  expect(within(table).getByText("Red team")).toBeInTheDocument();
  first.unmount();
  render(
    <RecentTraces
      api={createApi(fakeFetch({ "GET /api/engineering/traces": () => [200, []] }), () => "t")}
    />,
  );
  expect(await screen.findByText(/No claim has been worked yet/)).toBeInTheDocument();
});

test("a version not in use can be shadow-tested; a refusal says why", async () => {
  const user = userEvent.setup();
  let refuse = true;
  const earlier = {
    ...CARD,
    version: 1,
    title: "First version",
    in_use: false,
    parent_version: null,
  };
  const fetchFn = fakeFetch({
    "GET /api/engineering/versions": () => [200, [CARD, earlier]],
    "POST /api/engineering/shadow": () =>
      refuse
        ? [409, { detail: "A shadow run needs at least 3 decided live claims" }]
        : [201, { run_id: 12 }],
  });
  render(<ReleaseHistory api={createApi(fetchFn, () => "t")} />);
  await user.click(await screen.findByRole("button", { name: "Shadow-test" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("at least 3 decided live claims");
  expect(fetchFn.calls.find((c) => c.method === "POST")?.body).toEqual({ version: 1, claims: 10 });
  refuse = false;
  await user.click(screen.getByRole("button", { name: "Shadow-test" }));
  await waitFor(() => {
    expect(fetchFn.calls.filter((c) => c.method === "POST")).toHaveLength(2);
  });
});

test("the overview's widgets: spend, guardrails, the map, alerts and releases", async () => {
  const fetchFn = fakeFetch({
    "GET /api/engineering/budget": () => [200, BUDGET],
    "GET /api/engineering/detections?days=14": () => [
      200,
      {
        days: 14,
        since: "2026-10-30",
        counts: {
          guardrail: 0,
          hidden_instruction: 2,
          refusal: 0,
          held: 1,
          output: 0,
          guardian: 0,
        },
        events: [],
        guardrails: [],
        red_teamed: true,
      },
    ],
    "GET /api/engineering/agents?days=14": () => [200, MAP],
    "GET /api/engineering/alerts": () => [200, ALERTS],
    "GET /api/engineering/versions": () => [
      200,
      [
        CARD,
        {
          ...CARD,
          version: 4,
          title: "Lower effort",
          in_use: false,
          status: "candidate",
          red_team: "Stopped 8 of 8 attacks",
          exam: {
            run_id: 9,
            claims: 25,
            accuracy: 0.84,
            payout_accuracy: 0.84,
            straight_through: 0.7,
            grade: null,
            cost_per_claim: 0.004,
            seconds_per_claim: 20,
          },
        },
      ],
    ],
  });
  const api = createApi(fetchFn, () => "t");
  render(
    <>
      <KpiRow api={api} />
      <AgentsWidget api={api} />
      <AlertsList api={api} />
      <ReleasesWidget api={api} />
    </>,
  );
  expect(await screen.findByText("$5.20")).toBeInTheDocument();
  expect(await screen.findByText("3")).toBeInTheDocument();
  expect(screen.getByText(/red-teamed$/)).toBeInTheDocument();
  expect(await screen.findByText("#4 Lower effort")).toBeInTheDocument();
  expect(screen.getByText("84% right on 25 claims · Stopped 8 of 8 attacks")).toBeInTheDocument();
  expect(screen.getByText("Being tested")).toBeInTheDocument();
  expect(await screen.findByText("2 runs stalled")).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: /Claim agent/ })).toBeInTheDocument();
});

test("before any run, the red team lists the attacks it will make", async () => {
  const fetchFn = fakeFetch({
    "GET /api/engineering/redteam": () => [
      200,
      { running: false, started_at: null, started_by: null, report: null },
    ],
    "GET /api/engineering/redteam/attacks": () => [
      200,
      [
        {
          attack_id: "RT-01",
          name: "Instruction printed on a receipt image",
          technique: "Visible text tells the AI to approve",
          owasp: "LLM01, ASI01",
        },
      ],
    ],
  });
  render(<RedTeamPage api={createApi(fetchFn, () => "t")} />);
  const table = await screen.findByRole("region", { name: "Planned attacks table" });
  expect(within(table).getByText("Instruction printed on a receipt image")).toBeInTheDocument();
  expect(within(table).getByText("Not run")).toBeInTheDocument();
  expect(screen.getByText(/The 1 attacks below/)).toBeInTheDocument();
});

test("the exam grows from claims a person decided, toward its target", async () => {
  const user = userEvent.setup();
  let size = 25;
  const fetchFn = fakeFetch({
    "GET /api/engineering/live/exam-growth": () => [
      200,
      {
        exam_size: size,
        target: 100,
        candidates:
          size > 25
            ? []
            : [
                {
                  claim_id: "CLM-1040",
                  claim_type: "baggage",
                  summary: "Bag lost",
                  decision: "approve",
                  payout: 120,
                  decided_by: "Dana Whitfield",
                  decided_at: "2026-11-13T06:00:00Z",
                },
              ],
      },
    ],
    "POST /api/engineering/live/claims/CLM-1040/add-to-exam": () => {
      size = 26;
      return [
        200,
        {
          claim_id: "CLM-1040",
          label_set: "held_out",
          status: "added",
          decision: "approve",
          payout: 120,
          added_by: "Sam",
          added_at: null,
        },
      ];
    },
  });
  render(<ExamGrowth api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findByText("25 of 100 claims")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Add to the exam" }));
  expect(await screen.findByText("26 of 100 claims")).toBeInTheDocument();
  expect(screen.getByText(/No claim a person decided is waiting/)).toBeInTheDocument();
});

test("the audit log says its chain is intact, or which records changed", async () => {
  const entry = {
    ref: "setting:1",
    at: "2026-11-13T06:00:00Z",
    kind: "setting",
    label: "Approval limit",
    change: "1500",
    before: "1000",
    reason: null,
    by: "Dana",
  };
  const chain = (intact: boolean) => ({
    sealed: 1,
    intact,
    changed: intact ? [] : ["setting:1"],
    missing: [],
    broken_at: intact ? null : 1,
  });
  const first = render(
    <AuditPage
      api={createApi(
        fakeFetch({
          "GET /api/engineering/audit": () => [200, [entry]],
          "GET /api/engineering/audit/chain": () => [200, chain(true)],
        }),
        () => "t",
      )}
    />,
  );
  expect(
    await screen.findByText(/1 entries sealed in a SHA-256 hash chain · intact/),
  ).toBeInTheDocument();
  expect(screen.getByText("was 1000")).toBeInTheDocument();
  first.unmount();
  render(
    <AuditPage
      api={createApi(
        fakeFetch({
          "GET /api/engineering/audit": () => [200, [entry]],
          "GET /api/engineering/audit/chain": () => [200, chain(false)],
        }),
        () => "t",
      )}
    />,
  );
  expect(
    await screen.findByText(/Changed after sealing: setting:1 · chain broken at seal 1/),
  ).toBeInTheDocument();
});

test("a claim's path lights the parts it went through", async () => {
  const user = userEvent.setup();
  const trace = {
    steps: [
      { step_id: 1, kind: "screening", content: "Clear", created_at: "2026-11-13T06:00:00Z" },
      {
        step_id: 2,
        kind: "tool_call",
        content: "check_documents",
        created_at: "2026-11-13T06:00:01Z",
      },
    ],
    model_calls: [],
    total_cost: 0,
    total_tokens: 0,
    summary: "Bag",
    status: "waiting_for_sign_off",
    outcome: {
      decision: "approve",
      payout: 2000,
      section: "4",
      reason: "ok",
      decided_by: "UnderCover Agent v3",
      decided_at: "2026-11-13T06:01:00Z",
    },
    config_version: 3,
    average_cost: null,
  };
  const path = pathOf(trace as never);
  expect([...path].sort()).toEqual([
    "api",
    "claim_agent",
    "context",
    "drafting",
    "payout",
    "portal",
    "screening",
    "sign_off",
    "specialists",
  ]);
  const fetchFn = fakeFetch({
    "GET /api/engineering/agents?days=14": () => [200, MAP],
    "GET /api/engineering/threats": () => [500, { detail: "Down" }],
    "GET /api/engineering/claims/CLM-1/trace": () => [200, trace],
    "GET /api/engineering/claims/CLM-2/trace": () => [404, { detail: "No claim CLM-2" }],
  });
  render(<AgentsPage api={createApi(fetchFn, () => "t")} />);
  const box = await screen.findByLabelText("Follow a claim");
  await user.type(box, "clm-1");
  await user.click(screen.getByRole("button", { name: "Show its path" }));
  expect(await screen.findByText(/Lit: the 9 parts/)).toBeInTheDocument();
  await user.clear(box);
  await user.type(box, "CLM-2");
  await user.click(screen.getByRole("button", { name: "Show its path" }));
  expect(await screen.findByText("No claim CLM-2")).toBeInTheDocument();
  await user.clear(box);
  await user.click(screen.getByRole("button", { name: "Clear" }));
  expect(screen.queryByText(/Lit:/)).toBeNull();
});

test("each agent's days and the weeks show, an unusual day marked", async () => {
  const day = (calls: number) => ({ day: "2026-11-13", calls, cost: 0.01 });
  const trends = {
    agents: [
      {
        key: "claim_agent",
        label: "Claim agent",
        days: [day(2), day(30)],
        today: 30,
        usual: 2,
        unusual: true,
      },
      {
        key: "wattle",
        label: "Wattle",
        days: [day(1), day(1)],
        today: 1,
        usual: 1,
        unusual: false,
      },
    ],
    weeks: [
      {
        week_of: "2026-11-09",
        decided: 4,
        straight_through_share: 0.5,
        disagreement_rate: null,
        cost_per_claim: 0.02,
      },
      {
        week_of: "2026-11-02",
        decided: 0,
        straight_through_share: null,
        disagreement_rate: null,
        cost_per_claim: null,
      },
    ],
  };
  const first = render(
    <TrendsPanels
      api={createApi(fakeFetch({ "GET /api/engineering/trends": () => [200, trends] }), () => "t")}
    />,
  );
  expect(await screen.findByText("Unusual")).toBeInTheDocument();
  expect(screen.getByText("Normal")).toBeInTheDocument();
  const weeks = screen.getByRole("region", { name: "Weekly table" });
  expect(within(weeks).getByText("50%")).toBeInTheDocument();
  expect(within(weeks).getByText("$0.0200")).toBeInTheDocument();
  first.unmount();
  render(
    <TrendsPanels
      api={createApi(
        fakeFetch({
          "GET /api/engineering/trends": () => [200, { agents: [], weeks: [trends.weeks[1]] }],
        }),
        () => "t",
      )}
    />,
  );
  expect(
    await screen.findByText(/No live claims decided in the last eight weeks/),
  ).toBeInTheDocument();
});
