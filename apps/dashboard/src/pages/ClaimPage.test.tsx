import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi, type Claim, type Handler, type Step } from "../api";
import { APPROVAL, claim, DANA, fakeFetch, MARCUS, REFERRAL, STEPS, type Routes } from "../testing";
import { ClaimPage } from "./ClaimPage";

beforeEach(() => {
  window.localStorage.clear();
});

const BASE = "/api/staff/claims/CLM-1001";

function show(routes: Routes, handler: Handler = DANA) {
  const fetchFn = fakeFetch(routes);
  render(
    <ClaimPage
      api={createApi(fetchFn, () => "t")}
      claimId="CLM-1001"
      handler={handler}
      pollMs={10}
    />,
  );
  return fetchFn;
}

function fixed(found: Claim, steps: Step[] = STEPS): Routes {
  return {
    [`GET ${BASE}`]: () => [200, found],
    [`GET ${BASE}/steps`]: () => [200, steps],
  };
}

const held = claim({ status: "waiting_for_sign_off", decision: APPROVAL });

test("shows the claim, its documents and policy", async () => {
  show(fixed(claim(), []));
  expect(await screen.findByRole("heading", { name: "Claim CLM-1001" })).toBeInTheDocument();
  expect(screen.getByText("My flight home from Rome was cancelled.")).toBeInTheDocument();
  expect(screen.getByText("Hotel receipt")).toBeInTheDocument();
  expect(screen.getByText(/POL-2001/)).toBeInTheDocument();
  expect(screen.getByText(/recommendation appears here/)).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Where this claim is" })).toBeInTheDocument();
});

test("working a claim shows its steps live until the agent decides", async () => {
  const user = userEvent.setup();
  let polls = 0;
  const fetchFn = show({
    [`GET ${BASE}`]: () => {
      polls += 1;
      if (polls === 1) return [200, claim()];
      return [
        200,
        polls < 4
          ? claim({ status: "in_progress" })
          : claim({ status: "decided", decision: { ...APPROVAL, payout: 245, calculation: null } }),
      ];
    },
    [`GET ${BASE}/steps`]: () => [200, polls < 3 ? STEPS.slice(0, 1) : STEPS],
    [`POST ${BASE}/work`]: () => [200, claim({ status: "in_progress" })],
  });

  await user.click(await screen.findByRole("button", { name: "Work this claim" }));
  expect(await screen.findByText("The agent is working…")).toBeInTheDocument();
  expect(screen.getByText("Checked for hidden instructions")).toBeInTheDocument();

  expect(await screen.findByText("Approved", {}, { timeout: 2000 })).toBeInTheDocument();
  expect(fetchFn.calls.some((c) => c.method === "POST" && c.path === `${BASE}/work`)).toBe(true);
  expect(screen.queryByRole("button", { name: "Work this claim" })).not.toBeInTheDocument();
});

test("refusals and failures stand out, and sources are listed once per file", async () => {
  const failure: Step = {
    step_id: 6,
    kind: "error",
    content: "The model timed out.",
    sources: [],
    created_at: "2026-11-08T05:00:00Z",
  };
  show({
    ...fixed(claim({ status: "in_progress" }), [...STEPS, failure]),
    [`GET ${BASE}/trace`]: () => [
      200,
      { steps: [...STEPS, failure], model_calls: [], total_cost: 0, total_tokens: 0 },
    ],
  });
  expect(await screen.findByText("The model declined to continue")).toBeInTheDocument();
  // The trace shows every step's raw content, with the sources looked up.
  await userEvent.setup().click(screen.getByRole("switch", { name: /Show trace/ }));

  const sources = screen.getByRole("region", { name: "What the agent looked up" });
  expect(within(sources).getAllByText("policy_wording.md")).toHaveLength(1);
  expect(within(sources).getByText(/2 lookups/)).toBeInTheDocument();
  expect(within(sources).getByText("Legal")).toBeInTheDocument();
  expect(screen.getAllByText("Tool result").length).toBeGreaterThan(0);
});

test("a decided claim shows the calculation line by line and the payment", async () => {
  show(
    fixed(
      claim({
        status: "decided",
        decision: APPROVAL,
        payment: {
          amount: 1250,
          paid_at: "2026-11-08T06:00:00Z",
          signed_off_by: "Dana Whitfield",
          paid_to: null,
        },
      }),
    ),
  );
  const card = await screen.findByRole("region", { name: "Recommendation" });
  const calculation = within(card).getByRole("table");
  expect(within(calculation).getByText("Less the deductible")).toBeInTheDocument();
  expect(within(calculation).getByText("-$100.00")).toBeInTheDocument();
  expect(within(card).getByText(/signed off by Dana Whitfield/)).toBeInTheDocument();
  expect(within(card).getByRole("list", { name: "What was checked" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Sign off/ })).not.toBeInTheDocument();
});

test("a claim the check referred says the claim agent never saw it", async () => {
  show(fixed(claim({ status: "left_for_handler", decision: REFERRAL }), STEPS.slice(0, 1)));
  const card = await screen.findByRole("region", { name: "Recommendation" });
  expect(within(card).getByText("Referred")).toBeInTheDocument();
  expect(screen.getByText(/tries to instruct whoever assesses it/)).toBeInTheDocument();
  expect(within(card).getByText("Instructions hidden in the claim")).toBeInTheDocument();
  expect(screen.queryByRole("table", { name: /payout/ })).not.toBeInTheDocument();
});

test("a sent-back claim shows the note and can be worked again", async () => {
  show(
    fixed(
      claim({
        status: "sent_back",
        sent_back_decisions: [
          {
            decision: APPROVAL,
            note: "Check the hotel receipt's dates.",
            sent_back_by: "Dana Whitfield",
            sent_back_at: "2026-11-08T05:30:00Z",
          },
        ],
      }),
    ),
  );
  expect(await screen.findByText("Check the hotel receipt's dates.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Work this claim" })).toBeEnabled();
});

test("a senior handler signs off a held payout", async () => {
  const user = userEvent.setup();
  let signedOff = false;
  const paid = claim({
    status: "decided",
    decision: APPROVAL,
    payment: {
      amount: 1250,
      paid_at: "2026-11-08T06:00:00Z",
      signed_off_by: "Dana Whitfield",
      paid_to: null,
    },
  });
  const fetchFn = show({
    [`GET ${BASE}`]: () => [200, signedOff ? paid : held],
    [`GET ${BASE}/steps`]: () => [200, STEPS],
    [`POST ${BASE}/sign-off`]: () => {
      signedOff = true;
      return [200, paid];
    },
  });
  expect(await screen.findByText(/Waiting for your sign-off: \$1,250.00/)).toBeInTheDocument();
  expect(screen.getByText("Signing off pays $1,250.00 to Maya Patel now.")).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Recommendation" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Sign off and pay $1,250.00" }));
  // Nothing is paid until the confirm dialog's own button is pressed.
  const confirm = screen.getByRole("dialog", { name: "Sign off and pay $1,250.00?" });
  expect(within(confirm).getByText("Dana Whitfield, Senior Claims Handler")).toBeInTheDocument();
  expect(fetchFn.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  await user.click(within(confirm).getByRole("button", { name: "Pay $1,250.00" }));
  expect(await screen.findByText(/signed off by Dana Whitfield/)).toBeInTheDocument();
  expect(screen.getByText("Signed off and paid $1,250.00.")).toHaveFocus();
  expect(signedOff).toBe(true);
  expect(fetchFn.calls.filter((c) => c.method === "POST")).toHaveLength(1);
});

test("a send-back needs a note of 1,000 characters or fewer", async () => {
  const user = userEvent.setup();
  const fetchFn = show({
    [`GET ${BASE}`]: () => [200, held],
    [`GET ${BASE}/steps`]: () => [200, STEPS],
    [`POST ${BASE}/send-back`]: () => [200, claim({ status: "sent_back" })],
  });
  const send = await screen.findByRole("button", { name: "Send back" });
  await user.click(send);
  expect(screen.getByRole("alert")).toHaveTextContent("Write a note");

  const note = screen.getByLabelText(/send it back to the agent/);
  await user.click(note);
  await user.paste("x".repeat(1001));
  expect(screen.getByText("1001 of 1000 characters")).toBeInTheDocument();
  await user.click(send);
  expect(screen.getByRole("alert")).toHaveTextContent("1000 characters or fewer");
  expect(note).toHaveAttribute("aria-invalid", "true");

  await user.clear(note);
  await user.type(note, "Check the dates");
  await user.click(send);
  await waitFor(() => {
    expect(fetchFn.calls.find((c) => c.path === `${BASE}/send-back`)?.body).toEqual({
      note: "Check the dates",
    });
  });
});

test("cancelling the sign-off confirm pays nothing and returns to the button", async () => {
  const user = userEvent.setup();
  const fetchFn = show(fixed(held));
  const signOff = await screen.findByRole("button", { name: /Sign off and pay/ });
  await user.click(signOff);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(signOff).toHaveFocus();
  expect(fetchFn.calls.filter((c) => c.method === "POST")).toHaveLength(0);
});

test("a handler who can't sign off over the limit sees why", async () => {
  show(fixed(held), MARCUS);
  expect(await screen.findByRole("button", { name: /Sign off and pay/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Send back" })).toBeDisabled();
  expect(
    screen.getByText(/Only a handler who can sign off over the approval limit/),
  ).toBeInTheDocument();
});

test("the api's 403 disables the buttons and gives its reason", async () => {
  const user = userEvent.setup();
  show({
    ...fixed(held),
    [`POST ${BASE}/sign-off`]: () => [403, { detail: "Your sign-off limit is $1,000." }],
  });
  await user.click(await screen.findByRole("button", { name: /Sign off and pay/ }));
  await user.click(screen.getByRole("button", { name: "Pay $1,250.00" }));
  expect(await screen.findByText("Your sign-off limit is $1,000.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Sign off and pay/ })).toBeDisabled();
});

test("other failures show as an alert and leave the buttons usable", async () => {
  const user = userEvent.setup();
  show({ ...fixed(held), [`POST ${BASE}/sign-off`]: () => [500, { detail: "Payments are down" }] });
  await user.click(await screen.findByRole("button", { name: /Sign off and pay/ }));
  await user.click(screen.getByRole("button", { name: "Pay $1,250.00" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Payments are down");
  expect(screen.getByRole("button", { name: /Sign off and pay/ })).toBeEnabled();
});

test("says when the claim can't be loaded", async () => {
  show({ [`GET ${BASE}/steps`]: () => [200, []] });
  expect(await screen.findByRole("alert")).toHaveTextContent("Not found");
});

test("says when working the claim fails", async () => {
  const user = userEvent.setup();
  show({
    ...fixed(claim()),
    [`POST ${BASE}/work`]: () => [409, { detail: "A dispatch is going." }],
  });
  await user.click(await screen.findByRole("button", { name: "Work this claim" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("A dispatch is going.");
});

test("a sign-off that worked says so even when the steps don't reload", async () => {
  const user = userEvent.setup();
  let signedOff = false;
  show({
    [`GET ${BASE}`]: () => [
      200,
      signedOff ? claim({ status: "decided", decision: APPROVAL }) : held,
    ],
    [`GET ${BASE}/steps`]: () =>
      signedOff ? [500, { detail: "Steps unavailable" }] : [200, STEPS],
    [`POST ${BASE}/sign-off`]: () => {
      signedOff = true;
      return [200, claim({ status: "decided", decision: APPROVAL })];
    },
  });
  await user.click(await screen.findByRole("button", { name: /Sign off and pay/ }));
  await user.click(screen.getByRole("button", { name: "Pay $1,250.00" }));
  expect(await screen.findByRole("region", { name: "Recommendation" })).toBeInTheDocument();
  expect(screen.getByText(/Signed off and paid/)).toBeInTheDocument();
  // The steps already shown stay while the reload's failure is reported.
  expect(screen.getByText("The model declined to continue")).toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent("Steps unavailable");
});
