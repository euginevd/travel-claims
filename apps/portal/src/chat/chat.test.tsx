import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Cover, CustomerClaimSummary, Draft } from "../api";
import { App } from "../App";
import { saveToken } from "../session";
import { fakeFetch, MAYA, MY_POLICY, MY_SUMMARY, myClaim, type Routes } from "../testing";
import { pickNews, place, suggestions } from "./arrival";
import { fill, firstQuestion, nextMissing, toNewClaim } from "./claimFlow";

const COVER: Cover = {
  policy_id: "POL-2001",
  destination: "Rome, Italy",
  departs_on: "2026-06-10",
  returns_on: "2026-06-18",
  plan: {
    plan: "premium",
    name: "UnderCover Premium",
    trip_cancellation_max: 5000,
    trip_delay_waiting_hours: 6,
    trip_delay_max: 800,
    baggage_delay_waiting_hours: 12,
    baggage_delay_max: 300,
    baggage_max: 1500,
    per_item_limit: 300,
    passport_max: 250,
    emergency_medical_max: 100000,
    deductible: 50,
  },
  add_ons: [],
};

const paid: CustomerClaimSummary = {
  ...MY_SUMMARY,
  claim_id: "CLM-1002",
  status: "paid",
  claim_type: "passport",
};
const needs: CustomerClaimSummary = { ...MY_SUMMARY, claim_id: "CLM-1003", open_requests: 1 };

// --- What arrival shows ---

test("something we need comes before any news, and news can be dismissed for good", () => {
  expect(pickNews([paid, needs], [], null, new Set())?.key).toBe("need:CLM-1003");
  expect(pickNews([paid, needs], [], null, new Set(["need:CLM-1003"]))?.key).toBe("paid:CLM-1002");
  expect(pickNews([paid], [], null, new Set())?.title).toBe("Your passport claim is paid");
  expect(pickNews([paid], [], null, new Set(["paid:CLM-1002"]))).toBeNull();
});

test("the suggestions come from the records and skip a claim the news already covers", () => {
  const news = pickNews([needs], [], null, new Set());
  const labels = suggestions([MY_POLICY], [needs, MY_SUMMARY], news).map((s) => s.label);
  expect(labels).toEqual([
    "Something went wrong in Rome",
    "How's my delay claim going?",
    "What am I covered for?",
  ]);
  expect(place("Nairobi and the Maasai Mara, Kenya")).toBe("Nairobi");
});

// --- A claim by chat, steered by code ---

const DRAFT: Draft = {
  claim_type: "baggage",
  summary: "Bag lost flying to Rome",
  story: "",
  incident_date: "",
  incident_location: "Rome, Italy",
  items: [{ description: "Suitcase", category: "luggage", amount: 310, source: "receipt" }],
  missing_questions: ["The customer has not given a date", "Did the airline pay you anything?"],
  low_confidence_fields: [],
};

test("the trip's dates answer 'when', and code asks only for what's still missing", () => {
  const first = firstQuestion("lost_bag", MY_POLICY);
  expect(first.replies.map((r) => [r.label, r.day])).toEqual([
    ["Flying out", "2026-06-10"],
    ["During the trip", undefined],
    ["Flying home", "2026-06-18"],
  ]);
  const filled = fill(DRAFT, "lost_bag", ["I lost my bag."], "2026-06-10");
  expect(filled.incidentDate).toBe("2026-06-10");
  // An internal note never reaches the customer; the assistant's real question does.
  expect(filled.questions).toEqual(["Did the airline pay you anything?"]);
  expect(nextMissing(filled, new Set())).toEqual({ question: "Did the airline pay you anything?" });
  expect(nextMissing(filled, new Set(["Did the airline pay you anything?"]))).toBeNull();
  expect(nextMissing({ ...filled, incidentDate: "" }, new Set())).toBe("date");
  expect(toNewClaim("POL-2001", filled)).toMatchObject({
    claim_type: "baggage",
    incident_date: "2026-06-10",
    story: "I lost my bag.",
    items: [{ description: "Suitcase", amount: 310 }],
  });
});

// --- The portal ---

const routes: Routes = {
  "GET /api/customer/profile": () => [200, MAYA],
  "GET /api/customer/claims": () => [200, [MY_SUMMARY]],
  "GET /api/customer/policies": () => [200, [MY_POLICY]],
  "GET /api/customer/cover": () => [200, [COVER]],
  "GET /api/customer/claims/CLM-1001": () => [200, myClaim()],
  "GET /api/customer/notices": () => [200, []],
  "GET /api/customer/delays": () => [200, []],
  "GET /api/customer/draft": () => [200, null],
  "PUT /api/customer/draft": (body) => [200, { draft: body, updated_at: "2026-11-13T09:00:00Z" }],
  "DELETE /api/customer/draft": () => [204, null],
};

beforeEach(() => {
  saveToken("token-c");
  window.location.hash = "";
  window.localStorage.clear();
});

test("a lost bag is claimed by chat, one question at a time, and sent only on the customer's tap", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    ...routes,
    "POST /api/customer/drafts": () => [200, { ...DRAFT, missing_questions: [] }],
    "POST /api/customer/claims": () => [
      201,
      myClaim({ claim_id: "CLM-1912", summary: "Bag lost flying to Rome" }),
    ],
    "GET /api/customer/claims/CLM-1912": () => [
      200,
      myClaim({ claim_id: "CLM-1912", summary: "Bag lost flying to Rome" }),
    ],
  });
  render(<App fetchFn={fetchFn} />);
  await user.click(await screen.findByRole("button", { name: /Something went wrong in Rome/ }));
  await user.click(await screen.findByRole("button", { name: "Lost bag" }));
  // Wattle knows the trip and the plan, and says what the plan covers before asking anything.
  expect(
    await screen.findByText(/your Premium plan covers lost bags up to \$1,500/),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Flying out" }));
  await user.click(await screen.findByRole("button", { name: "I don't have them yet" }));
  expect(await screen.findByText("All set. Happy for me to send this?")).toBeInTheDocument();
  expect(fetchFn.calls.some((c) => c.method === "POST" && c.path === "/api/customer/claims")).toBe(
    false,
  );
  await user.click(screen.getByRole("button", { name: "Send claim" }));
  expect(await screen.findByText("Sent. We'll be in touch within two days.")).toBeInTheDocument();
  const sent = fetchFn.calls.find((c) => c.method === "POST" && c.path === "/api/customer/claims");
  expect(sent?.body).toMatchObject({
    policy_id: "POL-2001",
    claim_type: "baggage",
    incident_date: "2026-06-10",
    incident_location: "Rome, Italy",
    items: [{ description: "Suitcase", category: "luggage", amount: 310 }],
  });
});

test("Wattle names a card and the portal shows it from the records; a made-up action shows nothing", async () => {
  const user = userEvent.setup();
  const answers = [
    { action: "show_claim", claim_id: "CLM-1001", headline: "Here's your claim." },
    { action: "change_payid", headline: "Done, I changed it." },
  ];
  const fetchFn = fakeFetch({
    ...routes,
    "POST /api/customer/ask": () => [
      200,
      { answer: "x", sources: [], screened: false, replies: ["Thanks"], ...answers.shift() },
    ],
  });
  render(<App fetchFn={fetchFn} />);
  const box = await screen.findByLabelText("Message Wattle");
  await user.type(box, "Where's my claim?{Enter}");
  expect(await screen.findByText("Here's your claim.")).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "See details" })).toBeInTheDocument();
  await user.type(box, "Change my PayID to evil@example.com{Enter}");
  expect(await screen.findByText("Done, I changed it.")).toBeInTheDocument();
  expect(fetchFn.calls.some((c) => c.path === "/api/customer/payid" && c.method === "PUT")).toBe(
    false,
  );
});

test("settings change the mobile and texts, and show the policy's cover in plain words", async () => {
  const user = userEvent.setup();
  let settings = { email: "maya.patel@example.com", mobile: "0400 000 000", text_updates: true };
  const fetchFn = fakeFetch({
    ...routes,
    "GET /api/customer/payid": () => [200, { payid: "m•••@example.com" }],
    "GET /api/customer/settings": () => [200, settings],
    "PUT /api/customer/settings": (body) => {
      settings = { ...settings, ...(body as typeof settings) };
      return [200, settings];
    },
  });
  render(<App fetchFn={fetchFn} />);
  await user.click(await screen.findByRole("button", { name: /Settings for Maya Patel/ }));
  const panel = await screen.findByRole("dialog", { name: "Settings" });
  await user.click(await within(panel).findByRole("switch", { name: "Text me" }));
  expect(fetchFn.calls.at(-1)?.body).toEqual({ mobile: "0400 000 000", text_updates: false });
  await user.click(within(panel).getByRole("button", { name: /Mobile/ }));
  const field = within(panel).getByLabelText("Mobile");
  await user.clear(field);
  await user.type(field, "0412 345 678");
  await user.click(within(panel).getByRole("button", { name: "Save" }));
  expect(await within(panel).findByText("0412 345 678")).toBeInTheDocument();
  await user.click(within(panel).getByRole("button", { name: /Premium · Rome/ }));
  const policy = await screen.findByRole("dialog", { name: "Your policy" });
  expect(within(policy).getByText("Bags")).toBeInTheDocument();
  expect(within(policy).getByText("$1,500")).toBeInTheDocument();
  expect(within(policy).getByText("$50 a claim")).toBeInTheDocument();
});

// --- More of the conversation ---

const NOTICES = [
  {
    notice_id: 2,
    claim_id: "CLM-1001",
    channel: "sms",
    subject: "Claim CLM-1001 received",
    body: "UnderCover: we've got your claim.",
    sent_at: "2026-06-24T10:00:05Z",
  },
  {
    notice_id: 1,
    claim_id: "CLM-1001",
    channel: "email",
    subject: "We've got your claim CLM-1001",
    body: "Thanks, Maya. We'll start on it shortly.",
    sent_at: "2026-06-24T10:00:00Z",
  },
];

test("an email and its text are one message, and opening Messages clears the dot", async () => {
  const user = userEvent.setup();
  render(
    <App fetchFn={fakeFetch({ ...routes, "GET /api/customer/notices": () => [200, NOTICES] })} />,
  );
  const banner = await screen.findByRole("banner");
  expect(await within(banner).findByText(", new")).toBeInTheDocument();
  await user.click(within(banner).getByRole("button", { name: /Messages/ }));
  const panel = await screen.findByRole("dialog", { name: "Messages" });
  expect(within(panel).getAllByRole("listitem")).toHaveLength(1);
  expect(within(panel).getByText(/^Email and text ·/)).toBeInTheDocument();
  expect(within(banner).queryByText(", new")).not.toBeInTheDocument();
  await user.click(within(panel).getByRole("button", { name: "Open the claim" }));
  expect(await screen.findByRole("dialog", { name: "Your claim" })).toBeInTheDocument();
});

test("a decided claim shows why, the AI line and a way to ask a person to look again", async () => {
  const user = userEvent.setup();
  let asked: unknown = null;
  const decided = myClaim({
    status: "declined",
    outcome: "decline",
    reason: "Delays under six hours aren't covered.",
    can_request_review: true,
  });
  const fetchFn = fakeFetch({
    ...routes,
    "GET /api/customer/claims/CLM-1001": () => [200, decided],
    "GET /api/customer/claims/CLM-1001/feedback": () => [200, null],
    "POST /api/customer/claims/CLM-1001/review-request": (body) => {
      asked = body;
      return [200, { ...decided, review_requested: true, can_request_review: false }];
    },
  });
  window.location.hash = "#/claims/CLM-1001";
  render(<App fetchFn={fetchFn} />);
  const panel = await screen.findByRole("dialog", { name: "Your claim" });
  expect(await within(panel).findByText("We couldn't pay this one.")).toBeInTheDocument();
  expect(within(panel).getByText("Delays under six hours aren't covered.")).toBeInTheDocument();
  expect(within(panel).getByText(/Decided with help from our AI/)).toBeInTheDocument();
  await user.type(within(panel).getByLabelText(/Want a person to look again/), "It was 7 hours");
  await user.click(within(panel).getByRole("button", { name: "Ask a person to look again" }));
  expect(await within(panel).findByText(/A claims handler will be in touch/)).toBeInTheDocument();
  expect(asked).toEqual({ note: "It was 7 hours" });
  await user.click(within(panel).getByRole("button", { name: "Back" }));
  expect(await screen.findByRole("dialog", { name: "Your claims" })).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("something we need opens in the chat ready to send, and dismissing hides it until next time", async () => {
  const user = userEvent.setup();
  const asking = { ...MY_SUMMARY, open_requests: 1 };
  const request = {
    request_id: 7,
    text: "The airline's letter about the delay",
    asked_by: "Dana",
    asked_at: "2026-06-25T09:00:00Z",
    fulfilled_at: null,
    files: 0,
  };
  const fetchFn = fakeFetch({
    ...routes,
    "GET /api/customer/claims": () => [200, [asking]],
    "GET /api/customer/claims/CLM-1001": () => [
      200,
      myClaim({ open_requests: 1, requests: [request] }),
    ],
  });
  const { unmount } = render(<App fetchFn={fetchFn} />);
  await user.click(
    await screen.findByRole("button", { name: /We need one thing for your delay claim/ }),
  );
  expect(await screen.findByText("Send this and we can carry on.")).toBeInTheDocument();
  expect(await screen.findByText("The airline's letter about the delay")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /New chat/ }));
  await user.click(await screen.findByRole("button", { name: "Remind me next time" }));
  expect(screen.queryByText(/We need one thing/)).not.toBeInTheDocument();
  unmount();
  render(<App fetchFn={fetchFn} />);
  expect(await screen.findByText(/We need one thing for your delay claim/)).toBeInTheDocument();
});

test("a delayed flight is claimed in one tap from the arrival line", async () => {
  const user = userEvent.setup();
  const offer = {
    flight_id: "FL-2001-1",
    policy_id: "POL-2001",
    flight: "AZ 610",
    route: "Rome to New York",
    date: "2026-06-18",
    delay_minutes: 400,
    waiting_hours: 6,
    estimate: 300,
  };
  const fetchFn = fakeFetch({
    ...routes,
    "GET /api/customer/claims": () => [200, []],
    "GET /api/customer/delays": () => [200, [offer]],
    "POST /api/customer/delays/FL-2001-1/claim": () => [201, myClaim()],
  });
  render(<App fetchFn={fetchFn} />);
  await user.click(
    await screen.findByRole("button", { name: /Your flight AZ 610 was late enough to claim/ }),
  );
  await user.click(await screen.findByRole("button", { name: "Claim $300.00" }));
  expect(await screen.findByText("Sent. We'll be in touch soon.")).toBeInTheDocument();
});

test("a paid claim's news can be dismissed for good", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    ...routes,
    "GET /api/customer/claims": () => [
      200,
      [{ ...MY_SUMMARY, status: "paid", status_text: "Paid $420.00" }],
    ],
    "GET /api/customer/claims/CLM-1001": () => [
      200,
      myClaim({ status: "paid", paid: 420, paid_to: "PayID" }),
    ],
  });
  const { unmount } = render(<App fetchFn={fetchFn} />);
  await user.click(await screen.findByRole("button", { name: /Your delay claim is paid/ }));
  expect(await screen.findByText("Paid $420.00")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /New chat/ }));
  await user.click(await screen.findByRole("button", { name: "Dismiss" }));
  unmount();
  render(<App fetchFn={fetchFn} />);
  await screen.findByRole("heading", { level: 1, name: /^Hi Maya/ });
  expect(screen.queryByText(/is paid/)).not.toBeInTheDocument();
});

test("a claim saved earlier is finished from the arrival line, asking for what's still missing", async () => {
  const user = userEvent.setup();
  const saved = {
    draft: {
      policy_id: "POL-2001",
      case: "medical",
      text: "I hurt my ankle hiking.",
      claim_type: "emergency_medical",
      summary: "Hurt ankle",
      story: "",
      incident_date: "",
      incident_location: "",
      items: [],
      step: "what",
    },
    updated_at: "2026-11-12T09:00:00Z",
  };
  let drafts = 0;
  const fetchFn = fakeFetch({
    ...routes,
    "GET /api/customer/claims": () => [200, []],
    "GET /api/customer/draft": () => [200, saved],
    "POST /api/customer/drafts": () => {
      drafts += 1;
      return [
        200,
        {
          ...DRAFT,
          claim_type: "emergency_medical",
          incident_location: "",
          items:
            drafts === 1
              ? []
              : [{ description: "Clinic", category: "medical", amount: 120, source: "" }],
          missing_questions: [],
        },
      ];
    },
    "POST /api/customer/claims": () => [500, { detail: "The database is busy" }],
  });
  render(<App fetchFn={fetchFn} />);
  await user.click(
    await screen.findByRole("button", { name: /You have a claim you haven't sent/ }),
  );
  await user.click(await screen.findByRole("button", { name: "I don't have them yet" }));
  // No date, place or amounts yet: Wattle asks for each, one at a time.
  expect(await screen.findByText("What day did it happen?")).toBeInTheDocument();
  await user.type(screen.getByLabelText("The day it happened"), "2026-06-12");
  await user.click(screen.getByRole("button", { name: "That's the day" }));
  expect(await screen.findByText("Where were you when it happened?")).toBeInTheDocument();
  const box = screen.getByLabelText("Message Wattle");
  await user.type(box, "Rome{Enter}");
  expect(await screen.findByText(/What are you claiming for/)).toBeInTheDocument();
  await user.type(box, "The clinic, $120{Enter}");
  expect(await screen.findByText("All set. Happy for me to send this?")).toBeInTheDocument();
  // The check card changes in place: an amount left empty is caught, then saved.
  await user.click(screen.getByRole("button", { name: "Change something" }));
  const amount = screen.getByLabelText("Amount for item 1");
  await user.clear(amount);
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Each item needs a name and an amount.")).toBeInTheDocument();
  await user.type(amount, "150");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findAllByText("$150.00")).not.toHaveLength(0);
  await user.click(await screen.findByRole("button", { name: "Send claim" }));
  // A refusal says why and keeps the claim to try again.
  expect(await screen.findByText("The database is busy")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

test("when Wattle hears trouble it starts the claim; a failed answer offers a person", async () => {
  const user = userEvent.setup();
  let calls = 0;
  const fetchFn = fakeFetch({
    ...routes,
    "POST /api/customer/ask": () => {
      calls += 1;
      if (calls === 2) return [503, { detail: "The assistant isn't available right now" }];
      return [
        200,
        {
          answer: "Sorry to hear that.",
          headline: "Sorry to hear that.",
          sources: ["Policy wording section 5"],
          screened: false,
          action: "start_claim",
          claim_type: "stolen",
        },
      ];
    },
  });
  render(<App fetchFn={fetchFn} />);
  const box = await screen.findByLabelText("Message Wattle");
  await user.type(box, "My phone was stolen in Rome{Enter}");
  expect(await screen.findByText(/let's sort it out/)).toBeInTheDocument();
  expect(screen.queryByText("Sorry to hear that.")).not.toBeInTheDocument();
  expect(await screen.findByText("What was taken, and where were you?")).toBeInTheDocument();
  expect(screen.getByText("Checked your policy")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /New chat/ }));
  await user.type(
    await screen.findByLabelText("Message Wattle"),
    "Am I covered for skiing?{Enter}",
  );
  expect(await screen.findByText("Sorry, that didn't work.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Talk to a person" }));
  expect(await screen.findByText(/claims@undercover.example/)).toBeInTheDocument();
});

test("the claim suggestion and cover need no model, and a file starts a claim", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch(routes);
  render(<App fetchFn={fetchFn} />);
  await user.click(await screen.findByRole("button", { name: /How's my delay claim going/ }));
  expect(await screen.findByRole("button", { name: "See details" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /New chat/ }));
  await user.click(await screen.findByRole("button", { name: /What am I covered for/ }));
  expect(await screen.findByText("You're on Premium.")).toBeInTheDocument();
  expect(fetchFn.calls.some((c) => c.path === "/api/customer/ask")).toBe(false);
  await user.click(screen.getByRole("button", { name: "See all your cover" }));
  expect(await screen.findByRole("dialog", { name: "Your policy" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Ask about this policy" }));
  expect(await screen.findByText("Tell me about my Premium policy")).toBeInTheDocument();
});

test("files that aren't receipts are refused plainly before anything is read", async () => {
  const user = userEvent.setup({ applyAccept: false });
  render(<App fetchFn={fakeFetch(routes)} />);
  await user.click(await screen.findByRole("button", { name: /Something went wrong in Rome/ }));
  await user.click(await screen.findByRole("button", { name: "Lost bag" }));
  await user.click(await screen.findByRole("button", { name: "Flying out" }));
  const input = await screen.findByLabelText(/Snap them or drop them here/);
  await user.upload(input, new File(["x"], "notes.txt", { type: "text/plain" }));
  expect(await screen.findByText("notes.txt isn't a JPEG, PNG or PDF.")).toBeInTheDocument();
});

test("the claims panel lists claims and starts a new one", async () => {
  const user = userEvent.setup();
  render(<App fetchFn={fakeFetch(routes)} />);
  await user.click(await screen.findByRole("button", { name: /^Claims$/ }));
  const panel = await screen.findByRole("dialog", { name: "Your claims" });
  expect(within(panel).getByText("In progress")).toBeInTheDocument();
  await user.click(within(panel).getByRole("button", { name: "Make a claim" }));
  expect(await screen.findByText("What happened?")).toBeInTheDocument();
});

test("each of Wattle's actions shows its card, and a tap answer asks again", async () => {
  const user = userEvent.setup();
  const answers = [
    { action: "show_claims", headline: "Here they are." },
    {
      action: "show_policy",
      headline: "Here's your cover.",
      points: [{ text: "Bags up to **$1,500**", source: 1 }],
      sources: ["Policy wording section 5"],
    },
    { action: "settings", headline: "You can change that in Settings." },
    { action: "talk_to_person", headline: "A person can help with that.", replies: ["Thanks"] },
    { headline: "You're welcome." },
  ];
  const fetchFn = fakeFetch({
    ...routes,
    "POST /api/customer/ask": () => [
      200,
      { answer: "x", sources: [], screened: false, ...answers.shift() },
    ],
  });
  render(<App fetchFn={fetchFn} />);
  const box = await screen.findByLabelText("Message Wattle");
  await user.type(box, "My claims{Enter}");
  expect(await screen.findByRole("button", { name: /Flight home canceled/ })).toBeInTheDocument();
  await user.type(box, "My cover{Enter}");
  expect(await screen.findByText("$1,500", { selector: "strong" })).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "See all your cover" }).length).toBeGreaterThan(0);
  await user.type(box, "Change my mobile{Enter}");
  await user.click(await screen.findByRole("button", { name: "Open Settings" }));
  expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await user.type(box, "I'm not happy{Enter}");
  expect(await screen.findByText(/claims@undercover.example/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Thanks" }));
  expect(await screen.findByText("You're welcome.")).toBeInTheDocument();
});

test("too many questions in an hour says so, and the claims card says when there are none", async () => {
  const user = userEvent.setup();
  let first = true;
  const fetchFn = fakeFetch({
    ...routes,
    "GET /api/customer/claims": () => [200, []],
    "POST /api/customer/ask": () => {
      if (first) {
        first = false;
        return [429, { detail: "That's a lot of questions in an hour. Please try again later." }];
      }
      return [
        200,
        { answer: "x", headline: "None yet.", sources: [], screened: false, action: "show_claims" },
      ];
    },
  });
  render(<App fetchFn={fetchFn} />);
  const box = await screen.findByLabelText("Message Wattle");
  await user.type(box, "hi{Enter}");
  expect(await screen.findByText(/a lot of questions in an hour/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("No claims yet.")).toBeInTheDocument();
});

test("a typed first answer and a good receipt go to the drafting assistant together", async () => {
  const user = userEvent.setup();
  let drafted: unknown = null;
  const fetchFn = fakeFetch({
    ...routes,
    "POST /api/customer/drafts": (body) => {
      drafted = body;
      return [
        200,
        {
          ...DRAFT,
          claim_type: "emergency_medical",
          incident_date: "2026-06-12",
          missing_questions: [],
        },
      ];
    },
  });
  render(<App fetchFn={fetchFn} />);
  await user.click(await screen.findByRole("button", { name: /Something went wrong in Rome/ }));
  await user.click(await screen.findByRole("button", { name: "Medical" }));
  const box = screen.getByLabelText("Message Wattle");
  expect(box).toHaveAttribute("placeholder", "Type your answer");
  await user.type(box, "I fell and saw a doctor in Rome{Enter}");
  const input = await screen.findByLabelText(/Snap them or drop them here/);
  await user.upload(
    input,
    new File([new Uint8Array([0x89, 0x50])], "bill.png", { type: "image/png" }),
  );
  expect(await screen.findByText("Read 1 document")).toBeInTheDocument();
  expect(await screen.findByText("All set. Happy for me to send this?")).toBeInTheDocument();
  expect(drafted).toBeInstanceOf(FormData);
});

test("the panels say plainly when there's nothing to show or a claim won't load", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    ...routes,
    "GET /api/customer/claims": () => [200, []],
    "GET /api/customer/claims/CLM-9999": () => [404, { detail: "No such claim" }],
  });
  render(<App fetchFn={fetchFn} />);
  const banner = await screen.findByRole("banner");
  await user.click(within(banner).getByRole("button", { name: /Messages/ }));
  expect(await screen.findByText("Nothing yet. We'll let you know here.")).toBeInTheDocument();
  await user.click(within(banner).getByRole("button", { name: /^Claims$/ }));
  expect(await screen.findByText("No claims yet. Tell Wattle what happened.")).toBeInTheDocument();
  window.location.hash = "#/claims/CLM-9999";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  expect(await screen.findByRole("alert")).toHaveTextContent("No such claim");
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

const png = (name: string) => new File([new Uint8Array([0x89, 0x50])], name, { type: "image/png" });

test("a typed day or one outside the trip is asked again; typed amounts need no model", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    ...routes,
    // The drafting assistant is down: code asks for everything itself.
    "POST /api/customer/drafts": () => [503, { detail: "The assistant isn't available right now" }],
    "POST /api/customer/claims": () => [201, myClaim({ claim_id: "CLM-1913" })],
    "GET /api/customer/claims/CLM-1913": () => [200, myClaim({ claim_id: "CLM-1913" })],
  });
  render(<App fetchFn={fetchFn} />);
  await user.click(await screen.findByRole("button", { name: /Something went wrong in Rome/ }));
  await user.click(await screen.findByRole("button", { name: "Medical" }));
  const box = screen.getByLabelText("Message Wattle");
  await user.type(box, "I fell over{Enter}");
  await user.click(await screen.findByRole("button", { name: "I don't have them yet" }));
  expect(await screen.findByText("What day did it happen?")).toBeInTheDocument();
  await user.type(box, "last Tuesday{Enter}");
  expect(
    await screen.findByText(
      /^Pick the day from the calendar, between 10 June? 2026 and 18 June? 2026\.$/,
    ),
  ).toBeInTheDocument();
  await user.type(screen.getByLabelText("The day it happened"), "2026-06-12");
  await user.click(screen.getByRole("button", { name: "That's the day" }));
  await user.type(await screen.findByLabelText("Message Wattle"), "Rome{Enter}");
  await user.type(box, "The clinic $120 and medicine $45{Enter}");
  expect(await screen.findByText("All set. Happy for me to send this?")).toBeInTheDocument();
  expect(screen.getByText("$165.00")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Send claim" }));
  expect(await screen.findByText("Sent. We'll be in touch within two days.")).toBeInTheDocument();
  const sent = fetchFn.calls.find((c) => c.method === "POST" && c.path === "/api/customer/claims");
  expect(sent?.body).toMatchObject({
    incident_date: "2026-06-12",
    incident_location: "Rome",
    items: [
      { description: "The clinic", amount: 120 },
      { description: "medicine", amount: 45 },
    ],
  });
});

test("five files in all, and files that fail after sending are owned up to", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    ...routes,
    "POST /api/customer/drafts": () => [
      200,
      { ...DRAFT, incident_date: "2026-06-10", missing_questions: [] },
    ],
    "POST /api/customer/claims": () => [201, myClaim({ claim_id: "CLM-1914" })],
    "GET /api/customer/claims/CLM-1914": () => [200, myClaim({ claim_id: "CLM-1914" })],
    "POST /api/customer/claims/CLM-1914/receipts": () => [500, { detail: "Storage is down" }],
  });
  render(<App fetchFn={fetchFn} />);
  // Files first: they wait for the claim.
  await screen.findByRole("heading", { level: 1, name: /^Hi Maya/ });
  const attach = document.querySelector<HTMLInputElement>(
    ".composer input[type=file]:not([capture])",
  );
  if (!attach) throw new Error("no file input");
  await user.upload(attach, [png("a.png"), png("b.png"), png("c.png")]);
  await user.click(await screen.findByRole("button", { name: "Lost bag" }));
  await user.click(await screen.findByRole("button", { name: "Flying out" }));
  await user.upload(await screen.findByLabelText(/Snap them or drop them here/), [
    png("d.png"),
    png("e.png"),
    png("f.png"),
  ]);
  expect(await screen.findByText("A claim can have up to 5 files.")).toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: "Send claim" }));
  expect(
    await screen.findByText(
      "Sent, but your files didn't come through. Add them again from the claim.",
    ),
  ).toBeInTheDocument();
  const drafted = fetchFn.calls.find((c) => c.path === "/api/customer/drafts")?.body as FormData;
  expect(drafted.getAll("files")).toHaveLength(5);
});

test("a sent claim takes more receipts from its page in the panel", async () => {
  const user = userEvent.setup();
  const waiting = myClaim({ can_add_receipts: true, receipts: [] });
  const fetchFn = fakeFetch({
    ...routes,
    "GET /api/customer/claims/CLM-1001": () => [200, waiting],
    "POST /api/customer/claims/CLM-1001/receipts": () => [
      201,
      {
        ...waiting,
        receipts: [
          { receipt_id: "r1", media_type: "image/png", size: 2, uploaded_at: "2026-06-25" },
        ],
      },
    ],
  });
  window.location.hash = "#/claims/CLM-1001";
  render(<App fetchFn={fetchFn} />);
  const panel = await screen.findByRole("dialog", { name: "Your claim" });
  await user.upload(await within(panel).findByLabelText("Add receipts"), png("taxi.png"));
  expect(await within(panel).findByText("1 receipt sent.")).toBeInTheDocument();
});

test("Home shows the start screen and key facts over a chat, and the chat is kept", async () => {
  const user = userEvent.setup();
  render(<App fetchFn={fakeFetch(routes)} />);
  await user.click(await screen.findByRole("button", { name: /How's my delay claim going/ }));
  expect(await screen.findByRole("button", { name: "See details" })).toBeInTheDocument();
  await user.click(within(screen.getByRole("banner")).getByRole("button", { name: /Home/ }));
  expect(await screen.findByRole("region", { name: "At a glance" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "See details" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Back to your chat" }));
  expect(await screen.findByRole("button", { name: "See details" })).toBeInTheDocument();
});

test("claims show three in each group, then five more a tap", async () => {
  const user = userEvent.setup();
  const many = Array.from({ length: 9 }, (_, i) => ({
    ...MY_SUMMARY,
    claim_id: `CLM-${String(1100 + i)}`,
    summary: `Claim number ${String(i + 1)}`,
  }));
  render(<App fetchFn={fakeFetch({ ...routes, "GET /api/customer/claims": () => [200, many] })} />);
  await user.click(
    await within(await screen.findByRole("banner")).findByRole("button", { name: /Claims/ }),
  );
  const panel = await screen.findByRole("dialog", { name: "Your claims" });
  expect(within(panel).getAllByRole("button", { name: /Claim number/ })).toHaveLength(3);
  await user.click(within(panel).getByRole("button", { name: "Show 5 more" }));
  expect(within(panel).getAllByRole("button", { name: /Claim number/ })).toHaveLength(8);
  await user.click(within(panel).getByRole("button", { name: "Show 1 more" }));
  expect(within(panel).getAllByRole("button", { name: /Claim number/ })).toHaveLength(9);
});

test("done claims stay folded until asked for", async () => {
  const user = userEvent.setup();
  const paid = {
    ...MY_SUMMARY,
    claim_id: "CLM-1200",
    summary: "An old paid claim",
    status: "paid",
  };
  render(
    <App
      fetchFn={fakeFetch({
        ...routes,
        "GET /api/customer/claims": () => [200, [MY_SUMMARY, paid]],
      })}
    />,
  );
  await user.click(
    await within(await screen.findByRole("banner")).findByRole("button", { name: /Claims/ }),
  );
  const panel = await screen.findByRole("dialog", { name: "Your claims" });
  expect(within(panel).queryByText("An old paid claim")).not.toBeInTheDocument();
  await user.click(within(panel).getByRole("button", { name: /Done/ }));
  expect(within(panel).getByText("An old paid claim")).toBeInTheDocument();
});
