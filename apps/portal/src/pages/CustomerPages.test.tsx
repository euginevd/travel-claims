import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi, type Draft } from "../api";
import { fakeFetch, MY_POLICY, myClaim, type Routes } from "../testing";
import { MyClaimPage } from "./MyClaimPage";
import { fromDraft, NewClaimPage } from "./NewClaimPage";

const PNG = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "hotel.png", {
  type: "image/png",
});

const DRAFT: Draft = {
  claim_type: "baggage",
  summary: "Bag lost on the flight to Rome",
  story: "My bag didn't arrive in Rome.",
  incident_date: "2026-06-11",
  incident_location: "Rome, Italy",
  items: [{ description: "Clothes", category: "clothing", amount: 120, source: "Receipt 1" }],
  missing_questions: ["Did the airline pay you anything?"],
  low_confidence_fields: ["incident_date"],
};

beforeAll(() => {
  // jsdom has no object URLs; the previews only need a string.
  URL.createObjectURL = () => "blob:preview";
  URL.revokeObjectURL = () => undefined;
});

beforeEach(() => {
  window.location.hash = "#/my/new";
});

function apiFor(routes: Routes) {
  const fetchFn = fakeFetch(routes);
  return { api: createApi(fetchFn, () => "token-c"), fetchFn };
}

test("a customer taps what happened, adds a receipt, checks the draft and sends it", async () => {
  const user = userEvent.setup();
  const { api, fetchFn } = apiFor({
    "GET /api/customer/policies": () => [200, [MY_POLICY]],
    "POST /api/customer/drafts": () => [200, DRAFT],
    "POST /api/customer/claims": () => [201, myClaim({ claim_id: "CLM-1027" })],
    "POST /api/customer/claims/CLM-1027/receipts": () => [201, myClaim({ claim_id: "CLM-1027" })],
  });
  render(<NewClaimPage api={api} />);
  expect(await screen.findByText("Rome, Italy")).toBeInTheDocument();

  await user.click(screen.getByRole("radio", { name: /Lost bag/ }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.upload(screen.getByLabelText(/Choose files/), PNG);
  await user.type(screen.getByLabelText("Anything to add? (optional)"), "bag lost in Rome");
  await user.click(screen.getByRole("button", { name: /Draft my claim/ }));

  expect(await screen.findByDisplayValue("Bag lost on the flight to Rome")).toBeInTheDocument();
  expect(screen.getByText("Receipt 1")).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "Thursday 11 June 2026" })).toBeChecked();
  expect(screen.getByRole("group", { name: "When did it happen?" })).toHaveClass("unsure");
  expect(screen.getByText("Did the airline pay you anything?")).toBeInTheDocument();
  await user.type(screen.getByLabelText("Your answer"), "No");
  await user.click(screen.getByRole("button", { name: "Answer" }));
  expect(screen.queryByText("Did the airline pay you anything?")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Send my claim" }));
  await waitFor(() => {
    expect(window.location.hash).toBe("#/claims/CLM-1027");
  });
  const sent = fetchFn.calls.find((c) => c.path === "/api/customer/claims")?.body as {
    claim_type: string;
    story: string;
    items: { amount: number }[];
  };
  // The customer's own words are the record, with their answer added; their tap sets the type.
  expect(sent.claim_type).toBe("baggage");
  expect(sent.story).toBe("bag lost in Rome\n\nDid the airline pay you anything? No");
  expect(sent.items[0]?.amount).toBe(120);
});

test("with nothing to read the assistant isn't called, and the form says what's missing", async () => {
  const user = userEvent.setup();
  const { api, fetchFn } = apiFor({ "GET /api/customer/policies": () => [200, [MY_POLICY]] });
  render(<NewClaimPage api={api} />);
  await user.click(await screen.findByRole("radio", { name: /Delayed flight/ }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: "Continue without receipts" }));
  expect(fetchFn.calls.some((c) => c.path === "/api/customer/drafts")).toBe(false);
  expect(screen.queryByLabelText("Item 1")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Send my claim" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Choose the day it happened.");
  expect(fetchFn.calls.some((c) => c.path === "/api/customer/claims")).toBe(false);
});

test("the assistant's internal notes never reach the customer", async () => {
  const user = userEvent.setup();
  const { api } = apiFor({
    "GET /api/customer/policies": () => [200, [MY_POLICY]],
    "POST /api/customer/drafts": () => [
      200,
      {
        ...DRAFT,
        summary: "Claim draft pending: customer has not yet described the incident",
        story: "The customer has not provided details.",
        missing_questions: ["What type of problem are you claiming for?"],
      },
    ],
  });
  render(<NewClaimPage api={api} />);
  await user.click(await screen.findByRole("radio", { name: /Medical/ }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.upload(screen.getByLabelText(/Choose files/), PNG);
  await user.click(screen.getByRole("button", { name: /Draft my claim/ }));
  await screen.findByLabelText("In one line");
  expect(screen.queryByText(/customer has not/i)).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue(/draft pending/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/What type of problem/)).not.toBeInTheDocument();
  expect(screen.getByLabelText("In one line")).toHaveValue("Medical");
});

test("a file that isn't a receipt is turned away before it's sent", async () => {
  const user = userEvent.setup({ applyAccept: false });
  const { api } = apiFor({ "GET /api/customer/policies": () => [200, [MY_POLICY]] });
  render(<NewClaimPage api={api} />);
  await user.click(await screen.findByRole("radio", { name: /Lost bag/ }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  const page = new File(["<html>"], "page.html", { type: "text/html" });
  await user.upload(screen.getByLabelText(/Choose files/), page);
  expect(screen.getByRole("alert")).toHaveTextContent("page.html isn't a JPEG, PNG or PDF.");
});

test("the draft never replaces the customer's own words", () => {
  expect(fromDraft(DRAFT, "lost_bag", "my words").story).toBe("my words");
  expect(fromDraft(DRAFT, "lost_bag", "").story).toBe(DRAFT.story);
  const blank = fromDraft(null, "medical", "");
  expect(blank.claimType).toBe("emergency_medical");
  expect(blank.lines).toHaveLength(0);
  expect(fromDraft({ ...DRAFT, incident_date: "soon" }, "lost_bag", "").incidentDate).toBe("");
});

test("a decided claim shows its outcome and lets the customer ask for a person", async () => {
  const user = userEvent.setup();
  const decided = myClaim({
    status: "declined",
    status_text: "Declined. The reason is below.",
    outcome: "decline",
    reason: "The trip was cancelled for a reason the policy does not cover.",
    can_add_receipts: false,
    can_request_review: true,
  });
  const { api, fetchFn } = apiFor({
    "GET /api/customer/claims/CLM-1001": () => [200, decided],
    "POST /api/customer/claims/CLM-1001/review-request": () => [
      200,
      { ...decided, review_requested: true, can_request_review: false },
    ],
  });
  render(<MyClaimPage api={api} claimId="CLM-1001" />);
  expect(await screen.findByText("Declined", { selector: ".chip" })).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Where your claim is" })).toBeInTheDocument();
  expect(screen.getByText(/reason the policy does not cover/)).toBeInTheDocument();
  await user.type(screen.getByLabelText(/Want a person to look at this/), "Please check");
  await user.click(screen.getByRole("button", { name: "Ask a person to review" }));
  expect(await screen.findByText(/review your claim personally/)).toBeInTheDocument();
  const asked = fetchFn.calls.find((c) => c.path.endsWith("/review-request"));
  expect(asked?.body).toEqual({ note: "Please check" });
});

test("a waiting claim takes more receipts", async () => {
  const user = userEvent.setup();
  const { api, fetchFn } = apiFor({
    "GET /api/customer/claims/CLM-1001": () => [200, myClaim()],
    "POST /api/customer/claims/CLM-1001/receipts": () => [
      201,
      myClaim({
        receipts: [
          { receipt_id: "a".repeat(32), media_type: "image/png", size: 2048, uploaded_at: "x" },
        ],
      }),
    ],
  });
  render(<MyClaimPage api={api} claimId="CLM-1001" />);
  await user.upload(await screen.findByLabelText(/Choose files/), PNG);
  await user.click(screen.getByRole("button", { name: "Add these receipts" }));
  expect(await screen.findByRole("status")).toHaveTextContent("1 receipt added.");
  expect(screen.getByText(/Receipt 1/)).toBeInTheDocument();
  expect(fetchFn.calls.some((c) => c.path === "/api/customer/claims/CLM-1001/receipts")).toBe(true);
});
