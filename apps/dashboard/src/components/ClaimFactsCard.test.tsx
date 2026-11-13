import { render, screen } from "@testing-library/react";
import { createApi } from "../api";
import { APPROVAL, claim, fakeFetch } from "../testing";
import { ClaimFactsCard } from "./ClaimFactsCard";

test("the payout card is built from the claim's own calculation, not the model's words", async () => {
  const api = createApi(
    fakeFetch({ "GET /api/staff/claims/CLM-1001": () => [200, claim({ decision: APPROVAL })] }),
    () => "token",
    null,
  );
  render(<ClaimFactsCard api={api} kind="payout" claimId="CLM-1001" />);
  expect(await screen.findByText("How CLM-1001's payout was worked out")).toBeInTheDocument();
  expect(screen.getByRole("row", { name: /Payout \$1,250\.00/ })).toBeInTheDocument();
});

test("the checks card lists what was checked, and says so when there's nothing yet", async () => {
  const routes = {
    "GET /api/staff/claims/CLM-1001": () =>
      [200, claim({ decision: APPROVAL })] as [number, unknown],
    "GET /api/staff/claims/CLM-1002": () => [200, claim({ decision: null })] as [number, unknown],
  };
  const api = createApi(fakeFetch(routes), () => "token", null);
  const { unmount } = render(<ClaimFactsCard api={api} kind="checks" claimId="CLM-1001" />);
  expect(await screen.findByText("What was checked on CLM-1001")).toBeInTheDocument();
  expect(screen.getAllByRole("listitem").length).toBe(APPROVAL.checklist.length);
  unmount();
  render(<ClaimFactsCard api={api} kind="payout" claimId="CLM-1002" />);
  expect(await screen.findByText("CLM-1002 has no decision yet.")).toBeInTheDocument();
  render(<ClaimFactsCard api={api} kind="payout" claimId="CLM-9999" />);
  expect(await screen.findByText("Couldn't load CLM-9999.")).toBeInTheDocument();
});
