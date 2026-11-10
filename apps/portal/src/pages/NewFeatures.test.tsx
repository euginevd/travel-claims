import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi, type CustomerRequest, type DelayOffer, type Notice } from "../api";
import { DelayOffers, PayoutCard, ResumeDraft } from "../components/AccountCards";
import { NeedsPanel } from "../components/NeedsPanel";
import { fakeFetch, MY_POLICY, MY_SUMMARY, myClaim, type Routes } from "../testing";
import { MyClaimPage } from "./MyClaimPage";
import { MyClaimsPage } from "./MyClaimsPage";
import { NewClaimPage } from "./NewClaimPage";
import { UpdatesPage } from "./UpdatesPage";

const PNG = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "report.png", {
  type: "image/png",
});

const OFFER: DelayOffer = {
  flight_id: "FL-2006-2",
  policy_id: "POL-2006",
  flight: "UL 503",
  route: "Colombo (CMB) to London (LHR)",
  date: "2026-08-20",
  delay_minutes: 280,
  waiting_hours: 3,
  estimate: 35,
};

const ASKED: CustomerRequest = {
  request_id: 1,
  text: "A copy of the police report",
  asked_by: "UnderCover Agent v1",
  asked_at: "2026-11-09T01:00:00+00:00",
  fulfilled_at: null,
  files: 0,
};

const NOTICES: Notice[] = [
  {
    notice_id: 2,
    claim_id: "CLM-1001",
    channel: "sms",
    subject: "Claim CLM-1001 paid",
    body: "UnderCover: We've sent $35.00 to your PayID o***@example.com.",
    sent_at: "2026-11-09T02:00:00+00:00",
  },
  {
    notice_id: 1,
    claim_id: "CLM-1001",
    channel: "email",
    subject: "We've got your claim CLM-1001",
    body: "Thanks, Maya.",
    sent_at: "2026-11-09T01:00:00+00:00",
  },
];

function apiFor(routes: Routes) {
  const fetchFn = fakeFetch(routes);
  return { api: createApi(fetchFn, () => "token-c"), fetchFn };
}

beforeEach(() => {
  window.location.hash = "#/";
});

test("a flight delay is offered and claimed in one tap", async () => {
  const user = userEvent.setup();
  const { api, fetchFn } = apiFor({
    "GET /api/customer/delays": () => [200, [OFFER]],
    "POST /api/customer/delays/FL-2006-2/claim": () => [201, myClaim({ claim_id: "CLM-1040" })],
  });
  render(<DelayOffers api={api} />);
  expect(await screen.findByText("Your flight UL 503 was 4h 40m late")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Claim $35.00" }));
  await waitFor(() => {
    expect(window.location.hash).toBe("#/claims/CLM-1040");
  });
  expect(fetchFn.calls.some((c) => c.method === "POST")).toBe(true);
});

test("a failed delay claim says so and nothing is offered when there's nothing to claim", async () => {
  const user = userEvent.setup();
  const { api } = apiFor({
    "GET /api/customer/delays": () => [200, [OFFER]],
    "POST /api/customer/delays/FL-2006-2/claim": () => [409, { detail: "Already claimed" }],
  });
  render(<DelayOffers api={api} />);
  await user.click(await screen.findByRole("button", { name: "Claim $35.00" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Already claimed");

  const empty = apiFor({ "GET /api/customer/delays": () => [200, []] });
  const { container } = render(<DelayOffers api={empty.api} />);
  await waitFor(() => {
    expect(container).toBeEmptyDOMElement();
  });
});

test("a customer adds a PayID, a bad one is refused, and it can be changed", async () => {
  const user = userEvent.setup();
  let payid: string | null = null;
  const { api } = apiFor({
    "GET /api/customer/payid": () => [200, { payid }],
    "PUT /api/customer/payid": (body) => {
      const sent = (body as { payid: string }).payid;
      if (!sent.includes("@")) return [422, { detail: [{ msg: "bad" }] }];
      payid = "m***@example.com";
      return [200, { payid }];
    },
  });
  render(<PayoutCard api={api} />);
  const field = await screen.findByLabelText(/Add a PayID/);
  await user.type(field, "nope");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("doesn't look like a PayID");
  await user.clear(field);
  await user.type(field, "maya@example.com");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("m***@example.com")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Change" }));
  expect(screen.getByLabelText(/Add a PayID/)).toBeInTheDocument();
});

test("a claim not sent yet can be finished or thrown away", async () => {
  const user = userEvent.setup();
  const { api, fetchFn } = apiFor({
    "GET /api/customer/draft": () => [
      200,
      {
        draft: {
          policy_id: "POL-2001",
          case: "lost_bag",
          text: "My bag never arrived",
          claim_type: "",
          summary: "",
          story: "",
          incident_date: "",
          incident_location: "",
          items: [],
          step: "what",
        },
        updated_at: "2026-11-09T01:00:00+00:00",
      },
    ],
    "DELETE /api/customer/draft": () => [204, null],
  });
  render(<ResumeDraft api={api} />);
  expect(await screen.findByText(/My bag never arrived/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Finish it" })).toHaveAttribute("href", "#/new");
  await user.click(screen.getByRole("button", { name: "Discard" }));
  await waitFor(() => {
    expect(screen.queryByText(/My bag never arrived/)).not.toBeInTheDocument();
  });
  expect(fetchFn.calls.some((c) => c.method === "DELETE")).toBe(true);
});

test("the claim form puts back a saved claim and can start over", async () => {
  const user = userEvent.setup();
  const { api, fetchFn } = apiFor({
    "GET /api/customer/policies": () => [200, [MY_POLICY]],
    "GET /api/customer/draft": () => [
      200,
      {
        draft: {
          policy_id: "POL-2001",
          case: "lost_bag",
          text: "My bag never arrived",
          claim_type: "baggage",
          summary: "",
          story: "",
          incident_date: "",
          incident_location: "",
          items: [{ description: "Clothes", category: "clothing", amount: "120" }],
          step: "receipts",
        },
        updated_at: "2026-11-09T01:00:00+00:00",
      },
    ],
    "PUT /api/customer/draft": (body) => [200, { draft: body, updated_at: "2026-11-09T02:00:00Z" }],
    "DELETE /api/customer/draft": () => [204, null],
  });
  render(<NewClaimPage api={api} />);
  expect(await screen.findByText(/We kept what you'd filled in/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Add your receipts" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Start over" }));
  expect(await screen.findByRole("heading", { name: "What happened?" })).toBeInTheDocument();
  expect(fetchFn.calls.some((c) => c.method === "DELETE")).toBe(true);

  await user.click(screen.getByRole("radio", { name: /Lost bag/ }));
  await waitFor(
    () => {
      expect(fetchFn.calls.some((c) => c.method === "PUT")).toBe(true);
    },
    { timeout: 3000 },
  );
});

test("what we need is listed, and sending a file marks it done", async () => {
  const user = userEvent.setup();
  const updated = myClaim({
    requests: [{ ...ASKED, fulfilled_at: "2026-11-09T03:00:00+00:00", files: 1 }],
  });
  const { api } = apiFor({
    "POST /api/customer/claims/CLM-1001/requests/1/files": () => [201, updated],
  });
  let claim = myClaim({ requests: [ASKED] });
  const { rerender } = render(
    <NeedsPanel
      api={api}
      claimId="CLM-1001"
      requests={claim.requests}
      onUpdated={(next) => {
        claim = next;
      }}
    />,
  );
  expect(screen.getByRole("heading", { name: "What we need from you" })).toBeInTheDocument();
  await user.upload(screen.getByLabelText(/Upload/), PNG);
  await waitFor(() => {
    expect(claim.requests[0]?.files).toBe(1);
  });
  rerender(
    <NeedsPanel
      api={api}
      claimId="CLM-1001"
      requests={claim.requests}
      onUpdated={() => undefined}
    />,
  );
  expect(screen.getByRole("heading", { name: "What you sent us" })).toBeInTheDocument();
  expect(screen.getByText(/Sent 1 file/)).toBeInTheDocument();
});

test("a file that can't be sent says why", async () => {
  const user = userEvent.setup();
  const { api } = apiFor({
    "POST /api/customer/claims/CLM-1001/requests/1/files": () => [415, { detail: "Wrong type" }],
  });
  render(
    <NeedsPanel api={api} claimId="CLM-1001" requests={[ASKED]} onUpdated={() => undefined} />,
  );
  await user.upload(screen.getByLabelText(/Upload/), PNG);
  expect(await screen.findByRole("alert")).toHaveTextContent("Wrong type");
});

test("a claim page shows what we need and where the payment went", async () => {
  const { api } = apiFor({
    "GET /api/customer/claims/CLM-1001": () => [
      200,
      myClaim({
        status: "paid",
        paid: 35,
        paid_at: "2026-11-09T02:00:00+00:00",
        paid_to: "PayID m***@example.com",
        requests: [ASKED],
      }),
    ],
  });
  render(<MyClaimPage api={api} claimId="CLM-1001" />);
  expect(await screen.findByText("A copy of the police report")).toBeInTheDocument();
  expect(screen.getByText(/sent to your PayID m\*\*\*@example.com/)).toBeInTheDocument();
});

test("my claims flags a claim waiting on the customer", async () => {
  const { api } = apiFor({
    "GET /api/customer/claims": () => [200, [{ ...MY_SUMMARY, open_requests: 2 }]],
    "GET /api/customer/delays": () => [200, []],
    "GET /api/customer/payid": () => [200, { payid: null }],
    "GET /api/customer/draft": () => [200, null],
  });
  render(<MyClaimsPage api={api} name="Maya Patel" />);
  expect(await screen.findByText(/We need 2 things from you/)).toBeInTheDocument();
  expect(await screen.findByText("Get paid in seconds")).toBeInTheDocument();
});

test("updates list every email and text, or say there are none", async () => {
  const { api } = apiFor({ "GET /api/customer/notices": () => [200, NOTICES] });
  render(<UpdatesPage api={api} />);
  expect(await screen.findByText("Claim CLM-1001 paid")).toBeInTheDocument();
  expect(screen.getByText("Text")).toBeInTheDocument();
  expect(screen.getByText("Email")).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "Open claim CLM-1001" })).toHaveLength(2);

  const empty = apiFor({ "GET /api/customer/notices": () => [200, []] });
  render(<UpdatesPage api={empty.api} />);
  expect(await screen.findByText("Nothing yet")).toBeInTheDocument();
});

test("updates that fail to load can be tried again", async () => {
  const user = userEvent.setup();
  let fail = true;
  const { api } = apiFor({
    "GET /api/customer/notices": () => (fail ? [500, { detail: "Down" }] : [200, NOTICES]),
  });
  render(<UpdatesPage api={api} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Down");
  fail = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Claim CLM-1001 paid")).toBeInTheDocument();
});

test("changing a PayID and leaving the field empty puts the saved one back", async () => {
  const user = userEvent.setup();
  const { api } = apiFor({ "GET /api/customer/payid": () => [200, { payid: "o***@example.com" }] });
  render(
    <>
      <PayoutCard api={api} />
      <button type="button">Elsewhere</button>
    </>,
  );
  await user.click(await screen.findByRole("button", { name: "Change" }));
  expect(screen.getByRole("textbox")).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Elsewhere" }));
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.getByText("o***@example.com")).toBeInTheDocument();
});
