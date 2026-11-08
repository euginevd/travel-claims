import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi } from "../api";
import { needsYou } from "./NeedsYou";
import { PayoutsSwitch } from "./PayoutsSwitch";
import { APPROVAL, claim, DANA, fakeFetch, MARCUS } from "../testing";

const ON = { paused: false, changed_by: "Migration", changed_at: null, reason: "On" };
const OFF = {
  paused: true,
  changed_by: "Dana Whitfield",
  changed_at: "2026-11-08T10:00:00Z",
  reason: "Investigating a fraud ring",
};

test("a senior handler pauses all payouts with a reason", async () => {
  const fetchFn = fakeFetch({
    "GET /api/staff/payouts": () => [200, ON],
    "PUT /api/staff/payouts": () => [200, OFF],
  });
  render(<PayoutsSwitch api={createApi(fetchFn, () => "t")} handler={DANA} />);
  await userEvent.click(await screen.findByRole("button", { name: /pause all payouts/i }));
  await userEvent.type(screen.getByLabelText("Reason"), "Investigating a fraud ring");
  await userEvent.click(screen.getByRole("button", { name: /pause all payouts/i }));
  expect(await screen.findByText(/payouts are paused\./i)).toBeInTheDocument();
  const put = fetchFn.calls.find((call) => call.method === "PUT");
  expect(put?.body).toEqual({ paused: true, reason: "Investigating a fraud ring" });
});

test("every handler sees the banner while paused, but only a senior can resume", async () => {
  const fetchFn = fakeFetch({ "GET /api/staff/payouts": () => [200, OFF] });
  render(<PayoutsSwitch api={createApi(fetchFn, () => "t")} handler={MARCUS} />);
  expect(await screen.findByText(/payouts are paused\./i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /resume payouts/i })).toBeNull();
});

test("a handler without sign-off rights sees nothing while payouts are on", async () => {
  const fetchFn = fakeFetch({ "GET /api/staff/payouts": () => [200, ON] });
  const { container } = render(
    <PayoutsSwitch api={createApi(fetchFn, () => "t")} handler={MARCUS} />,
  );
  await waitFor(() => {
    expect(fetchFn.calls.length).toBe(1);
  });
  expect(container.textContent).toBe("");
});

test("an approval held because payouts are paused says so", () => {
  const held = claim({
    status: "waiting_for_sign_off",
    decision: { ...APPROVAL, hold_reason: "Payouts are paused by a senior handler" },
  });
  expect(needsYou(held)).toMatch(/payouts are paused/i);
});
