import type { ClaimSummary, Decision } from "./api";
import { segmentsOf } from "./components/DecisionCard";
import { chipFor } from "./components/StatusChip";
import { figuresOf } from "./pages/QueuePage";

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

test("the queue's figures count the claims and add up what's paid", () => {
  const base = {
    customer_name: "",
    plan: "",
    claim_type: "",
    summary: "",
    amount_claimed: 0,
    submitted_on: "",
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

test("a status chip is a word, and only a held payment is marked as held", () => {
  expect(chipFor("decided", "approve").label).toBe("Paid");
  expect(chipFor("decided", "refer").label).toBe("Referred");
  expect(chipFor("waiting_for_sign_off").held).toBe(true);
  expect(chipFor("waiting").held).toBeUndefined();
});
