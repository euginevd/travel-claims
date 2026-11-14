// The console's home, the agents map, the audit log and a version's card (docs/plan-console.md).
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi, type AgentsMap, type Overview, type VersionCard } from "./api";
import { ControlPills } from "./components/ControlPills";
import { ReleaseHistory } from "./components/ReleaseHistory";
import { AgentsPage } from "./pages/AgentsPage";
import { AuditPage } from "./pages/AuditPage";
import { OverviewPage } from "./pages/OverviewPage";
import { VersionPage } from "./pages/VersionPage";
import { fakeFetch } from "./testing";

const OVERVIEW: Overview = {
  version: {
    version: 3,
    model: "claude-haiku-5-5",
    effort: "medium",
    since: "2026-11-12T06:40:00Z",
  },
  verdict: "watch",
  headline: "Passes 4 of 5 gates; the rest need more evidence.",
  gates: [
    {
      key: "held_out",
      label: "Held-out accuracy",
      detail: "25 claims",
      status: "pass",
      share: 0.84,
      claims: 25,
      target: 0.8,
      value: "84%",
      note: "target 80%",
      link: "scoreboard",
    },
    {
      key: "straight_through",
      label: "Decided without a person",
      detail: "live",
      status: "watch",
      share: 0.58,
      claims: 12,
      target: 0.7,
      value: "58%",
      note: "target 70%",
      link: "live",
    },
  ],
  brief: "v3 holds on every gate it has evidence for. Next: stop the stalled runs.",
  agent: {
    on: false,
    reason: "Fresh start",
    changed_by: "Dana",
    changed_at: null,
    working: 0,
    waiting: 25,
  },
  payouts: { paused: true, changed_by: "Dana", changed_at: null, reason: "Reset the demo" },
  attention: [
    { kind: "stalled", text: "2 runs stalled", link: "scoreboard", run_ids: [10, 12] },
    { kind: "review", text: "1 disagreement to review", link: "live", run_ids: [] },
  ],
};

test("the overview judges the gates and stops stalled runs", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    "GET /api/engineering/overview": () => [200, OVERVIEW],
    "POST /api/engineering/runs/10/stop": () => [200, { run_id: 10 }],
    "POST /api/engineering/runs/12/stop": () => [200, { run_id: 12 }],
  });
  render(<OverviewPage api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findByText(OVERVIEW.headline)).toBeInTheDocument();
  expect(screen.getByLabelText("Watch")).toBeInTheDocument();
  expect(screen.getByText(/likely 65–94%/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Stop them" }));
  await waitFor(() => {
    expect(fetchFn.calls.filter((c) => c.method === "POST")).toHaveLength(2);
  });
});

const MAP: AgentsMap = {
  days: 14,
  agent_on: true,
  payouts_paused: false,
  claim_agent_model: "claude-haiku-5-5",
  nodes: [
    {
      key: "api",
      label: "API",
      model: null,
      who: "system",
      calls: 4,
      detail: "checks",
      working: 0,
      failed: 0,
    },
    {
      key: "screening",
      label: "Hidden-instruction check",
      model: "claude-haiku-5-5",
      who: "system",
      calls: 4,
      detail: "4 read, 1 stopped",
      working: 0,
      failed: 1,
    },
    {
      key: "claim_agent",
      label: "Claim agent",
      model: "claude-haiku-5-5",
      who: "system",
      calls: 9,
      detail: "3 decided",
      working: 2,
      failed: 0,
    },
  ],
};

test("the agents map shows each agent, the gates and a card for the one picked", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    "GET /api/engineering/agents?days=14": () => [200, MAP],
    "GET /api/engineering/threats": () => [500, { detail: "Down" }],
  });
  render(<AgentsPage api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findByRole("button", { name: /Claim agent: 3 decided/ })).toBeInTheDocument();
  expect(screen.getByText("agent on")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /Hidden-instruction check/ }));
  expect(screen.getByRole("heading", { name: "Hidden-instruction check" })).toBeInTheDocument();
  expect(screen.getByText("Stopped")).toBeInTheDocument();
});

test("the audit log filters by kind, and a version shows its evidence", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    "GET /api/engineering/audit": () => [
      200,
      [
        {
          at: "2026-11-13T06:00:00Z",
          kind: "switch",
          label: "Agent switch",
          change: "on",
          reason: "Demo",
          by: "Dana",
        },
        {
          at: "2026-11-12T06:00:00Z",
          kind: "version",
          label: "v3",
          change: "haiku, medium · kept",
          reason: null,
          by: "Sam",
        },
      ],
    ],
    "GET /api/engineering/versions/3": () => [
      200,
      {
        version: 3,
        title: "Cheaper model: Sonnet → Haiku",
        model: "claude-haiku-5-5",
        effort: "medium",
        status: "kept",
        in_use: true,
        reason: "Cheaper, as accurate",
        diff: "-model: sonnet\n+model: haiku",
        parent_version: 1,
        proposed_by: "Improver",
        reviewed_by: "Sam",
        created_at: "2026-11-12T06:40:00Z",
        exam: {
          run_id: 9,
          claims: 25,
          accuracy: 0.84,
          payout_accuracy: 0.84,
          straight_through: 0.76,
          grade: 1.8,
          cost_per_claim: 0.004,
          seconds_per_claim: 25,
        },
        red_team: "Stopped 8 of 8 attacks",
        tools: ["get_claim"],
      },
    ],
  });
  const api = createApi(fetchFn, () => "t");
  const { unmount } = render(<AuditPage api={api} />);
  expect(await screen.findByText("“Demo”")).toBeInTheDocument();
  expect(screen.getByText("Agent switched on")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Settings/ })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Versions 1" }));
  expect(screen.queryByText("“Demo”")).toBeNull();
  await user.click(screen.getByRole("button", { name: "All 2" }));
  await user.type(screen.getByRole("searchbox", { name: "Search the log" }), "nobody");
  expect(screen.getByText("Nothing matches.")).toBeInTheDocument();
  await user.clear(screen.getByRole("searchbox", { name: "Search the log" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Who" }), "Sam");
  expect(screen.getByRole("columnheader", { name: "Why" })).toBeInTheDocument();
  expect(screen.queryByText("Agent switched on")).toBeNull();
  unmount();
  render(<VersionPage api={api} version={3} />);
  expect(await screen.findByText("Stopped 8 of 8 attacks")).toBeInTheDocument();
  expect(screen.getAllByText(/84% right · on more claims/)).toHaveLength(2);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "#3 Cheaper model: Sonnet → Haiku",
  );
});

test("the overview's other states: fit, nothing to attend to, no version, and a failed load", async () => {
  const [gate] = OVERVIEW.gates;
  if (!gate) throw new Error("The fixture has a gate");
  const fit: Overview = {
    ...OVERVIEW,
    version: { version: null, model: null, effort: null, since: null },
    verdict: "fit",
    headline: "Yes: passes all 5 gates.",
    gates: [
      { ...gate, status: "fail", key: "red_team", share: 0.5, claims: 8 },
      {
        ...gate,
        status: "none",
        key: "sign_off",
        share: null,
        claims: 0,
        link: "nowhere",
      },
    ],
    agent: { ...OVERVIEW.agent, on: true, working: 3, reason: null, changed_by: null },
    payouts: { ...OVERVIEW.payouts, paused: false, reason: null, changed_by: null },
    attention: [],
  };
  const { unmount } = render(
    <OverviewPage
      api={createApi(fakeFetch({ "GET /api/engineering/overview": () => [200, fit] }), () => "t")}
    />,
  );
  expect(await screen.findByText("Yes: passes all 5 gates.")).toBeInTheDocument();
  expect(screen.getByText(/No agent version in use/)).toBeInTheDocument();
  expect(screen.getByText("Nothing needs attention.")).toBeInTheDocument();
  expect(screen.getByLabelText("Fails")).toBeInTheDocument();
  unmount();
  render(
    <OverviewPage
      api={createApi(
        fakeFetch({ "GET /api/engineering/overview": () => [500, { detail: "Down" }] }),
        () => "t",
      )}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Down");
});

test("the map with payouts paused, the agent off, boundaries hidden and another period", async () => {
  const user = userEvent.setup();
  const quiet: AgentsMap = {
    ...MAP,
    agent_on: false,
    payouts_paused: true,
    nodes: MAP.nodes.map((node) => ({ ...node, working: 0, calls: 0 })),
  };
  const fetchFn = fakeFetch({
    "GET /api/engineering/agents?days=14": () => [200, quiet],
    "GET /api/engineering/agents?days=7": () => [200, quiet],
    "GET /api/engineering/threats": () => [
      200,
      {
        risks: [],
        agents: [
          {
            agent: "Claim agent",
            model: "m",
            tools: "get_claim",
            sources: "its claim",
            worst_case: "Pays wrongly",
            stopped_by: "The payout code",
          },
        ],
        payouts: { paused: true, changed_by: null, changed_at: null, reason: null },
      },
    ],
  });
  render(<AgentsPage api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findByText("agent off")).toBeInTheDocument();
  expect(screen.getByText("paused")).toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: "Trust boundaries" }));
  expect(screen.queryByText(/TB1/)).toBeNull();
  await user.click(screen.getByRole("radio", { name: "7 days" }));
  await waitFor(() => {
    expect(fetchFn.calls.some((c) => c.path.endsWith("days=7"))).toBe(true);
  });
});

test("an empty audit log, a failed one, and a version with no evidence yet", async () => {
  const fetchFn = fakeFetch({
    "GET /api/engineering/audit": () => [200, []],
    "GET /api/engineering/versions/4": () => [
      200,
      {
        version: 4,
        title: "Lower effort: medium → low",
        model: "claude-haiku-5-5",
        effort: "low",
        status: "rolled_back",
        in_use: false,
        reason: "Lower effort",
        diff: "",
        parent_version: null,
        proposed_by: "Improver",
        reviewed_by: null,
        created_at: "2026-11-12T06:40:00Z",
        exam: null,
        red_team: null,
        tools: [],
      },
    ],
    "GET /api/engineering/versions/5": () => [404, { detail: "No version 5" }],
  });
  const api = createApi(fetchFn, () => "t");
  const first = render(<AuditPage api={api} />);
  expect(await screen.findByText("Nothing recorded yet.")).toBeInTheDocument();
  first.unmount();
  const second = render(<VersionPage api={api} version={4} />);
  expect(await screen.findByText("No finished run of this version yet.")).toBeInTheDocument();
  expect(screen.getByText("The first version")).toBeInTheDocument();
  second.unmount();
  render(<VersionPage api={api} version={5} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("No version 5");
});

test("only the red team left to run, and a gate that fails", async () => {
  const [gate] = OVERVIEW.gates;
  if (!gate) throw new Error("The fixture has a gate");
  const partly: Overview = {
    ...OVERVIEW,
    version: { ...OVERVIEW.version, since: null },
    verdict: "not_fit",
    headline: "Not fit to run: agent version 3 fails on held-out accuracy.",
    gates: [
      { ...gate, status: "fail", share: 0.4 },
      { ...gate, key: "red_team", status: "none", share: null, claims: 0, note: "" },
    ],
    attention: [{ kind: "gap", text: "No attack tests LLM04", link: "elsewhere", run_ids: [] }],
  };
  render(
    <OverviewPage
      api={createApi(
        fakeFetch({ "GET /api/engineering/overview": () => [200, partly] }),
        () => "t",
      )}
      name="Sam Carter"
    />,
  );
  expect(await screen.findByText(partly.headline)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Run the red team" })).toHaveClass("button");
  expect(screen.queryByRole("link", { name: /Run the exam/ })).toBeNull();
  expect(screen.getByText("1 thing")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/, Sam$/);
});

test("the header shows the switches: green when on, red when off", async () => {
  const controls = (on: boolean) => ({
    agent: { ...OVERVIEW.agent, on, working: on ? 2 : 0 },
    payouts: { ...OVERVIEW.payouts, paused: !on },
  });
  const first = render(
    <ControlPills
      api={createApi(
        fakeFetch({ "GET /api/engineering/controls": () => [200, controls(true)] }),
        () => "t",
      )}
    />,
  );
  expect(await screen.findByText("Agent on · 2 working")).toBeInTheDocument();
  expect(screen.getByText("Payouts live").parentElement).toHaveClass("is-on");
  first.unmount();
  render(
    <ControlPills
      api={createApi(
        fakeFetch({ "GET /api/engineering/controls": () => [200, controls(false)] }),
        () => "t",
      )}
    />,
  );
  expect(await screen.findByText("Agent off")).toBeInTheDocument();
  expect(screen.getByText("Payouts paused").parentElement).toHaveClass("is-off");
});

test("the audit log shows the newest 20, then 20 more a tap", async () => {
  const user = userEvent.setup();
  const entries = Array.from({ length: 25 }, (_, i) => ({
    at: "2026-11-13T06:00:00Z",
    kind: "setting",
    label: "Setting",
    change: `change ${String(i)}`,
    reason: null,
    by: "Dana",
  }));
  render(
    <AuditPage
      api={createApi(fakeFetch({ "GET /api/engineering/audit": () => [200, entries] }), () => "t")}
    />,
  );
  expect(await screen.findByText("Showing 20 of 25")).toBeInTheDocument();
  expect(screen.queryByText("Change 20")).toBeNull();
  expect(screen.getByRole("link", { name: "Export" })).toHaveAttribute("download", "audit-log.csv");
  await user.click(screen.getByRole("button", { name: "Show 5 more" }));
  expect(screen.getByText("Change 24")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /more/ })).toBeNull();
});

test("the release history names each version by its change, with its evidence", async () => {
  const card = (version: number, over: Partial<VersionCard>): VersionCard => ({
    version,
    title: "First version",
    model: "claude-sonnet-5-5",
    effort: "medium",
    status: "kept",
    in_use: false,
    reason: "",
    diff: "",
    parent_version: null,
    proposed_by: "UnderCover Agent",
    reviewed_by: null,
    created_at: "2026-11-12T06:40:00Z",
    exam: null,
    red_team: null,
    tools: [],
    ...over,
  });
  const cards = [
    card(4, {
      title: "Lower effort",
      status: "rejected",
      parent_version: 3,
      proposed_by: "Improver",
    }),
    card(3, {
      title: "Cheaper model: Sonnet → Haiku",
      in_use: true,
      parent_version: 1,
      proposed_by: "Improver",
      reviewed_by: "Sam Carter",
      red_team: "Stopped 8 of 8 attacks",
      exam: {
        run_id: 9,
        claims: 25,
        accuracy: 0.84,
        payout_accuracy: 0.84,
        straight_through: 0.76,
        grade: null,
        cost_per_claim: 0.004,
        seconds_per_claim: 25,
      },
    }),
    card(2, { title: "Same as #1", status: "rolled_back", parent_version: 1, reason: "Slower" }),
    card(1, {}),
  ];
  render(
    <ReleaseHistory
      api={createApi(fakeFetch({ "GET /api/engineering/versions": () => [200, cards] }), () => "t")}
    />,
  );
  expect(await screen.findByText("84% right on 25 claims")).toBeInTheDocument();
  expect(screen.getByText("In use")).toBeInTheDocument();
  expect(screen.getByText("Rolled back")).toBeInTheDocument();
  expect(
    screen.getByText(/Proposed by the Improver agent · approved by Sam Carter/),
  ).toBeInTheDocument();
  expect(screen.getByText("Rejected proposals (1)")).toBeInTheDocument();
  expect(screen.getByText(/The version the team started with/)).toBeInTheDocument();
});

test("the audit export never hands a spreadsheet a formula", async () => {
  const { auditCsv } = await import("./pages/AuditPage");
  const csv = auditCsv([
    {
      ref: "switch:1",
      at: "2026-11-13T01:00:00+00:00",
      kind: "switch",
      label: "Agent switch",
      change: "off",
      before: null,
      reason: '=HYPERLINK("http://x","click")',
      by: "Dana Whitfield",
    },
  ]);
  expect(csv).toContain(`"'=HYPERLINK(""http://x"",""click"")"`);
  expect(csv).toContain('"Dana Whitfield"');
});
