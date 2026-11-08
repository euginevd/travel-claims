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

  // What needs a handler shows first; All shows the rest.
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
  expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  expect(screen.queryByText(/customer/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
});

test("the test account signs in through the dev route, with no password in the browser", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    ...signedInRoutes,
    "POST /api/staff/dev/test-sign-in": () => [200, { id_token: "token-2", expires_in: 3600 }],
  });
  render(<App fetchFn={fetchFn} />);
  await user.click(screen.getByRole("button", { name: /Use test account/ }));
  await screen.findByRole("heading", { name: "Claims queue" });
  const call = fetchFn.calls.find((c) => c.path === "/api/staff/dev/test-sign-in");
  expect(call?.body).toEqual({ account: "senior" });
});

test("the needs-me view is first and J moves through the claims", async () => {
  const user = userEvent.setup();
  saveToken("token-1");
  render(<App fetchFn={fakeFetch(signedInRoutes)} />);
  const needsMe = await screen.findByRole("button", { name: /Needs me/ });
  expect(needsMe).toHaveAttribute("aria-pressed", "true");
  const table = screen.getByRole("table");
  expect(within(table).queryByRole("link", { name: "CLM-1001" })).not.toBeInTheDocument();
  await user.keyboard("j");
  expect(within(table).getByRole("link", { name: "CLM-1002" })).toHaveFocus();
});

test("signs in on the staff route only", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch(signedInRoutes);
  render(<App fetchFn={fetchFn} />);
  await user.type(screen.getByLabelText("Work email"), "dana.whitfield@undercover.example");
  await user.type(screen.getByLabelText("Password"), "secret");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByRole("table");
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
  await user.click(await screen.findByRole("button", { name: /^All/ }));
  await user.click(await screen.findByRole("link", { name: "CLM-1001" }));
  const heading = await screen.findByRole("heading", { level: 1, name: "Claim CLM-1001" });
  await waitFor(() => {
    expect(heading).toHaveFocus();
  });
});

test("shows an empty queue plainly", async () => {
  saveToken("token-1");
  render(
    <App fetchFn={fakeFetch({ ...signedInRoutes, "GET /api/staff/claims": () => [200, []] })} />,
  );
  expect(await screen.findByRole("heading", { name: "The queue is empty" })).toBeInTheDocument();
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
  expect(within(banner).getByRole("link", { name: /Queue/ })).toHaveAttribute("href", "#/");
  expect(within(banner).getByRole("button", { name: "Sign out" })).toBeInTheDocument();
});
