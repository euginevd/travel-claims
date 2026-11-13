import { render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { createApi, type Api, type Handler, type PayoutSwitch } from "../api";
import { needsYou } from "./NeedsYou";
import { PayoutsStatus, PayoutsSwitch, usePayouts } from "./PayoutsSwitch";
import { StatusLine } from "./StatusLine";
import { APPROVAL, claim, DANA, fakeFetch, MARCUS } from "../testing";

// The header status and the page panel wired together, as App does.
function Harness({ api, handler }: { api: Api; handler: Handler }) {
  const payouts = usePayouts(api, true);
  const [open, setOpen] = useState(false);
  return (
    <>
      <PayoutsStatus
        state={payouts.state}
        senior={handler.can_approve_over_limit}
        onOpen={() => {
          setOpen(true);
        }}
      />
      <StatusLine
        agent={null}
        payouts={payouts.state}
        senior={handler.can_approve_over_limit}
        onTurnOn={() => undefined}
        onResume={() => {
          setOpen(true);
        }}
      />
      <PayoutsSwitch
        api={api}
        handler={handler}
        state={payouts.state}
        onState={payouts.setState}
        editing={open}
        onEditing={setOpen}
      />
    </>
  );
}

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
  render(<Harness api={createApi(fetchFn, () => "t")} handler={DANA} />);
  await userEvent.click(await screen.findByRole("button", { name: /pause all payouts/i }));
  await userEvent.type(screen.getByLabelText(/Why\?/), "Checking a fraud ring");
  await userEvent.click(screen.getByRole("button", { name: "Pause all payouts" }));
  expect(await screen.findByText("Payouts paused", { selector: "strong" })).toBeInTheDocument();
  const put = fetchFn.calls.find((call) => call.method === "PUT");
  expect(put?.body).toEqual({ paused: true, reason: "Checking a fraud ring" });
});

test("every handler sees the banner while paused, but only a senior can resume", async () => {
  const fetchFn = fakeFetch({ "GET /api/staff/payouts": () => [200, OFF] });
  render(<Harness api={createApi(fetchFn, () => "t")} handler={MARCUS} />);
  expect(await screen.findByText("Payouts paused", { selector: "strong" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /resume payouts/i })).toBeNull();
});

test("a handler without sign-off rights sees payouts are live but can't change them", async () => {
  const fetchFn = fakeFetch({ "GET /api/staff/payouts": () => [200, ON] });
  render(<Harness api={createApi(fetchFn, () => "t")} handler={MARCUS} />);
  expect(await screen.findByRole("status")).toHaveTextContent("Payouts live");
  expect(screen.queryByRole("button", { name: /pause all payouts/i })).toBeNull();
});

test("an approval held because payouts are paused says so", () => {
  const held = claim({
    status: "waiting_for_sign_off",
    decision: { ...APPROVAL, hold_reason: "Payouts are paused by a senior handler" },
  });
  expect(needsYou(held)).toMatch(/payouts are paused/i);
});

test("an open payouts card keeps what the handler asked for when the status changes under it", async () => {
  const fetchFn = fakeFetch({});
  const api = createApi(fetchFn, () => "t");
  const live: PayoutSwitch = { paused: false, changed_by: null, changed_at: null, reason: null };
  const paused: PayoutSwitch = { ...live, paused: true, changed_by: "Priya Raman" };
  function Polled({ state }: { state: PayoutSwitch }) {
    const [editing, setEditing] = useState(true);
    return (
      <PayoutsSwitch
        api={api}
        handler={DANA}
        state={state}
        onState={() => undefined}
        editing={editing}
        onEditing={setEditing}
      />
    );
  }
  const { rerender } = render(<Polled state={live} />);
  expect(screen.getByRole("button", { name: "Pause all payouts" })).toBeInTheDocument();
  // Another senior handler pauses first, while this card is open.
  rerender(<Polled state={paused} />);
  await waitFor(() => {
    expect(screen.queryByRole("button", { name: "Pause all payouts" })).not.toBeInTheDocument();
  });
  // It closes; it never becomes "Resume payouts" under a reason written for pausing.
  expect(screen.queryByRole("button", { name: "Resume payouts" })).not.toBeInTheDocument();
  expect(fetchFn.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
});
