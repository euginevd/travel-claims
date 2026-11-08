import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi, type Api } from "../api";
import { MyClaimsPage } from "../pages/MyClaimsPage";
import { NewClaimPage } from "../pages/NewClaimPage";
import { MyClaimPage } from "../pages/MyClaimPage";
import { fakeFetch, MY_POLICY, MY_SUMMARY, myClaim, type Routes } from "../testing";
import { parseHash } from "../useHashRoute";
import { kilobytes, ReceiptPicker, receiptProblem } from "./ReceiptPicker";

beforeAll(() => {
  URL.createObjectURL = () => "blob:receipt";
  URL.revokeObjectURL = () => undefined;
});

function apiFor(routes: Routes): Api {
  return createApi(fakeFetch(routes), () => "token");
}

test("receipt checks and sizes read plainly", () => {
  expect(receiptProblem(new File([], "a.png", { type: "image/png" }))).toBe("a.png is empty.");
  const big = new File([new Uint8Array(6 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" });
  expect(receiptProblem(big)).toBe("big.jpg is over 5 MB.");
  expect(kilobytes(500)).toBe("1 KB");
  expect(kilobytes(3 * 1024 * 1024)).toBe("3.0 MB");
});

test("the picker stops at five receipts and removes one on request", async () => {
  const user = userEvent.setup();
  const files = Array.from(
    { length: 4 },
    (_, i) => new File(["x"], `r${String(i)}.png`, { type: "image/png" }),
  );
  const onChange = vi.fn();
  render(<ReceiptPicker files={files} onChange={onChange} already={1} />);
  expect(screen.getByLabelText(/Choose files/)).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Remove r0.png" }));
  expect(onChange).toHaveBeenCalledWith(files.slice(1));
});

test("the routes for customers parse", () => {
  expect(parseHash("#/")).toEqual({ page: "my-claims" });
  expect(parseHash("#/new")).toEqual({ page: "new-claim" });
  expect(parseHash("#/claims/CLM-1027")).toEqual({ page: "my-claim", claimId: "CLM-1027" });
});

test("my claims shows an empty state and a retry after an error", async () => {
  const user = userEvent.setup();
  let fail = true;
  const api = apiFor({
    "GET /api/customer/claims": () => (fail ? [500, { detail: "Down for a moment" }] : [200, []]),
  });
  render(<MyClaimsPage api={api} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Down for a moment");
  fail = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { name: "No claims yet" })).toBeInTheDocument();
});

test("my claims lists a claim with where it stands", async () => {
  render(<MyClaimsPage api={apiFor({ "GET /api/customer/claims": () => [200, [MY_SUMMARY]] })} />);
  expect(await screen.findByRole("link", { name: MY_SUMMARY.summary })).toHaveAttribute(
    "href",
    "#/claims/CLM-1001",
  );
  expect(screen.getByText(/Delayed travel/)).toBeInTheDocument();
});

test("a paid claim shows the amount and a failed upload says why", async () => {
  const user = userEvent.setup();
  const api = apiFor({
    "GET /api/customer/claims/CLM-1001": () => [
      200,
      myClaim({ status: "paid", outcome: "approve", paid: 245, paid_at: "2026-11-08T05:00:00Z" }),
    ],
    "POST /api/customer/claims/CLM-1001/receipts": () => [415, { detail: "Receipts must be JPEG" }],
  });
  render(<MyClaimPage api={api} claimId="CLM-1001" />);
  expect(await screen.findByText("$245.00", { selector: ".payout" })).toBeInTheDocument();
  const png = new File(["x"], "r.png", { type: "image/png" });
  await user.upload(screen.getByLabelText(/Choose files/), png);
  await user.click(screen.getByRole("button", { name: "Add these receipts" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Receipts must be JPEG");
});

test("my claim says when it can't be loaded", async () => {
  render(
    <MyClaimPage
      api={apiFor({
        "GET /api/customer/claims/CLM-9": () => [404, { detail: "Claim CLM-9 not found" }],
      })}
      claimId="CLM-9"
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Claim CLM-9 not found");
});

test("a new claim adds and removes items and shows the api's refusal", async () => {
  const user = userEvent.setup();
  const api = apiFor({
    "GET /api/customer/policies": () => [200, [MY_POLICY]],
    "POST /api/customer/drafts": () => [503, { detail: "Not available" }],
    "POST /api/customer/claims": () => [
      422,
      { detail: "The incident date must be during your trip" },
    ],
  });
  render(<NewClaimPage api={api} />);
  await user.click(await screen.findByRole("radio", { name: /Delayed flight/ }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.type(screen.getByLabelText("Anything to add? (optional)"), "Delayed overnight.");
  await user.click(screen.getByRole("button", { name: /Draft my claim/ }));
  await screen.findByText(/Not available/);
  await user.click(screen.getByRole("button", { name: "Add an item" }));
  await user.click(screen.getByRole("button", { name: "Add an item" }));
  expect(screen.getByLabelText("Item 2")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Remove item 2" }));
  expect(screen.queryByLabelText("Item 2")).not.toBeInTheDocument();

  await user.click(screen.getByRole("radio", { name: "Wednesday 17 June 2026" }));
  await user.type(screen.getByLabelText("Where?"), "Rome");
  await user.type(screen.getByLabelText("Item 1"), "Hotel");
  await user.type(screen.getByLabelText("Amount (US$)"), "90");
  expect(screen.getByText("$90.00")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Send my claim" }));
  await waitFor(() => {
    expect(screen.getByRole("alert")).toHaveTextContent("must be during your trip");
  });
});

test("a new claim says when policies can't load", async () => {
  render(
    <NewClaimPage
      api={apiFor({ "GET /api/customer/policies": () => [500, { detail: "Busy" }] })}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("couldn't load your policies: Busy");
});
