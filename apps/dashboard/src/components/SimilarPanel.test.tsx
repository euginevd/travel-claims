import { render, screen } from "@testing-library/react";
import { createApi, SimilarClaimsSchema } from "../api";
import similar from "../fixtures/similar-claims.json";
import { fakeFetch } from "../testing";
import { SimilarPanel } from "./SimilarPanel";

const BASE = "/api/staff/claims/CLM-1019/similar";

test("lists the api's similar claims as a guide, each linking to its claim", async () => {
  expect(SimilarClaimsSchema.safeParse(similar).success).toBe(true);
  const fetchFn = fakeFetch({ [`GET ${BASE}`]: () => [200, similar] });
  render(<SimilarPanel api={createApi(fetchFn, () => "t")} claimId="CLM-1019" />);
  expect(await screen.findByText(/similar claim was approved/)).toBeInTheDocument();
  expect(screen.getByText("a guide, not a decision")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "CLM-1001" })).toHaveAttribute(
    "href",
    "#/claims/CLM-1001",
  );
  expect(screen.getByText("Approved $150.00")).toBeInTheDocument();
  expect(screen.getByText("Overridden by a person")).toBeInTheDocument();
});

test("says when there are no similar decided claims yet", async () => {
  const none = { ...similar, summary: "No similar decided claims yet", similar: [] };
  const fetchFn = fakeFetch({ [`GET ${BASE}`]: () => [200, none] });
  render(<SimilarPanel api={createApi(fetchFn, () => "t")} claimId="CLM-1019" />);
  expect(await screen.findByText("No similar decided claims yet")).toBeInTheDocument();
});
