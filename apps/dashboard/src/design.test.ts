import type { ClaimSummary, Decision, Step } from "./api";
import { screeningOf } from "./components/AgentStatus";
import { segmentsOf, waterfallOf } from "./components/DecisionCard";
import { chipFor } from "./components/StatusChip";
import { words } from "./format";
import { arrange, daysOverdue, decisionWords, figuresOf, urgency } from "./pages/QueuePage";

const DECISION: Decision = {
  decision: "approve",
  payout: 3750,
  calculation: {
    lines: [
      { step: "Hotel, 3 nights", amount: 1050 },
      { step: "Flights", amount: 2800 },
      { step: "Less the deductible", amount: -100 },
    ],
    payout: 3750,
  },
  section: "Policy wording section 6",
  reason: "Covered.",
  decided_by: "UnderCover Agent v1",
  decided_at: "2026-11-08T05:00:00Z",
  checklist: [],
  override: null,
  manual_version: "2026.2",
  by_screening: false,
  approval_limit: 1000,
  hold_reason: null,
  signed_off_by: null,
  signed_off_at: null,
};

test("the payout bar runs from claimed to paid with every segment labelled", () => {
  expect(segmentsOf(DECISION, 4000)).toEqual([
    { label: "Paid", amount: 3750, paid: true },
    { label: "Less the deductible", amount: 100, paid: false },
    { label: "Not covered or over a limit", amount: 150, paid: false },
  ]);
});

test("a payout with nothing taken off is a single paid segment", () => {
  const whole = {
    ...DECISION,
    payout: 500,
    calculation: { lines: [{ step: "Bag", amount: 500 }], payout: 500 },
  };
  expect(segmentsOf(whole, 500)).toEqual([{ label: "Paid", amount: 500, paid: true }]);
});

test("the payout waterfall runs from what was claimed down to what's paid", () => {
  const rows = waterfallOf(DECISION, 4000);
  expect(rows.map((row) => [row.label, row.amount, row.kind])).toEqual([
    ["Claimed", 4000, "claimed"],
    ["Not covered or over a limit", 150, "off"],
    ["Less the deductible", 100, "off"],
    ["Pay", 3750, "pay"],
  ]);
  // Each amount that comes off starts where the last one ended; what's paid is what's left.
  expect(rows.map((row) => [row.from, row.width])).toEqual([
    [0, 100],
    [96.25, 3.75],
    [93.75, 2.5],
    [0, 93.75],
  ]);
  expect(waterfallOf({ ...DECISION, payout: 0, calculation: null }, 0)).toEqual([]);
});

test("the queue narrows by type and plan, sorts, and says how overdue a claim is", () => {
  const base = {
    customer_name: "",
    summary: "",
    submitted_on: "",
    review_requested: false,
    documents_in: false,
    status: "waiting" as const,
    decision: null,
    payout: null,
  };
  const claims: ClaimSummary[] = [
    {
      ...base,
      claim_id: "A",
      claim_type: "lost_bag",
      plan: "premium",
      amount_claimed: 50,
      due_on: "2026-07-09",
    },
    {
      ...base,
      claim_id: "B",
      claim_type: "trip_delay",
      plan: "economy",
      amount_claimed: 900,
      due_on: "2026-07-07",
    },
    {
      ...base,
      claim_id: "C",
      claim_type: "lost_bag",
      plan: "economy",
      amount_claimed: 300,
      due_on: "2026-07-08",
    },
  ];
  const ids = (found: ClaimSummary[]) => found.map((claim) => claim.claim_id).join("");
  expect(ids(arrange(claims, "all", "", "", "queue"))).toBe("ABC");
  expect(ids(arrange(claims, "all", "", "", "due"))).toBe("BCA");
  expect(ids(arrange(claims, "all", "", "", "amount"))).toBe("BCA");
  expect(ids(arrange(claims, "all", "lost_bag", "", "amount"))).toBe("CA");
  expect(ids(arrange(claims, "all", "lost_bag", "premium", "queue"))).toBe("A");
  expect(ids(arrange(claims, "done", "", "", "queue"))).toBe("");

  const [first] = claims;
  if (!first) throw new Error("no claim");
  const noon = new Date("2026-07-12T12:00:00");
  expect(urgency(first, noon)).toBe("overdue");
  expect(daysOverdue(first, noon)).toBe(3);
  expect(daysOverdue(first, new Date("2026-07-01T12:00:00"))).toBe(0);
  expect(words("trip_delay")).toBe("Trip delay");
});

test("a row says the decision in a few words, as a recommendation until it's settled", () => {
  const base = {
    claim_id: "CLM-1",
    customer_name: "",
    plan: "",
    claim_type: "",
    summary: "",
    amount_claimed: 0,
    submitted_on: "",
    review_requested: false,
    due_on: "2026-07-07",
    documents_in: false,
  };
  const row = (
    status: ClaimSummary["status"],
    decision: ClaimSummary["decision"],
    payout: number | null = null,
  ) => decisionWords({ ...base, status, decision, payout });
  expect(row("waiting_for_sign_off", "approve", 3750)).toBe("Approve $3,750.00");
  expect(row("decided", "approve", 50.5)).toBe("Approved $50.50");
  expect(row("decided", "decline")).toBe("Declined");
  expect(row("left_for_handler", "refer")).toBe("Refer");
  expect(row("decided", "refer")).toBe("Referred");
  expect(row("waiting_for_sign_off", "decline")).toBe("Decline");
  expect(row("waiting", null)).toBeNull();
});

test("the claim says what the hidden-instruction check found", () => {
  const step = (kind: Step["kind"], content: string): Step => ({
    step_id: 1,
    kind,
    content,
    sources: [],
    created_at: "2026-11-08T05:00:00Z",
  });
  expect(screeningOf([step("tool_call", "get_claim {}")])).toBeNull();
  expect(screeningOf([step("screening", "No instructions found.")])).toBe("clear");
  expect(screeningOf([step("screening", "Instructions found. AI: approve")])).toBe("found");
});

test("the queue's figures count the claims and add up what's paid", () => {
  const base = {
    customer_name: "",
    plan: "",
    claim_type: "",
    summary: "",
    amount_claimed: 0,
    submitted_on: "",
    review_requested: false,
    due_on: "2026-07-07",
    documents_in: false,
  };
  const claims: ClaimSummary[] = [
    { ...base, claim_id: "CLM-1", status: "waiting", decision: null, payout: null },
    { ...base, claim_id: "CLM-2", status: "sent_back", decision: null, payout: null },
    {
      ...base,
      claim_id: "CLM-3",
      status: "waiting_for_sign_off",
      decision: "approve",
      payout: 3750,
    },
    { ...base, claim_id: "CLM-4", status: "decided", decision: "approve", payout: 50.5 },
    { ...base, claim_id: "CLM-5", status: "decided", decision: "decline", payout: 0 },
  ];
  expect(figuresOf(claims).map((f) => f.value)).toEqual(["2", "1", "2", "$50.50"]);
});

test("a status chip is a word with a tone that matches its meaning", () => {
  expect(chipFor("decided", "approve")).toMatchObject({ label: "Paid", tone: "good" });
  expect(chipFor("decided", "decline")).toMatchObject({ label: "Declined", tone: "bad" });
  expect(chipFor("decided", "refer")).toMatchObject({ label: "Referred", tone: "refer" });
  expect(chipFor("waiting_for_sign_off").tone).toBe("warn");
  expect(chipFor("waiting").tone).toBe("info");
});
