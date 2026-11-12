import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi, type SuccessCriteria } from "../api";
import { fakeFetch } from "../testing";
import { figure, overall, ScoreboardPage } from "./ScoreboardPage";

const RUN_DETAIL = "Run 2, held-out set (tiny), v1, 5 claims";
const CRITERIA: SuccessCriteria = {
  met: false,
  criteria: [
    {
      key: "straight_through",
      label: "Straight through",
      unit: "share",
      target: 0.7,
      actual: 0.8,
      met: true,
      detail: RUN_DETAIL,
    },
    {
      key: "accuracy",
      label: "Held-out accuracy",
      unit: "share",
      target: 0.8,
      actual: 0.6,
      met: false,
      detail: RUN_DETAIL,
    },
    {
      key: "signed_off",
      label: "Payments over the limit without a person's sign-off",
      unit: "count",
      target: 0,
      actual: 0,
      met: true,
      detail: "No payment has gone over the approval limit yet",
    },
  ],
};

const NO_DATA: SuccessCriteria = {
  met: false,
  criteria: CRITERIA.criteria.map((criterion) =>
    criterion.unit === "share"
      ? { ...criterion, actual: null, met: null, detail: "No held-out run yet" }
      : criterion,
  ),
};

test("the success criteria show each target, actual and whether it's met", async () => {
  const fetchFn = fakeFetch({
    "GET /api/engineering/runs": () => [200, []],
    "GET /api/engineering/success-criteria": () => [200, CRITERIA],
  });
  render(<ScoreboardPage api={createApi(fetchFn, () => "t")} />);
  const accuracy = (await screen.findByRole("rowheader", { name: /Held-out accuracy/ })).closest(
    "tr",
  );
  expect(accuracy).not.toBeNull();
  const row = within(accuracy as HTMLElement);
  expect(row.getByText("At least 80%")).toBeInTheDocument();
  expect(row.getByText("60%")).toBeInTheDocument();
  expect(row.getByText("Not met")).toBeInTheDocument();
  expect(screen.getAllByText("Met")).toHaveLength(2);
  expect(screen.getByText("2 of 3 criteria met.")).toBeInTheDocument();
});

test("criteria with no held-out run say so and what to do", async () => {
  const fetchFn = fakeFetch({
    "GET /api/engineering/runs": () => [200, []],
    "GET /api/engineering/success-criteria": () => [200, NO_DATA],
  });
  render(<ScoreboardPage api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findAllByText("No data")).toHaveLength(2);
  expect(screen.getAllByText("No held-out run yet")).toHaveLength(2);
  expect(screen.getByText(/exam measures the rest/)).toBeInTheDocument();
});

test("criteria that can't be loaded say so and load on a retry", async () => {
  const user = userEvent.setup();
  let failing = true;
  const fetchFn = fakeFetch({
    "GET /api/engineering/runs": () => [200, []],
    "GET /api/engineering/success-criteria": () =>
      failing ? [500, { detail: "Database down" }] : [200, CRITERIA],
  });
  render(<ScoreboardPage api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findByText(/couldn't be loaded: Database down/)).toBeInTheDocument();
  failing = false;
  await user.click(screen.getByRole("button", { name: "Reload the criteria" }));
  expect(await screen.findByText("2 of 3 criteria met.")).toBeInTheDocument();
});

test("the run form starts from the handlers' number of agents at once", async () => {
  const fetchFn = fakeFetch({
    "GET /api/engineering/runs": () => [200, []],
    "GET /api/engineering/settings": () => [
      200,
      {
        values: {
          approval_limit: 1000,
          round_spend_limit: 2,
          accuracy_objective: 0.8,
          straight_through_objective: 0.7,
          agents_at_once: 8,
        },
      },
    ],
  });
  render(<ScoreboardPage api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findByDisplayValue("8")).toHaveAccessibleName("Claims worked at once");
});

test("figures read as percentages or counts, and the overall line counts them", () => {
  const [share, , count] = CRITERIA.criteria;
  if (!share || !count) throw new Error("the criteria are missing");
  expect(figure(share, 0.825)).toBe("82.5%");
  expect(figure(share, null)).toBe("–");
  expect(figure(count, 2)).toBe("2");
  expect(overall({ ...CRITERIA, met: true })).toBe("All 3 criteria are met.");
  expect(overall(NO_DATA)).toBe("1 of 3 criteria met, 2 with no data yet.");
});
