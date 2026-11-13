import { caseChips, customerStatuses, type Cover } from "../api";
import { MY_POLICY, MY_SUMMARY, myClaim } from "../testing";
import {
  loadDismissed,
  noun,
  pickNews,
  saveDismissed,
  suggestions,
  DISMISSED_KEY,
} from "./arrival";
import {
  amountsIn,
  ASK_FOR_FILES,
  dayInTrip,
  restored,
  CHIP_LABEL,
  fill,
  firstQuestion,
  missingText,
  nextMissing,
  toSaved,
  total,
} from "./claimFlow";
import { coverLine, coverRows, payFirst, planName } from "./cover";
import { groupNotices, lastSeen, markSeen } from "./messages";
import { kilobytes, receiptProblem } from "./receipts";
import { claimHeadline } from "./SidePanel";

const FIRST: Cover = {
  policy_id: "POL-2006",
  destination: "Bentota, Sri Lanka",
  departs_on: "2026-08-08",
  returns_on: "2026-08-20",
  plan: {
    plan: "first",
    name: "UnderCover First",
    trip_cancellation_max: 10000,
    trip_delay_waiting_hours: 3,
    trip_delay_max: 1500,
    baggage_delay_waiting_hours: 6,
    baggage_delay_max: 500,
    baggage_max: 3000,
    per_item_limit: 500,
    passport_max: 400,
    emergency_medical_max: 250000,
    deductible: 0,
  },
  add_ons: [],
};

test("every kind of trouble has a first question, a line on what to send and a plain label", () => {
  for (const chip of caseChips) {
    const question = firstQuestion(chip, MY_POLICY);
    expect(question.text).toMatch(/\?$|\.$/);
    expect(ASK_FOR_FILES[chip]).toBeTruthy();
    expect(CHIP_LABEL[chip]).toBeTruthy();
    expect(coverLine(FIRST, chip)).toMatch(/First/);
  }
  expect(coverLine(FIRST, "lost_bag")).toBe(
    "Your First plan covers lost bags up to $3,000, with nothing to pay first.",
  );
  expect(coverLine({ ...FIRST, plan: { ...FIRST.plan, deductible: 50 } }, "other")).toBe(
    "You're on First, with $50 to pay first.",
  );
  expect(planName(FIRST)).toBe("First");
  expect(payFirst(FIRST)).toBe("Nothing");
  expect(coverRows(FIRST)[2]).toEqual(["Delays over 3 hours", "$1,500"]);
});

test("each missing detail is asked in plain words, and the claim so far can be saved", () => {
  expect(["date", "place", "items", "type"].map((m) => missingText(m as "date"))).toEqual([
    "What day did it happen?",
    "Where were you when it happened?",
    "What are you claiming for, and roughly how much was each thing?",
    "Which of these is it closest to?",
  ]);
  expect(missingText({ question: "Was it locked?" })).toBe("Was it locked?");
  const filled = { ...fill(null, "other", ["Something odd."], "2026-06-12"), location: "Rome" };
  expect(filled.summary).toBe("Something else");
  expect(
    nextMissing(
      { ...filled, lines: [{ description: "x", category: "other", amount: 1 }] },
      new Set(),
    ),
  ).toBe("type");
  expect(
    total([
      { description: "a", category: "other", amount: 10.005 },
      { description: "b", category: "other", amount: 5 },
    ]),
  ).toBe(15.01);
  expect(toSaved("POL-2001", "medical", ["Hurt"], null)).toMatchObject({
    case: "medical",
    step: "what",
    claim_type: "emergency_medical",
  });
  expect(
    toSaved("POL-2001", "medical", ["Hurt"], {
      ...filled,
      lines: [{ description: "x", category: "medical", amount: 12 }],
    }).items,
  ).toEqual([{ description: "x", category: "medical", amount: "12.00" }]);
});

test("every status reads as one line the customer could stop at", () => {
  for (const status of customerStatuses) {
    expect(claimHeadline(myClaim({ status }))).toMatch(/\.$/);
  }
  expect(
    claimHeadline(
      myClaim({ status: "paid", paid: 243, paid_to: "PayID", paid_at: "2026-11-12T10:00:00Z" }),
    ),
  ).toBe("Paid $243.00 to your PayID on 12 Nov 2026.");
  expect(claimHeadline(myClaim({ status: "paid", paid: null }))).toBe("Paid.");
  const asking = {
    request_id: 1,
    text: "x",
    asked_by: "Dana",
    asked_at: "",
    fulfilled_at: null,
    files: 0,
  };
  expect(claimHeadline(myClaim({ requests: [asking, { ...asking, request_id: 2 }] }))).toBe(
    "We need 2 things, then we can carry on.",
  );
});

test("receipts are checked plainly before they're sent", () => {
  expect(receiptProblem(new File(["x"], "a.png", { type: "image/png" }))).toBeNull();
  expect(receiptProblem(new File([], "a.png", { type: "image/png" }))).toBe("a.png is empty.");
  const big = new File(["x"], "big.pdf", { type: "application/pdf" });
  Object.defineProperty(big, "size", { value: 6 * 1024 * 1024 });
  expect(receiptProblem(big)).toBe("big.pdf is over 5 MB.");
  expect(kilobytes(2048)).toBe("2 KB");
  expect(kilobytes(3 * 1024 * 1024)).toBe("3.0 MB");
});

test("arrival news covers a saved claim, a declined claim and two things asked for", () => {
  const draft = { draft: { summary: "", text: "Lost my hat" } as never, updated_at: "2026-11-12" };
  expect(pickNews([], [], draft, new Set())?.detail).toBe("Lost my hat");
  const declined = { ...MY_SUMMARY, status: "declined" as const };
  expect(pickNews([declined], [], null, new Set())?.title).toBe("Your delay claim is decided");
  expect(pickNews([{ ...MY_SUMMARY, open_requests: 2 }], [], null, new Set())?.title).toBe(
    "We need 2 things for your delay claim",
  );
  expect(noun({ claim_type: "unknown" })).toBe("");
  expect(pickNews([{ ...declined, claim_type: "unknown" }], [], null, new Set())?.title).toBe(
    "Your claim is decided",
  );
  expect(suggestions([], [], null)).toEqual([]);
});

test("dismissed news and seen messages survive storage that's missing or broken", () => {
  window.localStorage.setItem(DISMISSED_KEY, "not json");
  expect(loadDismissed().size).toBe(0);
  saveDismissed(new Set(["paid:CLM-1"]));
  expect(loadDismissed().has("paid:CLM-1")).toBe(true);
  markSeen([
    { notice_id: 9, claim_id: null, channel: "email", subject: "", body: "", sent_at: "" },
  ]);
  expect(lastSeen()).toBe(9);
  // A text with no email beside it stays its own message.
  expect(
    groupNotices([
      {
        notice_id: 3,
        claim_id: "CLM-1",
        channel: "sms",
        subject: "s",
        body: "b",
        sent_at: "2026-01-01",
      },
    ]),
  ).toHaveLength(1);
});

test("a day counts only if it's real and inside the trip", () => {
  const trip = { departs_on: "2026-06-10", returns_on: "2026-06-18" };
  expect(dayInTrip("2026-06-12", trip)).toBe(true);
  expect(dayInTrip("2026-06-20", trip)).toBe(false);
  expect(dayInTrip("last Tuesday", trip)).toBe(false);
  expect(dayInTrip("2026-02-30x")).toBe(false);
  const filled = { ...fill(null, "lost_bag", ["x"], "2026-07-01"), location: "Rome" };
  expect(nextMissing(filled, new Set(), trip)).toBe("date");
});

test("the customer's own amounts are read in code, one line each", () => {
  expect(amountsIn("The clinic $120 and medicine $45.50")).toEqual([
    { description: "The clinic", category: "other", amount: 120 },
    { description: "medicine", category: "other", amount: 45.5 },
  ]);
  expect(amountsIn("taxi was 1,250")).toEqual([
    { description: "taxi", category: "other", amount: 1250 },
  ]);
  expect(amountsIn("no idea")).toEqual([]);
  expect(amountsIn("$80")[0]?.description).toBe("What I paid for");
});

test("a saved claim comes back as far as it got", () => {
  const back = restored({
    policy_id: "POL-2001",
    case: "medical",
    text: "I hurt my ankle.",
    claim_type: "emergency_medical",
    summary: "Hurt ankle",
    story: "",
    incident_date: "2026-06-12",
    incident_location: "Rome",
    items: [
      { description: "Clinic", category: "medical", amount: "120.00" },
      { description: "Blank", category: "other", amount: "" },
    ],
    step: "check",
  });
  expect(back).toMatchObject({ story: "I hurt my ankle.", location: "Rome" });
  expect(back.lines).toEqual([{ description: "Clinic", category: "medical", amount: 120 }]);
});
