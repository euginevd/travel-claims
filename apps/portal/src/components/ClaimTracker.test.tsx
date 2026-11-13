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
