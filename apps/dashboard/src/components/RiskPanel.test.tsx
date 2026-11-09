import { render, screen } from "@testing-library/react";
import { createApi, type ClaimSummary } from "../api";
import { needsMe, urgency } from "../pages/QueuePage";
import { fakeFetch, SUMMARY } from "../testing";
import { RiskPanel } from "./RiskPanel";

const BASE = "/api/staff/claims/CLM-1001/risk";

test("flags a shared receipt and a high amount, and says when nothing is unusual", async () => {
  const flagged = fakeFetch({
    [`GET ${BASE}`]: () => [
      200,
      {
        shared_receipts: [{ receipt: 1, claim_id: "CLM-1009", match: "exact" }],
        earlier_claims: 2,
        earlier_paid: 310,
        amount_claimed: 4800,
        typical_amount: 600,
        high_amount: true,
      },
    ],
  });
  const { unmount } = render(<RiskPanel api={createApi(flagged, () => "t")} claimId="CLM-1001" />);
  expect(await screen.findByText(/2 worth a look/)).toBeInTheDocument();
  expect(screen.getByText(/Receipt 1 also on CLM-1009/)).toBeInTheDocument();
  expect(screen.getByText(/2 earlier claims/)).toBeInTheDocument();
  expect(screen.getByText(/typical for this type/)).toBeInTheDocument();
  unmount();

  const calm = fakeFetch({
    [`GET ${BASE}`]: () => [
      200,
      {
        shared_receipts: [],
        earlier_claims: 0,
        earlier_paid: 0,
        amount_claimed: 120,
        typical_amount: null,
        high_amount: false,
      },
    ],
  });
  render(<RiskPanel api={createApi(calm, () => "t")} claimId="CLM-1001" />);
  expect(await screen.findByText(/nothing unusual/)).toBeInTheDocument();
  expect(screen.getByText("No earlier claims")).toBeInTheDocument();
});

test("documents in brings a claim back to the handler, and due dates mark urgency", () => {
  const today = new Date("2026-07-06T12:00:00");
  const back: ClaimSummary = {
    ...SUMMARY,
    status: "decided",
    decision: "refer",
    documents_in: true,
  };
  expect(needsMe(back)).toBe(true);
  expect(urgency({ ...SUMMARY, due_on: "2026-07-01" }, today)).toBe("overdue");
  expect(urgency({ ...SUMMARY, due_on: "2026-07-07" }, today)).toBe("soon");
  expect(urgency({ ...SUMMARY, due_on: "2026-07-30" }, today)).toBeNull();
  expect(urgency({ ...SUMMARY, status: "decided", decision: "approve" }, today)).toBeNull();
});
