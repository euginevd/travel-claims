import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi, type Detections } from "../api";
import { fakeFetch } from "../testing";
import { DetectionsPage } from "./DetectionsPage";

const FOUND: Detections = {
  days: 14,
  since: "2026-10-30",
  counts: { guardrail: 0, hidden_instruction: 1, refusal: 0, held: 1 },
  events: [
    {
      kind: "hidden_instruction",
      control: "Hidden-instruction check",
      claim_id: "CLM-1918",
      at: "2026-11-12T09:14:00Z",
      summary: "<b>The receipt says to approve it.</b>",
      outcome: "Referred to a handler unseen",
    },
    {
      kind: "held",
      control: "Payout held",
      claim_id: "CLM-1896",
      at: "2026-11-09T14:22:00Z",
      summary: "Approved $2,140.00, over the $1,000.00 approval limit",
      outcome: "Held for a senior handler",
    },
  ],
};
const QUIET: Detections = {
  days: 30,
  since: "2026-10-14",
  counts: { guardrail: 0, hidden_instruction: 0, refusal: 0, held: 0 },
  events: [],
};

test("lists each detection as text, filters by control, and changes period", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    "GET /api/engineering/detections?days=14": () => [200, FOUND],
    "GET /api/engineering/detections?days=30": () => [200, QUIET],
  });
  render(<DetectionsPage api={createApi(fetchFn, () => "t")} />);
  const table = await screen.findByRole("region", { name: "Detections table" });
  // A record's reason is shown as text, never markup.
  expect(within(table).getByText("<b>The receipt says to approve it.</b>")).toBeInTheDocument();
  expect(within(table).getAllByRole("row")).toHaveLength(3);
  expect(within(table).getByRole("link", { name: "CLM-1918" })).toHaveAttribute(
    "href",
    "#/trace/CLM-1918",
  );

  // A tile is its control's filter.
  await user.click(screen.getByRole("button", { name: /^Payout held/ }));
  expect(screen.getByRole("button", { name: /^Payout held/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(within(table).getAllByRole("row")).toHaveLength(2);
  expect(within(table).getByText("CLM-1896")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /^Model refused/ }));
  expect(screen.getByText("None from this control in the period.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Show every control" }));
  expect(await screen.findByRole("region", { name: "Detections table" })).toBeInTheDocument();

  await user.click(screen.getByRole("radio", { name: "30 days" }));
  expect(await screen.findByText("No detections in this period")).toBeInTheDocument();
});

test("an error offers a retry", async () => {
  const user = userEvent.setup();
  let fail = true;
  const fetchFn = fakeFetch({
    "GET /api/engineering/detections?days=14": () =>
      fail ? [500, { detail: "Down" }] : [200, FOUND],
  });
  render(<DetectionsPage api={createApi(fetchFn, () => "t")} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Down");
  fail = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("region", { name: "Detections table" })).toBeInTheDocument();
});
