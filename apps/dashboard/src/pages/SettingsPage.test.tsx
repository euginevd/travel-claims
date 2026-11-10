import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi, type Settings } from "../api";
import { DANA, fakeFetch, MARCUS } from "../testing";
import { read, SettingsPage, shown } from "./SettingsPage";

const SETTINGS: Settings = {
  values: {
    approval_limit: 1000,
    round_spend_limit: 2,
    accuracy_objective: 0.8,
    straight_through_objective: 0.7,
    agents_at_once: 5,
  },
  ranges: {
    approval_limit: { min: 100, max: 5000 },
    round_spend_limit: { min: 0.5, max: 10 },
    accuracy_objective: { min: 0.5, max: 1 },
    straight_through_objective: { min: 0, max: 1 },
    agents_at_once: { min: 1, max: 25 },
  },
  changes: [],
};

const CHANGE = {
  key: "approval_limit",
  old: 1000,
  new: 1500,
  changed_by: "Dana Whitfield",
  changed_at: "2026-11-11T01:00:00+00:00",
  reason: "Quarterly review",
};

test("a senior handler saves only what changed, with the reason, and sees it listed", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    "GET /api/staff/settings": () => [200, SETTINGS],
    "PUT /api/staff/settings": () => [
      200,
      { ...SETTINGS, values: { ...SETTINGS.values, approval_limit: 1500 }, changes: [CHANGE] },
    ],
  });
  render(<SettingsPage api={createApi(fetchFn, () => "t")} handler={DANA} />);
  const limit = await screen.findByLabelText(/Approval limit/);
  const save = screen.getByRole("button", { name: "Save changes" });
  expect(save).toBeDisabled();
  expect(screen.getByText(/Nothing has been changed yet/)).toBeInTheDocument();

  await user.clear(limit);
  await user.type(limit, "9000");
  expect(screen.getByText("Enter $100.00 to $5,000.00.")).toBeInTheDocument();
  expect(save).toBeDisabled();

  await user.clear(limit);
  await user.type(limit, "1500");
  await user.type(screen.getByLabelText(/Reason for the change/), "Quarterly review");
  await user.click(save);
  expect(await screen.findByText("Saved")).toBeInTheDocument();
  expect(fetchFn.calls.find((call) => call.method === "PUT")?.body).toEqual({
    approval_limit: 1500,
    reason: "Quarterly review",
  });
  expect(screen.getByText(/changed from \$1,000.00 to \$1,500.00/)).toBeInTheDocument();
  expect(screen.getByText(/Dana Whitfield · .*Quarterly review/)).toBeInTheDocument();
  expect(save).toBeDisabled();
});

test("a handler who isn't senior reads the settings and is told why they can't change them", async () => {
  const fetchFn = fakeFetch({ "GET /api/staff/settings": () => [200, SETTINGS] });
  render(<SettingsPage api={createApi(fetchFn, () => "t")} handler={MARCUS} />);
  expect(await screen.findByLabelText(/Accuracy objective/)).toBeDisabled();
  expect(screen.getByLabelText(/Accuracy objective/)).toHaveValue(80);
  expect(screen.getByText(/Only a senior claims handler can change these/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
});

test("settings that can't be loaded say so, with a way to try again", async () => {
  const user = userEvent.setup();
  let failing = true;
  const fetchFn = fakeFetch({
    "GET /api/staff/settings": () =>
      failing ? [500, { detail: "Database down" }] : [200, SETTINGS],
  });
  render(<SettingsPage api={createApi(fetchFn, () => "t")} handler={DANA} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Database down");
  failing = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByLabelText(/Approval limit/)).toHaveValue(1000);
});

test("a percentage is typed as one and sent as a share", () => {
  expect(read("accuracy_objective", "85", SETTINGS.ranges.accuracy_objective)).toEqual({
    value: 0.85,
  });
  expect(read("accuracy_objective", "40", SETTINGS.ranges.accuracy_objective)).toEqual({
    problem: "Enter 50% to 100%.",
  });
  expect(read("agents_at_once", "2.5", SETTINGS.ranges.agents_at_once)).toEqual({
    problem: "Enter a whole number.",
  });
  expect(read("approval_limit", "", SETTINGS.ranges.approval_limit)).toEqual({
    problem: "Enter a number.",
  });
  expect(shown("straight_through_objective", 0.7)).toBe("70%");
});
