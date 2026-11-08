import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi } from "../api";
import { fakeFetch, MY_POLICY, myClaim, type Routes } from "../testing";
import { MyClaimPage } from "./MyClaimPage";
import { NewClaimPage } from "./NewClaimPage";

const PNG = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "hotel.png", {
  type: "image/png",
});

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

test("a customer makes a claim with a receipt and lands on it", async () => {
  const user = userEvent.setup();
  const { api, fetchFn } = apiFor({
    "GET /api/my/policies": () => [200, [MY_POLICY]],
    "POST /api/my/claims": () => [201, myClaim({ claim_id: "CLM-1027" })],
    "POST /api/my/claims/CLM-1027/receipts": () => [201, myClaim({ claim_id: "CLM-1027" })],
  });
  render(<NewClaimPage api={api} />);
  await screen.findByRole("option", { name: /Rome, Italy/ });

  await user.type(screen.getByLabelText("When it happened"), "2026-06-17");
  await user.type(screen.getByLabelText("Where it happened"), "Rome");
  await user.type(screen.getByLabelText("In one line"), "Flight delayed overnight");
  await user.type(screen.getByLabelText("The whole story"), "We stayed at the airport hotel.");
  await user.type(screen.getByLabelText("Item 1"), "Airport hotel");
  await user.type(screen.getByLabelText("Amount (US$)"), "180.50");
  await user.upload(screen.getByLabelText(/Choose files/), PNG);
  expect(screen.getByText("hotel.png")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Send my claim" }));

  await waitFor(() => {
    expect(window.location.hash).toBe("#/my/claims/CLM-1027");
  });
  const made = fetchFn.calls.find((c) => c.path === "/api/my/claims" && c.method === "POST");
  expect(made?.body).toMatchObject({
    policy_id: "POL-2001",
    incident_date: "2026-06-17",
    items: [{ description: "Airport hotel", category: "accommodation", amount: 180.5 }],
  });
  const sent = fetchFn.calls.find((c) => c.path.endsWith("/receipts"));
  expect(sent?.body).toBeInstanceOf(FormData);
});

test("the form says what's missing before sending", async () => {
  const user = userEvent.setup();
  const { api, fetchFn } = apiFor({ "GET /api/my/policies": () => [200, [MY_POLICY]] });
  render(<NewClaimPage api={api} />);
  await screen.findByRole("option", { name: /Rome, Italy/ });
  await user.click(screen.getByRole("button", { name: "Send my claim" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Say when it happened.");
  expect(fetchFn.calls.some((c) => c.method === "POST")).toBe(false);
});

test("a file that isn't a receipt is turned away before it's sent", async () => {
  const user = userEvent.setup({ applyAccept: false });
  const { api } = apiFor({ "GET /api/my/policies": () => [200, [MY_POLICY]] });
  render(<NewClaimPage api={api} />);
  await screen.findByRole("option", { name: /Rome, Italy/ });
  const page = new File(["<html>"], "page.html", { type: "text/html" });
  await user.upload(screen.getByLabelText(/Choose files/), page);
  expect(screen.getByRole("alert")).toHaveTextContent("page.html isn't a JPEG, PNG or PDF.");
});

test("a decided claim shows its outcome, reason and how to ask for a person", async () => {
  const { api } = apiFor({
    "GET /api/my/claims/CLM-1001": () => [
      200,
      myClaim({
        status: "declined",
        status_text: "Declined. The reason is below.",
        outcome: "decline",
        reason: "The trip was cancelled for a reason the policy does not cover.",
        can_add_receipts: false,
      }),
    ],
  });
  render(<MyClaimPage api={api} claimId="CLM-1001" />);
  expect(await screen.findByText("Declined", { selector: ".chip" })).toBeInTheDocument();
  expect(screen.getByText(/reason the policy does not cover/)).toBeInTheDocument();
  expect(screen.getByText(/ask for a person to review it/)).toBeInTheDocument();
  expect(screen.queryByText(/Choose files/)).not.toBeInTheDocument();
});

test("a waiting claim takes more receipts", async () => {
  const user = userEvent.setup();
  const { api, fetchFn } = apiFor({
    "GET /api/my/claims/CLM-1001": () => [200, myClaim()],
    "POST /api/my/claims/CLM-1001/receipts": () => [
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
  expect(fetchFn.calls.some((c) => c.path === "/api/my/claims/CLM-1001/receipts")).toBe(true);
});
