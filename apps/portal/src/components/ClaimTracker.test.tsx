import { render, screen } from "@testing-library/react";
import { createApi } from "../api";
import { MyClaimsPage, progressLine } from "../pages/MyClaimsPage";
import { fakeFetch, MY_SUMMARY } from "../testing";
import { stepsFor } from "./ClaimTracker";

const states = (status: Parameters<typeof stepsFor>[0]) =>
  stepsFor(status).map(({ label, state }) => `${label}:${state}`);

test("a claim with a person shows that as the step happening now, with no payment promised", () => {
  expect(states("with_a_handler")).toEqual([
    "Received:done",
    "Assessing:done",
    "With a person:current",
    "Decision:upcoming",
  ]);
});

test("a claim in its final check shows that step, then the decision and payment", () => {
  expect(states("reviewing")).toEqual([
    "Received:done",
    "Assessing:done",
    "Final check:current",
    "Decision:upcoming",
    "Paid:upcoming",
  ]);
});

test("received, approved, paid and declined claims sit at the right step", () => {
  expect(states("received")).toEqual([
    "Received:done",
    "Assessing:current",
    "Decision:upcoming",
    "Paid:upcoming",
  ]);
  expect(states("approved")).toContain("Paid:current");
  expect(states("paid").every((step) => step.endsWith(":done"))).toBe(true);
  expect(states("declined")).toEqual(["Received:done", "Assessing:done", "Decision:done"]);
});

test("the headline counts every claim still in progress, people's reviews included", () => {
  const withPerson = { ...MY_SUMMARY, claim_id: "CLM-1", status: "with_a_handler" as const };
  const received = { ...MY_SUMMARY, claim_id: "CLM-2", status: "received" as const };
  const paid = { ...MY_SUMMARY, claim_id: "CLM-3", status: "paid" as const };
  expect(progressLine([withPerson, received, paid])).toBe("2 claims in progress.");
  expect(progressLine([withPerson])).toBe("1 claim in progress.");
  expect(progressLine([paid])).toBe("Everything's settled. Safe travels.");
});

test("completed claims are collapsed by default, with their count shown", async () => {
  const claims = [
    { ...MY_SUMMARY, claim_id: "CLM-1", status: "received" },
    { ...MY_SUMMARY, claim_id: "CLM-2", status: "paid", summary: "Paid one" },
  ];
  const api = createApi(fakeFetch({ "GET /api/customer/claims": () => [200, claims] }), () => "t");
  render(<MyClaimsPage api={api} />);
  const heading = await screen.findByRole("heading", { name: /completed/i });
  const details = heading.closest("details");
  expect(details).not.toBeNull();
  expect(details?.open).toBe(false);
  expect(heading).toHaveTextContent("1");
});
