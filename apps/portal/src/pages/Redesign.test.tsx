import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi, type Draft, type Notice } from "../api";
import { initials } from "../components/Header";
import { SAYS, SignInMap } from "../components/SignInMap";
import { fakeFetch, MY_POLICY, MY_SUMMARY, type Routes } from "../testing";
import { MyClaimsPage, STAGE_TIME } from "./MyClaimsPage";
import { NewClaimPage } from "./NewClaimPage";
import { groupNotices, toneOf, UpdatesPage } from "./UpdatesPage";

function apiFor(routes: Routes) {
  const fetchFn = fakeFetch(routes);
  return { api: createApi(fetchFn, () => "token-c"), fetchFn };
}

function notice(id: number, channel: "email" | "sms", subject: string, body = ""): Notice {
  return {
    notice_id: id,
    claim_id: null,
    channel,
    subject,
    body,
    sent_at: "2026-11-09T01:00:00+00:00",
  };
}

const NOTICES = [
  notice(4, "sms", "Claim CLM-1001 paid", "We've sent $35.00 to your PayID."),
  notice(3, "email", "We need something from you for CLM-1002", "Please send the report."),
  notice(2, "email", "A claims handler is looking at CLM-1002"),
  notice(1, "sms", "Claim CLM-1002 received"),
];

test("updates can be filtered to what needs the customer, payments, emails or texts", async () => {
  const user = userEvent.setup();
  const { api } = apiFor({ "GET /api/customer/notices": () => [200, NOTICES] });
  render(<UpdatesPage api={api} />);
  expect(await screen.findByText("Claim CLM-1001 paid")).toBeInTheDocument();
  const list = () => screen.getAllByRole("listitem").filter((li) => li.closest(".notice-list"));
  expect(list()).toHaveLength(4);

  await user.click(screen.getByRole("button", { name: /Needs you/ }));
  expect(screen.getByRole("button", { name: /Needs you/ })).toHaveAttribute("aria-pressed", "true");
  expect(list()).toHaveLength(1);
  expect(screen.getByText(/We need something from you/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /Payments/ }));
  expect(list()).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: /Emails/ }));
  expect(list()).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: /Texts/ }));
  expect(list()).toHaveLength(2);
});

test("a filter with nothing in it says so", async () => {
  const user = userEvent.setup();
  const { api } = apiFor({
    "GET /api/customer/notices": () => [200, [notice(1, "email", "Hello")]],
  });
  render(<UpdatesPage api={api} />);
  await user.click(await screen.findByRole("button", { name: /Texts/ }));
  expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
});

test("an update's tone comes from what it says", () => {
  expect(toneOf(notice(1, "sms", "Claim paid"))).toBe("good");
  expect(toneOf(notice(1, "email", "We need one thing"))).toBe("warm");
  expect(toneOf(notice(1, "email", "Received"))).toBe("plain");
});

const DRAFT: Draft = {
  claim_type: "baggage",
  summary: "Bag lost on the flight to Rome",
  story: "My bag didn't arrive in Rome.",
  incident_date: "2026-06-11",
  incident_location: "Rome, Italy",
  items: [{ description: "Clothes", category: "clothing", amount: 120, source: "" }],
  missing_questions: [],
  low_confidence_fields: [],
};

test("a customer can just tell Wattle what happened and check the claim it fills in", async () => {
  const user = userEvent.setup();
  const { api, fetchFn } = apiFor({
    "GET /api/customer/policies": () => [200, [MY_POLICY]],
    "POST /api/customer/drafts": () => [200, DRAFT],
  });
  render(<NewClaimPage api={api} />);
  const card = await screen.findByRole("region", { name: "Rather just tell us?" });
  expect(within(card).getByRole("button", { name: "Go" })).toBeDisabled();
  await user.type(
    within(card).getByLabelText("What happened, in a sentence"),
    "My bag didn't arrive in Rome",
  );
  await user.click(within(card).getByRole("button", { name: "Go" }));
  expect(await screen.findByDisplayValue("Bag lost on the flight to Rome")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Check your claim" })).toBeInTheDocument();
  expect(fetchFn.calls.some((call) => call.path === "/api/customer/drafts")).toBe(true);
});

test("the checklist follows the kind of claim chosen", async () => {
  const user = userEvent.setup();
  const { api } = apiFor({ "GET /api/customer/policies": () => [200, [MY_POLICY]] });
  render(<NewClaimPage api={api} />);
  expect(await screen.findByRole("heading", { name: "What we'll ask for" })).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: /Lost bag/ }));
  expect(screen.getByRole("heading", { name: "For a lost bag we'll need" })).toBeInTheDocument();
  expect(screen.getByText("The airline's lost bag report (PIR)")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.queryByRole("region", { name: "Rather just tell us?" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "For a lost bag we'll need" })).toBeInTheDocument();
});

test("a claim waiting on the customer links straight to it, with how long the stage takes", async () => {
  const { api } = apiFor({
    "GET /api/customer/claims": () => [
      200,
      [{ ...MY_SUMMARY, status: "with_a_handler", open_requests: 1 }],
    ],
    "GET /api/customer/cover": () => [200, []],
    "GET /api/customer/delays": () => [200, []],
    "GET /api/customer/payid": () => [200, { payid: null }],
    "GET /api/customer/draft": () => [200, null],
  });
  render(<MyClaimsPage api={api} name="Maya Patel" />);
  expect(await screen.findByRole("link", { name: /Send it/ })).toHaveAttribute(
    "href",
    "#/claims/CLM-1001",
  );
  expect(screen.getByText(STAGE_TIME.with_a_handler)).toBeInTheDocument();
});

test("the sign-in map holds still on the paid moment without motion", () => {
  render(<SignInMap />);
  expect(document.querySelector(".map-tag.paid")).not.toBeNull();
  expect(document.body).toHaveTextContent(SAYS.paid);
});

test("the avatar shows up to two initials", () => {
  expect(initials("Maya Patel")).toBe("MP");
  expect(initials("Oliver James Grant")).toBe("OG");
  expect(initials("Cher")).toBe("C");
  expect(initials("")).toBe("");
});

test("an email and the text sent straight after it about the same claim are one update", () => {
  const email = { ...notice(7, "email", "Your claim CLM-1001 is paid"), claim_id: "CLM-1001" };
  const text = { ...notice(8, "sms", "Claim CLM-1001 paid"), claim_id: "CLM-1001" };
  const other = { ...notice(6, "email", "We've got your claim CLM-1002"), claim_id: "CLM-1002" };
  const updates = groupNotices([text, email, other]);
  expect(updates).toHaveLength(2);
  expect(updates[0]).toMatchObject({ main: email, channels: ["email", "sms"], tone: "good" });
  expect(updates[1]).toMatchObject({ main: other, channels: ["email"] });
});
