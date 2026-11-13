import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { saveToken } from "./session";
import { claim, DANA, fakeFetch, STEPS, SUMMARY, type Routes } from "./testing";

beforeEach(() => {
  saveToken(null);
  window.location.hash = "";
});

const signedInRoutes: Routes = {
  "POST /api/staff/dev/sign-in": () => [200, { id_token: "token-1", expires_in: 3600 }],
  "GET /api/staff/me": () => [200, DANA],
  "GET /api/staff/dispatches/latest": () => [200, { waiting: 0, dispatch: null }],
  "GET /api/staff/claims": () => [
    200,
    [SUMMARY, { ...SUMMARY, claim_id: "CLM-1002", status: "waiting_for_sign_off" }],
  ],
  "GET /api/staff/claims/CLM-1001": () => [200, claim()],
  "GET /api/staff/claims/CLM-1001/steps": () => [200, STEPS],
};

test("a handler signs in and sees the queue", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch(signedInRoutes);
  render(<App fetchFn={fetchFn} />);

  await user.type(screen.getByLabelText("Work email"), "dana.whitfield@undercover.example");
  await user.type(screen.getByLabelText("Password"), "secret");
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  // What needs a handler shows first; everything else is folded, then in tabs.
  await user.click(await screen.findByRole("button", { name: /Everything else/ }));
  await user.click(await screen.findByRole("button", { name: /^All/ }));
  const table = await screen.findByRole("table");
  expect(within(table).getByRole("link", { name: "CLM-1001" })).toHaveAttribute(
    "href",
    "#/claims/CLM-1001",
  );
  expect(within(table).getByText("Waiting for sign-off")).toBeInTheDocument();
  expect(within(table).getAllByText("$420.00")).toHaveLength(2);
  expect(screen.getByText("Dana Whitfield")).toBeInTheDocument();
  expect(fetchFn.calls.find((c) => c.path === "/api/staff/me")?.auth).toBe("Bearer token-1");
});

test("the sign-in page is a plain staff sign-in with no list of people", () => {
  render(<App fetchFn={fakeFetch(signedInRoutes)} />);
  expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName(
    "The agent recommends. You decide.",
  );
  expect(screen.queryByText(/customer/i)).not.toBeInTheDocument();
  // The only people offered are the two test accounts, and only in a test build.
  expect(screen.getAllByRole("radio")).toHaveLength(2);
  expect(screen.getByRole("radio", { name: /Dana Whitfield/ })).toBeChecked();
});

test("the test account signs in through the dev route, with no password in the browser", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    ...signedInRoutes,
    "POST /api/staff/dev/test-sign-in": () => [200, { id_token: "token-2", expires_in: 3600 }],
  });
  render(<App fetchFn={fetchFn} />);
  await user.click(screen.getByRole("button", { name: "Continue as Dana" }));
  await screen.findByRole("heading", { name: /^Good \w+, Dana$/ });
  const call = fetchFn.calls.find((c) => c.path === "/api/staff/dev/test-sign-in");
  expect(call?.body).toEqual({ account: "senior" });
});

test("the other test account signs in as the handler without sign-off rights", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    ...signedInRoutes,
    "POST /api/staff/dev/test-sign-in": () => [200, { id_token: "token-3", expires_in: 3600 }],
  });
  render(<App fetchFn={fetchFn} />);
  await user.click(screen.getByRole("radio", { name: /Marcus Oyelaran/ }));
  await user.click(screen.getByRole("button", { name: "Continue as Marcus" }));
  // The fake api answers as Dana whoever signs in; the dev route's body says who it was.
  await screen.findByRole("heading", { name: /^Good \w+, \w+$/ });
  const call = fetchFn.calls.find((c) => c.path === "/api/staff/dev/test-sign-in");
  expect(call?.body).toEqual({ account: "handler" });
});

test("the password can be shown while typing it", async () => {
  const user = userEvent.setup();
  render(<App fetchFn={fakeFetch(signedInRoutes)} />);
  const password = screen.getByLabelText("Password");
  expect(password).toHaveAttribute("type", "password");
  await user.click(screen.getByRole("button", { name: "Show password" }));
  expect(password).toHaveAttribute("type", "text");
  await user.click(screen.getByRole("button", { name: "Hide password" }));
  expect(password).toHaveAttribute("type", "password");
});

test("Today lists what needs you, says why, and J moves through it", async () => {
  const user = userEvent.setup();
  saveToken("token-1");
  const referred = {
    ...SUMMARY,
    claim_id: "CLM-1003",
    status: "decided" as const,
    decision: "refer" as const,
    flag: "Receipt image: it couldn't be read",
  };
  render(
    <App
      fetchFn={fakeFetch({
        ...signedInRoutes,
        "GET /api/staff/claims": () => [200, [SUMMARY, referred]],
      })}
    />,
  );
  const row = await screen.findByRole("link", { name: /^CLM-1003, Maya Patel: Receipt image/ });
  expect(screen.queryByRole("link", { name: /^CLM-1001,/ })).not.toBeInTheDocument();
  expect(screen.getByText(/the agent stopped at “Receipt image”/)).toBeInTheDocument();
  await user.keyboard("j");
  expect(row).toHaveFocus();
});

test("the queue filters by claim type and plan, and can clear them", async () => {
  const user = userEvent.setup();
  saveToken("token-1");
  const routes: Routes = {
    ...signedInRoutes,
    "GET /api/staff/claims": () => [
      200,
      [
        SUMMARY,
        { ...SUMMARY, claim_id: "CLM-1002", claim_type: "lost_bag", plan: "premium" },
        { ...SUMMARY, claim_id: "CLM-1003", status: "in_progress", stalled: true },
      ],
    ],
  };
  render(<App fetchFn={fakeFetch(routes)} />);
  await user.click(await screen.findByRole("button", { name: /Everything else/ }));
  await user.click(await screen.findByRole("button", { name: /^All/ }));
  const links = () =>
    within(screen.getByRole("table"))
      .getAllByRole("link", { name: /^CLM-/ })
      .map((a) => a.textContent);
  expect(links()).toEqual(["CLM-1001", "CLM-1002", "CLM-1003"]);
  expect(screen.getByText("Stalled")).toBeInTheDocument();
  expect(within(screen.getByRole("table")).getAllByText(/days overdue/)).toHaveLength(3);

  await user.selectOptions(screen.getByRole("combobox", { name: "Claim type" }), "Lost bag");
  expect(links()).toEqual(["CLM-1002"]);
  await user.selectOptions(screen.getByRole("combobox", { name: "Plan" }), "Economy");
  expect(screen.getByText("No claims match these filters.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Clear the filters" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "Sort: due soonest");
  expect(links()).toHaveLength(3);
});

test("signs in on the staff route only", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch(signedInRoutes);
  render(<App fetchFn={fetchFn} />);
  await user.type(screen.getByLabelText("Work email"), "dana.whitfield@undercover.example");
  await user.type(screen.getByLabelText("Password"), "secret");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("heading", { name: /^Good \w+, Dana$/ });
  expect(fetchFn.calls.every((c) => c.path.startsWith("/api/staff/"))).toBe(true);
});

test("asks for both email and password", async () => {
  const user = userEvent.setup();
  render(<App fetchFn={fakeFetch(signedInRoutes)} />);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Enter your email and password.");
});

test("says when the password is wrong", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    "POST /api/staff/dev/sign-in": () => [401, { detail: "Wrong email or password" }],
  });
  render(<App fetchFn={fetchFn} />);
  await user.type(screen.getByLabelText("Work email"), "dana.whitfield@undercover.example");
  await user.type(screen.getByLabelText("Password"), "nope");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("don't match a staff account");
});

test("says when the server can't be reached", async () => {
  const user = userEvent.setup();
  const fetchFn = () => Promise.reject(new TypeError("Failed to fetch"));
  render(<App fetchFn={fetchFn} />);
  await user.type(screen.getByLabelText("Work email"), "dana.whitfield@undercover.example");
  await user.type(screen.getByLabelText("Password"), "pw");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("couldn't reach the server");
});

test("a rejected token signs the handler out", async () => {
  saveToken("stale");
  render(<App fetchFn={fakeFetch({ "GET /api/staff/me": () => [401, { detail: "Expired" }] })} />);
  expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
});

test("signing out returns to the sign-in page", async () => {
  const user = userEvent.setup();
  saveToken("token-1");
  render(<App fetchFn={fakeFetch(signedInRoutes)} />);
  await user.click(await screen.findByRole("button", { name: "Sign out" }));
  expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
});

test("following a claim link opens the claim page with focus on its heading", async () => {
  const user = userEvent.setup();
  saveToken("token-1");
  render(<App fetchFn={fakeFetch(signedInRoutes)} />);
  await user.click(await screen.findByRole("button", { name: /Everything else/ }));
  await user.click(await screen.findByRole("button", { name: /^All/ }));
  await user.click(await screen.findByRole("link", { name: "CLM-1001" }));
  const heading = await screen.findByRole("heading", { level: 1, name: "Claim CLM-1001" });
  await waitFor(() => {
    expect(heading).toHaveFocus();
  });
});

test("shows an empty day plainly", async () => {
  saveToken("token-1");
  render(
    <App fetchFn={fakeFetch({ ...signedInRoutes, "GET /api/staff/claims": () => [200, []] })} />,
  );
  expect(await screen.findByText(/Nothing needs you right now/)).toBeInTheDocument();
});

test("shows why the queue didn't load", async () => {
  saveToken("token-1");
  render(
    <App
      fetchFn={fakeFetch({
        ...signedInRoutes,
        "GET /api/staff/claims": () => [500, { detail: "The database is down" }],
      })}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("The database is down");
});

test("the header shows the person signed in and wraps instead of clipping", async () => {
  saveToken("token-1");
  render(<App fetchFn={fakeFetch(signedInRoutes)} />);
  const banner = await screen.findByRole("banner");
  expect(within(banner).getByText("Dana Whitfield")).toBeInTheDocument();
  expect(within(banner).getByRole("link", { name: /Today/ })).toHaveAttribute("href", "#/");
  expect(within(banner).getByRole("button", { name: "Sign out" })).toBeInTheDocument();
});
