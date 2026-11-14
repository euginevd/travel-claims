import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddedSchema, createApi, LiveSchema, type Live } from "../api";
import added from "../fixtures/added-to-evaluation.json";
import fixture from "../fixtures/live.json";
import { fakeFetch } from "../testing";
import { LivePage } from "./LivePage";

const LIVE: Live = LiveSchema.parse(fixture);
const FIRST = LIVE.disagreements[0];
if (!FIRST) throw new Error("The live fixture has no disagreement");
const ADD = `POST /api/engineering/live/disagreements/${FIRST.claim_id}/add-to-evaluation`;

function withRow(changes: Partial<Live["disagreements"][number]>): Live {
  return {
    ...LIVE,
    days: 14,
    // The api's fixture has no finished exam, so the version in use and its exam are set here.
    version: 3,
    exam: {
      version: 3,
      claims: 25,
      accuracy: 0.84,
      cost_per_claim: 0.009,
      finished_at: "2026-11-12T08:05:00Z",
    },
    by_version: LIVE.by_version.map((slice) => ({ ...slice, name: "v3" })),
    feedback: {
      ...LIVE.feedback,
      comments: [
        {
          subject: "decision",
          claim_id: FIRST?.claim_id ?? null,
          comment: "<b>Which receipt?</b>",
          question: null,
          created_at: "2026-11-10T10:00:00+00:00",
        },
      ],
    },
    disagreements: LIVE.disagreements.map((row) => ({ ...row, ...changes })),
  };
}

test("the api's live responses parse", () => {
  expect(LIVE.series).toHaveLength(7);
  expect(AddedSchema.safeParse(added).success).toBe(true);
});

test("shows the tiles, the disagreements and feedback, and adds a claim after a confirm", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    "GET /api/engineering/live?days=14": () => [
      200,
      withRow({ in_evaluation_set: false, can_add: true }),
    ],
    [ADD]: () => [200, { ...added, status: "added" }],
  });
  render(<LivePage api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findByText("Handler disagreement")).toBeInTheDocument();
  expect(screen.getByText(/1 of 1 reviewed decisions overridden or sent back/)).toBeInTheDocument();
  expect(screen.getByRole("img", { name: /Claims decided each day/ })).toBeInTheDocument();
  // The exam beside live.
  const exam = screen.getByRole("region", { name: "Exam against live table" });
  expect(within(exam).getByText("84%")).toBeInTheDocument();
  expect(screen.getByText("Live is over 10% below the exam", { exact: false })).toBeInTheDocument();

  // The detail one section at a time: a customer's words are text, never markup.
  await user.click(screen.getByRole("button", { name: "Customer feedback" }));
  expect(screen.getByText("<b>Which receipt?</b>")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "By version and claim type" }));
  expect(
    within(screen.getByRole("region", { name: "By version table" })).getByText("In use"),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Each agent, day by day" }));
  expect(screen.getByRole("button", { name: "Each agent, day by day" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await user.click(screen.getByRole("button", { name: /^Disagreements/ }));
  expect(screen.getByText("1 to review")).toBeInTheDocument();

  const table = within(screen.getByRole("region", { name: "Disagreements table" })).getByRole(
    "table",
  );
  await user.click(within(table).getByRole("button", { name: "Add to evaluation set" }));
  expect(fetchFn.calls.some((call) => call.method === "POST")).toBe(false);
  await user.click(within(table).getByRole("button", { name: `Add ${FIRST.claim_id}` }));
  expect(await within(table).findByText("In evaluation set")).toBeInTheDocument();
});

test("says when a period has no live decisions, and loads another period", async () => {
  const user = userEvent.setup();
  const empty: Live = {
    ...LIVE,
    days: 14,
    totals: { ...LIVE.totals, decided: 0, reviewed: 0, disagreements: 0 },
    disagreements: [],
  };
  const fetchFn = fakeFetch({
    "GET /api/engineering/live?days=14": () => [200, empty],
    "GET /api/engineering/live?days=30": () => [200, { ...withRow({}), days: 30 }],
  });
  render(<LivePage api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findByText("No live decisions in this period")).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: "30 days" }));
  expect(await screen.findByText("Claims decided")).toBeInTheDocument();
  expect(screen.getByText("In evaluation set")).toBeInTheDocument();
});

test("an error offers a retry", async () => {
  const fetchFn = fakeFetch({
    "GET /api/engineering/live?days=14": () => [500, { detail: "The database is away" }],
  });
  render(<LivePage api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("The database is away");
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});
