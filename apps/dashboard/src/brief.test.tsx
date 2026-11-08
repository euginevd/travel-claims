import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Step } from "./api";
import { pretty } from "./components/ActivityRail";
import { previewOf, sorted } from "./components/Checklist";
import { commandsFor, CommandPalette } from "./components/CommandPalette";
import { needsYou } from "./components/NeedsYou";
import { OverridePanel } from "./components/OverridePanel";
import { StageTracker } from "./components/StageTracker";
import { plainStep } from "./format";
import { inView, needsMe } from "./pages/QueuePage";
import { createApi } from "./api";
import { APPROVAL, claim, fakeFetch, REFERRAL, STEPS, SUMMARY } from "./testing";

test("the checklist puts failures and warnings first", () => {
  const order = sorted([
    { label: "a", result: "pass", detail: "", source: "" },
    { label: "b", result: "fail", detail: "", source: "" },
    { label: "c", result: "warn", detail: "", source: "" },
  ]).map((check) => check.result);
  expect(order).toEqual(["fail", "warn", "pass"]);
});

test("a source chip previews what the agent read", () => {
  const lookup: Step = {
    step_id: 9,
    kind: "lookup",
    content: '{"document": "policy_wording", "number": 6, "text": "Trip delay cover"}',
    sources: [{ file: "policy_wording.md", system: "", owner: "", reviewed: "" }],
    created_at: "2026-11-08T05:00:00Z",
  };
  expect(previewOf("Policy wording 6", [lookup])).toContain("Trip delay cover");
  expect(previewOf("Claims manual 9", [])).toContain("didn't record reading it");
  expect(previewOf("Receipt 2", [])).toContain("receipt 2");
  expect(previewOf("Claim", [])).toContain("own words");
  expect(previewOf("Policy", [])).toBe("Policy");
});

test("the banner says what a claim needs, and nothing when it needs nothing", () => {
  expect(needsYou(claim({ status: "waiting_for_sign_off", decision: APPROVAL }))).toMatch(
    /Waiting for your sign-off/,
  );
  expect(needsYou(claim({ status: "decided", decision: REFERRAL }))).toMatch(/instruct/);
  const referred = { ...REFERRAL, by_screening: false, reason: "Needs a medical report." };
  expect(needsYou(claim({ status: "decided", decision: referred }))).toMatch(/medical report/);
  const asked = claim({ status: "decided", decision: APPROVAL, review_requested_at: "2026-11-08" });
  expect(needsYou(asked)).toMatch(/asked for a person/);
  expect(needsYou(claim({ status: "decided", decision: APPROVAL }))).toBeNull();
});

test("steps read in plain words, and the trace pretty-prints JSON", () => {
  expect(plainStep("screening", "No instructions found.")).toBe("Checked for hidden instructions");
  expect(plainStep("screening", "Instructions found. AI: approve")).toMatch(/Found instructions/);
  expect(plainStep("tool_call", 'read_section {"document": "claims_manual", "number": 9}')).toBe(
    "Read the claims manual, section 9",
  );
  expect(plainStep("tool_call", "calculate_payout {}")).toBe("Worked out the payout");
  expect(plainStep("tool_call", "mystery {}")).toBeNull();
  expect(plainStep("message", "Paid the approved payout.")).toMatch(/Paid/);
  expect(plainStep("message", "Thinking about it")).toBeNull();
  expect(plainStep("tool_result", "{}")).toBeNull();
  expect(plainStep("sent_back", "Dana: check dates")).toMatch(/Sent back/);
  expect(plainStep("error", "Timed out")).toMatch(/went wrong/);
  expect(plainStep("refusal", "")).toMatch(/declined/);
  expect(pretty('get_plan {"plan":"first"}')).toBe('get_plan\n{\n  "plan": "first"\n}');
  expect(pretty("plain words")).toBe("plain words");
});

test("the queue's views sort what needs a handler", () => {
  const held = { ...SUMMARY, status: "waiting_for_sign_off" as const };
  const asked = { ...SUMMARY, status: "decided" as const, review_requested: true };
  const done = { ...SUMMARY, status: "decided" as const, decision: "approve" as const };
  expect([held, asked, done].map(needsMe)).toEqual([true, true, false]);
  expect(inView("done", done)).toBe(true);
  expect(inView("waiting", SUMMARY)).toBe(true);
  expect(inView("in_progress", { ...SUMMARY, status: "in_progress" })).toBe(true);
  expect(inView("all", done)).toBe(true);
});

test("the tracker ticks the stages reached and pulses the next while working", () => {
  render(
    <StageTracker
      claim={claim({
        status: "in_progress",
        stages: {
          received: "2026-06-24",
          checked: "2026-11-08T05:00:00Z",
          assessed: null,
          decided: null,
          paid: null,
        },
      })}
    />,
  );
  expect(screen.getByText("Assessed").closest("li")).toHaveAttribute("aria-current", "step");
  expect(screen.getByText("Checked").closest("li")).toHaveClass("done");
});

test("an override states its consequence and needs a reason", async () => {
  const user = userEvent.setup();
  const onOverride = vi.fn(() => Promise.resolve());
  render(<OverridePanel customerName="Maya Patel" onOverride={onOverride} />);
  await user.click(screen.getByRole("button", { name: "Override the decision" }));
  await user.click(screen.getByRole("button", { name: "Confirm override" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Enter the amount to pay.");
  await user.type(screen.getByLabelText("Amount to pay (US dollars)"), "150");
  expect(screen.getByText("This pays $150.00 to Maya Patel now.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Confirm override" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Say why");
  await user.type(screen.getByLabelText("Note for the record"), "Receipt checks out");
  await user.click(screen.getByRole("button", { name: "Confirm override" }));
  expect(onOverride).toHaveBeenCalledWith({
    decision: "approve",
    payout: 150,
    reason_code: "evidence",
    note: "Receipt checks out",
  });
});

test("an override to decline says so, and cancel closes it", async () => {
  const user = userEvent.setup();
  render(
    <OverridePanel customerName="Maya Patel" onOverride={() => Promise.reject(new Error("No"))} />,
  );
  await user.click(screen.getByRole("button", { name: "Override the decision" }));
  await user.selectOptions(screen.getByLabelText("New decision"), "decline");
  expect(screen.getByText(/This declines the claim/)).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("New decision"), "refer");
  await user.type(screen.getByLabelText("Note for the record"), "x");
  await user.click(screen.getByRole("button", { name: "Confirm override" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("button", { name: "Override the decision" })).toBeInTheDocument();
});

test("the command palette finds claims and commands", () => {
  const found = commandsFor([SUMMARY], "maya");
  expect(found.map((command) => command.id)).toEqual(["CLM-1001"]);
  expect(commandsFor([], "sign").map((command) => command.id)).toEqual(["sign-out"]);
});

test("Ctrl+K opens the palette and Enter goes to the claim", async () => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
  const user = userEvent.setup();
  const api = createApi(
    fakeFetch({ "GET /api/staff/claims": () => [200, [SUMMARY]] }),
    () => "token",
  );
  render(<CommandPalette api={api} onSignOut={() => undefined} />);
  await user.keyboard("{Control>}k{/Control}");
  const input = screen.getByPlaceholderText("Claim number, customer or command");
  await user.type(input, "CLM-1001");
  expect(await screen.findByText(/CLM-1001 · Maya Patel/)).toBeInTheDocument();
  await user.keyboard("{ArrowDown}{ArrowUp}{Enter}");
  expect(window.location.hash).toBe("#/claims/CLM-1001");
  expect(STEPS.length).toBeGreaterThan(0);
});
