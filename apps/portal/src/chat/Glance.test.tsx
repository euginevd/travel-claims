import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MY_POLICY, MY_SUMMARY } from "../testing";
import { Glance, tripState } from "./Glance";
import type { Records } from "./records";

const RECORDS: Records = {
  policies: [MY_POLICY],
  claims: [MY_SUMMARY, { ...MY_SUMMARY, claim_id: "CLM-1002", status: "paid" }],
  cover: [],
  delays: [],
  draft: null,
  notices: [],
  payid: null,
};

test("the glance shows claims, cover and getting paid, each opening where it lives", async () => {
  const user = userEvent.setup();
  const opened: unknown[] = [];
  render(<Glance records={RECORDS} onOpen={(t) => opened.push(t)} today="2026-06-12" />);
  expect(screen.getByText("1 in progress")).toBeInTheDocument();
  expect(screen.getByText("Delay claim · Received")).toBeInTheDocument();
  expect(screen.getByText("Active now")).toBeInTheDocument();
  expect(screen.getByText("No PayID yet")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /Claims/ }));
  await user.click(screen.getByRole("button", { name: /Cover/ }));
  expect(opened).toEqual([{ view: "claims" }, { view: "settings", policyId: "POL-2001" }]);
});

test("a customer with nothing yet sees only how they get paid", () => {
  render(
    <Glance
      records={{ ...RECORDS, policies: [], claims: [], payid: "m***@x.com" }}
      onOpen={() => undefined}
    />,
  );
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(screen.getByText("m***@x.com")).toBeInTheDocument();
});

test("a trip is upcoming, on now or over", () => {
  const trip = { departs_on: "2026-06-10", returns_on: "2026-06-18" };
  expect(["2026-06-01", "2026-06-10", "2026-06-19"].map((d) => tripState(trip, d))).toEqual([
    "Starts soon",
    "Active now",
    "Trip over",
  ]);
});
