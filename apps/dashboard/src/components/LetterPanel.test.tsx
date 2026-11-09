import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi, type Claim } from "../api";
import { APPROVAL, claim, fakeFetch } from "../testing";
import { LetterPanel } from "./LetterPanel";

const BASE = "/api/staff/claims/CLM-1001/letter";

test("drafts a letter with AI, lets the handler edit it, and sends it", async () => {
  const user = userEvent.setup();
  const decided = claim({ status: "decided", decision: APPROVAL });
  let updated: Claim | null = null;
  const fetchFn = fakeFetch({
    [`POST ${BASE}/draft`]: () => [200, { subject: "Approved", body: "Dear Maya, it's approved." }],
    [`PUT ${BASE}`]: (body) => [
      200,
      claim({
        status: "decided",
        decision: APPROVAL,
        letter: {
          ...(body as { subject: string; body: string; drafted_by_ai: boolean }),
          sent_by: "Dana Whitfield",
          sent_at: "2026-11-09T09:00:00Z",
        },
      }),
    ],
  });
  render(
    <LetterPanel
      api={createApi(fetchFn, () => "t")}
      claim={decided}
      onUpdated={(next) => {
        updated = next;
      }}
    />,
  );
  await user.click(screen.getByRole("button", { name: /Draft with AI/ }));
  expect(await screen.findByDisplayValue("Approved")).toBeInTheDocument();
  expect(screen.getByText(/check it before you send it/)).toBeInTheDocument();
  await user.clear(screen.getByLabelText("Subject"));
  await user.type(screen.getByLabelText("Subject"), "Good news");
  await user.click(screen.getByRole("button", { name: /Send to the customer/ }));
  const sent = fetchFn.calls.find((c) => c.method === "PUT");
  expect(sent?.body).toEqual({
    subject: "Good news",
    body: "Dear Maya, it's approved.",
    drafted_by_ai: true,
  });
  expect(updated).not.toBeNull();
});

test("shows a sent letter, and says why a draft failed", async () => {
  const user = userEvent.setup();
  const sent = claim({
    status: "decided",
    decision: APPROVAL,
    letter: {
      subject: "Good news",
      body: "Paid.",
      drafted_by_ai: false,
      sent_by: "Dana Whitfield",
      sent_at: "2026-11-09T09:00:00Z",
    },
  });
  const fetchFn = fakeFetch({ [`POST ${BASE}/draft`]: () => [503, { detail: "Not available" }] });
  render(
    <LetterPanel api={createApi(fetchFn, () => "t")} claim={sent} onUpdated={() => undefined} />,
  );
  expect(screen.getByText("Good news")).toBeInTheDocument();
  expect(screen.getByText(/Sent by Dana Whitfield/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /Draft a new letter/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Not available");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Write it myself" }));
  expect(screen.getByLabelText("Letter")).toBeInTheDocument();
});
