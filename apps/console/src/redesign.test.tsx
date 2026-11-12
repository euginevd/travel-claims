import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createApi, type Configuration, type Round, type Run } from "./api";
import { Meter, RingChart, Sparkline, sparkPoints } from "./components/Charts";
import { frameAt, SignInRun } from "./components/SignInRun";
import { ImprovementPage } from "./pages/ImprovementPage";
import { owaspIds } from "./pages/RedTeamPage";
import { ScoreboardPage } from "./pages/ScoreboardPage";
import { SignInPage } from "./pages/SignInPage";
import { TracePage } from "./pages/TracePage";
import { saveToken } from "./session";
import { fakeFetch, SAM } from "./testing";

const SCORES = {
  claims: 5,
  decided: 5,
  accuracy: 0.8,
  payout_accuracy: 0.6,
  straight_through: 0.8,
  cost_per_claim: 0.031,
  seconds_per_claim: 22,
  total_cost: 0.155,
  grade: null,
  graded: 0,
  judge_cost: 0,
};

const RUN: Run = {
  run_id: 1,
  label_set: "evaluation",
  size: "tiny",
  concurrency: 5,
  config_version: 1,
  round_id: null,
  status: "finished",
  started_by: "Dana Whitfield",
  started_at: "2026-11-08T10:00:00+00:00",
  finished_at: "2026-11-08T10:02:00+00:00",
  scores: SCORES,
  grading: false,
};

const ROUND: Round = {
  round_id: 1,
  status: "kept",
  baseline_version: 1,
  candidate_version: 2,
  baseline_eval_run: 1,
  baseline_held_run: 2,
  candidate_held_run: 3,
  proposal: { reason: "Refer when documents are thin" },
  review: null,
  verdict: { why: "Better on the held-out set." },
  improver_cost: 0.02,
  spend_limit: 2,
  spent: 0.5,
  diff: "--- version 1\n+++ version 2\n@@ -1,2 +1,2 @@\n-model: sonnet\n+model: haiku\n effort: medium",
  started_by: "Dana Whitfield",
  started_at: "2026-11-08T10:00:00+00:00",
};

const VERSION: Configuration = {
  version: 1,
  instructions: "",
  model: "claude-sonnet-5-5",
  effort: "medium",
  reason: "The first configuration",
  diff: "",
  status: "kept",
  parent_version: null,
  proposed_by: "UnderCover Agent",
  reviewed_by: null,
  created_at: "2026-11-08T10:00:00+00:00",
  current: true,
};

// jsdom has no matchMedia, which the app reads as "keep still"; this says motion is welcome.
function allowMotion() {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("a trend line scales to its values, and one value draws no line", () => {
  expect(sparkPoints([0.5, 0.5])).toEqual([
    [0, 9],
    [120, 9],
  ]);
  expect(sparkPoints([0, 1, 0.5])).toEqual([
    [0, 18],
    [60, 0],
    [120, 9],
  ]);
  const { container } = render(<Sparkline values={[1]} label="Accuracy" />);
  expect(container).toBeEmptyDOMElement();
  render(<Sparkline values={[0.2, 0.4]} label="Accuracy over 2 runs" />);
  expect(screen.getByRole("img", { name: "Accuracy over 2 runs" })).toBeInTheDocument();
});

test("the ring and the meter draw their share, and nothing past the whole", () => {
  const { container } = render(
    <>
      <RingChart part={0} whole={0} />
      <RingChart part={1} whole={2} />
      <Meter value={1.4} tone="spend" />
      <Meter value={0.25} />
    </>,
  );
  expect(container.querySelectorAll(".ring-value")).toHaveLength(1);
  expect(container.querySelector(".bar-fill.spend")).toHaveAttribute("width", "100%");
  expect(container.querySelector(".bar-fill:not(.spend)")).toHaveAttribute("width", "25%");
});

test("the sign-in illustration plays its loop and stays still when asked", () => {
  expect(frameAt(0)).toMatchObject({ done: 0, straightThrough: "–", cost: "–", chips: 0 });
  expect(frameAt(9)).toMatchObject({ done: 4, straightThrough: "75%", cost: "$0.03" });
  expect(frameAt(14).say).toBe("Every decision traced end to end");
  expect(frameAt(30)).toMatchObject({ done: 25, cost: "$0.04", say: "Running the red team" });
  expect(frameAt(55)).toMatchObject({ chips: 3, straightThrough: "80%" });
  expect(frameAt(55).say).toMatch(/All attacks held/);

  const still = render(<SignInRun />);
  expect(still.container).toHaveTextContent("25 of 25 claims");
  still.unmount();

  vi.useFakeTimers();
  try {
    allowMotion();
    const { container, unmount } = render(<SignInRun />);
    expect(container).toHaveTextContent("0 of 25 claims");
    act(() => {
      vi.advanceTimersByTime(180 * 8);
    });
    expect(container).toHaveTextContent("3 of 25 claims");
    unmount();
  } finally {
    vi.useRealTimers();
  }
});

test("the test account signs in after the welcome, and the password can be shown", async () => {
  const fetchFn = fakeFetch({
    "POST /api/engineering/dev/test-sign-in": () => [200, { id_token: "t", expires_in: 3600 }],
  });
  const signedIn = vi.fn();
  allowMotion();
  {
    const user = userEvent.setup();
    render(
      <SignInPage api={createApi(fetchFn, () => null)} onSignedIn={signedIn} checking={false} />,
    );
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByRole("radio", { name: /Sam Carter/ })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Continue as Sam" }));
    expect(await screen.findByText("Welcome back", { selector: ".go-state" })).toBeInTheDocument();
    await vi.waitFor(() => {
      expect(signedIn).toHaveBeenCalledWith("t");
    });
  }
});

test("the navigation marks the page the engineer is on", async () => {
  saveToken("t");
  const fetchFn = fakeFetch({
    "GET /api/engineering/me": () => [200, SAM],
    "GET /api/engineering/runs": () => [200, []],
    "GET /api/engineering/runs/3": () => [404, { detail: "No run 3" }],
    "GET /api/engineering/rounds": () => [200, []],
    "GET /api/engineering/configuration": () => [200, []],
    "GET /api/engineering/threats": () => [500, { detail: "Down" }],
  });
  const pages: [string, string][] = [
    ["#/runs/3", "Evals: Scoreboard"],
    ["#/improvement", "Evals: Improvement"],
    ["#/trace", "Evals: Trace"],
    ["#/threats", "Security: Red team"],
    ["#/agents", "Security: Red team"],
  ];
  for (const [hash, name] of pages) {
    window.location.hash = hash;
    const { unmount } = render(<App fetchFn={fetchFn} />);
    expect(await screen.findByRole("link", { name })).toHaveAttribute("aria-current", "page");
    unmount();
  }
  saveToken(null);
  window.location.hash = "";
});

test("the scoreboard shows the latest scored run's measures and starts the chosen run", async () => {
  const user = userEvent.setup();
  const runs: Run[] = [
    { ...RUN, run_id: 4, status: "running", scores: null, finished_at: null },
    { ...RUN, run_id: 3, status: "stopped", scores: null },
    { ...RUN, run_id: 2, label_set: "held_out", scores: { ...SCORES, accuracy: 1 } },
    RUN,
  ];
  const fetchFn = fakeFetch({
    "GET /api/engineering/runs": () => [200, runs],
    "POST /api/engineering/runs": () => [200, RUN],
  });
  render(<ScoreboardPage api={createApi(fetchFn, () => "t")} />);
  // Run 2 is the only exam: it heads the page, with how sure its score is, and charts alone.
  expect(await screen.findByRole("heading", { name: /exam/ })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /v1 100% \(likely/ })).toBeInTheDocument();
  expect(screen.getAllByText("Exam")).toHaveLength(1);
  expect(screen.getByText("Running…")).toBeInTheDocument();
  expect(screen.getByText("Stopped")).toBeInTheDocument();
  expect(screen.getAllByText("Finished")).toHaveLength(2);

  // A practice run only: the exam is left to improvement rounds.
  expect(screen.queryByRole("radio", { name: "Held-out set" })).toBeNull();
  await user.click(screen.getByRole("radio", { name: /All 25/ }));
  await user.click(screen.getByRole("button", { name: "Start the practice run" }));
  expect(fetchFn.calls.find((call) => call.method === "POST")?.body).toEqual({
    label_set: "evaluation",
    size: "whole",
    concurrency: 5,
  });
});

test("improvement shows each round's stage, its diff by line and what happens next", async () => {
  const rounds: Round[] = [
    { ...ROUND, round_id: 3, status: "evaluating", verdict: null },
    { ...ROUND, round_id: 2, status: "red_teaming", diff: "", proposal: null },
    ROUND,
    { ...ROUND, round_id: 0, status: "stopped", diff: null, spend_limit: 0 },
  ];
  const versions: Configuration[] = [
    { ...VERSION, version: 3, status: "proposed", current: false },
    { ...VERSION, version: 2, status: "rolled_back", current: false },
    VERSION,
  ];
  const fetchFn = fakeFetch({
    "GET /api/engineering/rounds": () => [200, rounds],
    "GET /api/engineering/configuration": () => [200, versions],
  });
  const { container } = render(<ImprovementPage api={createApi(fetchFn, () => "t")} />);
  // The latest round is open: its path shows the exam as the step it's on.
  const path = await screen.findByRole("list", { name: "Where the round is" });
  expect(path.querySelector("[aria-current='step']")).toHaveTextContent("Exam (25 claims)");
  expect(path.querySelectorAll("li.done")).toHaveLength(3);
  // The full change sits behind "Show the full change", diffed by line.
  expect(container.querySelector(".diff-line.del")).toHaveTextContent("-model: sonnet");
  expect(container.querySelector(".diff-line.add")).toHaveTextContent("+model: haiku");
  // Earlier rounds are one line each.
  const earlier = screen.getByRole("region", { name: "Earlier rounds table" });
  expect(within(earlier).getAllByRole("row")).toHaveLength(4);
  expect(within(earlier).getByText("Stopped")).toBeInTheDocument();
  expect(screen.getByText("Proposed")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Start an improvement round/ })).toBeNull();
});

test("improvement with no rounds says what to do, and a round awaiting review is flagged", async () => {
  let rounds: Round[] = [];
  const fetchFn = fakeFetch({
    "GET /api/engineering/rounds": () => [200, rounds],
    "GET /api/engineering/configuration": () => [200, []],
    "POST /api/engineering/rounds": () => {
      rounds = [{ ...ROUND, status: "awaiting_review", verdict: null }];
      return [200, rounds[0]];
    },
  });
  render(<ImprovementPage api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findByText("No improvement rounds yet")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Start an improvement round/ }));
  expect(await screen.findByText("Round 1 needs your review.")).toBeInTheDocument();
  expect(screen.getByText("Needs your review")).toBeInTheDocument();
});

const UNDECIDED = {
  summary: "Bag delayed",
  status: "in_progress",
  outcome: null,
  config_version: null,
  average_cost: null,
};

test("the claim trace starts empty and totals what it loads", async () => {
  const user = userEvent.setup();
  const call = {
    model: "claude-sonnet-5-5",
    input_tokens: 1200,
    output_tokens: 300,
    cost: 0.0125,
    latency_ms: null,
    created_at: "2026-11-09T01:00:00Z",
  };
  const fetchFn = fakeFetch({
    "GET /api/engineering/claims/CLM-1/trace": () => [
      200,
      { steps: [], model_calls: [call], total_cost: 0.0125, total_tokens: 1500, ...UNDECIDED },
    ],
    "GET /api/engineering/claims/CLM-2/trace": () => [
      200,
      {
        steps: [],
        model_calls: [call, { ...call, latency_ms: 1500 }],
        total_cost: 0.025,
        total_tokens: 3000,
        ...UNDECIDED,
      },
    ],
  });
  render(<TracePage api={createApi(fetchFn, () => "t")} />);
  expect(screen.getByText("No claim open")).toBeInTheDocument();
  await user.type(screen.getByLabelText("Claim"), "clm-1");
  await user.click(screen.getByRole("button", { name: "Show" }));
  expect(await screen.findByRole("heading", { name: "CLM-1" })).toBeInTheDocument();
  expect(screen.getByText("Not decided yet (in progress).")).toBeInTheDocument();
  const totals = screen.getByRole("list", { name: "The trace's totals" });
  expect(within(totals).getByText("1,200")).toBeInTheDocument();
  expect(within(totals).getByText("–")).toBeInTheDocument();

  await user.clear(screen.getByLabelText("Claim"));
  await user.type(screen.getByLabelText("Claim"), "CLM-2");
  await user.click(screen.getByRole("button", { name: "Show" }));
  expect(await screen.findByText("1.5 s")).toBeInTheDocument();
  expect(screen.getByText("Timed on 1 of 2 calls")).toBeInTheDocument();
});

test("OWASP IDs are split into their own chips", () => {
  expect(owaspIds("LLM01, ASI01 / API1")).toEqual(["LLM01", "ASI01", "API1"]);
  expect(owaspIds("")).toEqual([]);
});
