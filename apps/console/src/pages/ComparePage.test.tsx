// Compare models (docs/features.md 21a): pick models, run them on the same claims, read the answer.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi, type CompareResult, type Comparison, type ModelChoice } from "../api";
import { fakeFetch } from "../testing";
import { ComparePage, estimate, perClaim } from "./ComparePage";

const model = (id: string, label: string, extra: Partial<ModelChoice> = {}): ModelChoice => ({
  id,
  label,
  input_price: 1,
  output_price: 5,
  efforts: ["low", "medium", "high", "xhigh", "max"],
  default_effort: "high",
  speed: "Fast",
  good_for: "Everyday work",
  may_decline: false,
  offered: true,
  in_use: false,
  in_use_effort: null,
  cost_per_claim: 0.05,
  ...extra,
});

const MODELS = [
  model("claude-haiku-5-5", "Haiku 5.5", {
    in_use: true,
    in_use_effort: "medium",
    cost_per_claim: 0.005,
  }),
  model("claude-sonnet-5-5", "Sonnet 5.5"),
  model("claude-opus-5-5", "Opus 5.5", { offered: false }),
  model("claude-fable-5-2", "Fable 5.2", { may_decline: true, cost_per_claim: 0.38 }),
];

const result = (extra: Partial<CompareResult>): CompareResult => ({
  model: "claude-haiku-5-5",
  label: "Haiku 5.5",
  effort: "medium",
  version: 3,
  in_use: true,
  runs: [21],
  finished: 1,
  planned: 1,
  claims: 5,
  accuracy: 0.8,
  low: 0.38,
  high: 0.96,
  by_run: [0.8],
  payout_accuracy: 0.8,
  straight_through: 0.6,
  declined: 0,
  grade: 1.8,
  cost_per_claim: 0.005,
  seconds_per_claim: 26,
  tokens_per_claim: 11000,
  passes: true,
  ...extra,
});

const COMPARISON: Comparison = {
  compare_id: 1,
  size: "tiny",
  repeats: 1,
  status: "finished",
  started_by: "Sam Carter",
  started_at: "2026-11-14T02:00:00Z",
  accuracy_target: 0.8,
  straight_through_target: 0.5,
  results: [
    result({}),
    result({
      model: "claude-fable-5-2",
      label: "Fable 5.2",
      effort: "high",
      in_use: false,
      runs: [22],
      accuracy: 1,
      low: 0.57,
      high: 1,
      by_run: [1],
      cost_per_claim: 0.38,
      grade: 2.7,
    }),
  ],
  answer:
    "Haiku 5.5 at medium is enough: it meets the targets for the least, and the others' ranges overlap it.",
  cheapest_pass: "claude-haiku-5-5:medium",
  differences: [
    {
      claim_id: "CLM-1014",
      claim_type: "trip_delay",
      handler_decision: "approve",
      handler_payout: 250,
      marks: [
        {
          model: "claude-haiku-5-5",
          label: "Haiku 5.5",
          effort: "medium",
          decision: "refer",
          payout: null,
          right: false,
        },
        {
          model: "claude-fable-5-2",
          label: "Fable 5.2",
          effort: "high",
          decision: "approve",
          payout: 250,
          right: true,
        },
      ],
    },
  ],
  compared_claims: 5,
};

test("the answer, the chart, a card a model and the claims decided differently", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    "GET /api/engineering/compare/models": () => [200, MODELS],
    "GET /api/engineering/compare/latest": () => [200, COMPARISON],
    "POST /api/engineering/compare/propose": () => [201, { round_id: 9 }],
  });
  render(<ComparePage api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findByText(/Haiku 5.5 at medium is enough/)).toBeInTheDocument();
  expect(
    screen.getByRole("img", { name: /Fable 5.2 high: 100% right at \$0.38/ }),
  ).toBeInTheDocument();
  expect(screen.getByText("Cheapest pass")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "CLM-1014" })).toHaveAttribute(
    "href",
    "#/trace/CLM-1014",
  );
  // Opus isn't offered here, so it can't be ticked; the model in use starts ticked.
  expect(screen.getByRole("checkbox", { name: "Compare Opus 5.5" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "Compare Haiku 5.5" })).toBeChecked();
  const fable = screen.getByText("Fable 5.2", { selector: ".compare-card b" }).closest("article");
  expect(fable).not.toBeNull();
  await user.click(within(fable as HTMLElement).getByRole("button", { name: "Propose" }));
  expect(fetchFn.calls.find((c) => c.method === "POST")?.body).toEqual({
    model: "claude-fable-5-2",
    effort: "high",
  });
});

test("compare sends the picks with their efforts, the claims and the runs each", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    "GET /api/engineering/compare/models": () => [200, MODELS],
    "GET /api/engineering/compare/latest": () => [200, null],
    "POST /api/engineering/compare": () => [
      201,
      { ...COMPARISON, status: "running", answer: null, cheapest_pass: null, results: [] },
    ],
  });
  render(<ComparePage api={createApi(fetchFn, () => "t")} />);
  await user.click(await screen.findByRole("checkbox", { name: "Compare Fable 5.2" }));
  expect(screen.getByRole("radio", { name: "25" })).toBeDisabled();
  await user.click(
    within(screen.getByRole("group", { name: "Fable 5.2 effort" })).getByRole("radio", {
      name: "max",
    }),
  );
  await user.click(screen.getByRole("radio", { name: "2" }));
  expect(screen.getByText("About $3.85")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Compare" }));
  expect(fetchFn.calls.find((c) => c.method === "POST")?.body).toEqual({
    picks: [
      { model: "claude-haiku-5-5", effort: "medium" },
      { model: "claude-fable-5-2", effort: "max" },
    ],
    size: "tiny",
    repeats: 2,
  });
  expect(await screen.findByText(/Running: the first model/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
});

test("an estimate is each pick's cost a claim times the claims and runs", () => {
  expect(estimate(MODELS, { "claude-haiku-5-5": "medium" }, 25, 2)).toBeCloseTo(0.25);
  expect(perClaim(0.0048)).toBe("$0.005");
  expect(perClaim(0.38)).toBe("$0.38");
  expect(perClaim(null)).toBe("—");
});

test("a running comparison shows each model's state, and stops; a failed start says why", async () => {
  const user = userEvent.setup();
  const running: Comparison = {
    ...COMPARISON,
    status: "running",
    repeats: 2,
    answer: "None meets the targets yet; the best is Sonnet 5.5 at high.",
    cheapest_pass: null,
    results: [
      result({
        model: "claude-sonnet-5-5",
        label: "Sonnet 5.5",
        effort: "high",
        in_use: false,
        runs: [30, 31],
        finished: 2,
        planned: 2,
        by_run: [0.6, 0.8],
        accuracy: 0.7,
        passes: false,
        grade: null,
        seconds_per_claim: null,
      }),
      result({
        model: "claude-opus-5-5",
        label: "Opus 5.5",
        in_use: false,
        runs: [32],
        finished: 0,
        planned: 2,
        accuracy: null,
        low: null,
        high: null,
        by_run: [],
        passes: null,
        cost_per_claim: null,
      }),
    ],
    differences: [
      {
        claim_id: "CLM-1020",
        claim_type: "baggage",
        handler_decision: "decline",
        handler_payout: 0,
        marks: [
          {
            model: "claude-sonnet-5-5",
            label: "Sonnet 5.5",
            effort: "high",
            decision: "approve",
            payout: 120,
            right: false,
          },
        ],
      },
      {
        claim_id: "CLM-1021",
        claim_type: "medical",
        handler_decision: "refer",
        handler_payout: null,
        marks: [
          {
            model: "claude-sonnet-5-5",
            label: "Sonnet 5.5",
            effort: "high",
            decision: null,
            payout: null,
            right: false,
          },
        ],
      },
    ],
  };
  const fetchFn = fakeFetch({
    "GET /api/engineering/compare/models": () => [200, MODELS],
    "GET /api/engineering/compare/latest": () => [200, running],
    "POST /api/engineering/compare/1/stop": () => [200, { ...running, status: "stopped" }],
  });
  const first = render(<ComparePage api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findByText(/None meets the targets yet/)).toBeInTheDocument();
  expect(screen.getByText("Misses a target")).toBeInTheDocument();
  expect(screen.getByText("varies by run")).toBeInTheDocument();
  expect(screen.getByText("Run 1 of 2")).toBeInTheDocument();
  expect(screen.getByText("$120")).toBeInTheDocument();
  expect(screen.getByText("none")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Stop" }));
  expect(await screen.findByRole("button", { name: "Compare" })).toBeInTheDocument();
  first.unmount();

  const failing = fakeFetch({
    "GET /api/engineering/compare/models": () => [200, MODELS],
    "GET /api/engineering/compare/latest": () => [200, null],
    "POST /api/engineering/compare": () => [409, { detail: "A comparison is running" }],
  });
  render(<ComparePage api={createApi(failing, () => "t")} />);
  await user.click(await screen.findByRole("button", { name: "Compare" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("A comparison is running");
});

test("models that can't be loaded say so", async () => {
  const fetchFn = fakeFetch({
    "GET /api/engineering/compare/models": () => [500, { detail: "Down" }],
    "GET /api/engineering/compare/latest": () => [200, null],
  });
  render(<ComparePage api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Down");
});
