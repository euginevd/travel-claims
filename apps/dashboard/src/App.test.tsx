import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { saveRole, saveToken } from "./session";
import {
  claim,
  DANA,
  fakeFetch,
  MAYA,
  MY_POLICY,
  MY_SUMMARY,
  myClaim,
  STEPS,
  SUMMARY,
  type Routes,
} from "./testing";

beforeEach(() => {
  saveToken(null);
  window.location.hash = "";
});

const signedInRoutes: Routes = {
  "POST /api/dev/sign-in": () => [200, { id_token: "token-1", expires_in: 3600 }],
  "GET /api/me": () => [200, DANA],
  "GET /api/claims": () => [
    200,
    [SUMMARY, { ...SUMMARY, claim_id: "CLM-1002", status: "waiting_for_sign_off" }],
  ],
  "GET /api/claims/CLM-1001": () => [200, claim()],
  "GET /api/claims/CLM-1001/steps": () => [200, STEPS],
};

test("a handler signs in and sees the queue", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch(signedInRoutes);
  render(<App fetchFn={fetchFn} />);

  await user.click(screen.getByRole("radio", { name: /I'm a claims handler/ }));
  await user.click(screen.getByRole("radio", { name: /Dana Whitfield/ }));
  expect(screen.getByLabelText("Email")).toHaveValue("dana.whitfield@undercover.example");
  await user.type(screen.getByLabelText("Password"), "secret");
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  const table = await screen.findByRole("table");
  expect(within(table).getByRole("link", { name: "CLM-1001" })).toHaveAttribute(
    "href",
    "#/claims/CLM-1001",
  );
  expect(within(table).getByText("Waiting for sign-off")).toBeInTheDocument();
  expect(within(table).getAllByText("$420.00")).toHaveLength(2);
  expect(screen.getByText("Dana Whitfield")).toBeInTheDocument();
  expect(fetchFn.calls.find((c) => c.path === "/api/me")?.auth).toBe("Bearer token-1");
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
    "POST /api/dev/sign-in": () => [401, { detail: "Wrong email or password" }],
  });
  render(<App fetchFn={fetchFn} />);
  await user.type(screen.getByLabelText("Email"), "dana.whitfield@undercover.example");
  await user.type(screen.getByLabelText("Password"), "nope");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("don't match a customer");
});

test("says when the server can't be reached", async () => {
  const user = userEvent.setup();
  const fetchFn = () => Promise.reject(new TypeError("Failed to fetch"));
  render(<App fetchFn={fetchFn} />);
  await user.type(screen.getByLabelText("Email"), "dana.whitfield@undercover.example");
  await user.type(screen.getByLabelText("Password"), "pw");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("couldn't reach the server");
});

test("a rejected token signs the handler out", async () => {
  saveToken("stale");
  render(<App fetchFn={fakeFetch({ "GET /api/me": () => [401, { detail: "Expired" }] })} />);
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
  await user.click(await screen.findByRole("link", { name: "CLM-1001" }));
  const heading = await screen.findByRole("heading", { level: 1, name: "Claim CLM-1001" });
  await waitFor(() => {
    expect(heading).toHaveFocus();
  });
});

test("shows an empty queue plainly", async () => {
  saveToken("token-1");
  render(<App fetchFn={fakeFetch({ ...signedInRoutes, "GET /api/claims": () => [200, []] })} />);
  expect(await screen.findByRole("heading", { name: "The queue is empty" })).toBeInTheDocument();
});

test("shows why the queue didn't load", async () => {
  saveToken("token-1");
  render(
    <App
      fetchFn={fakeFetch({
        ...signedInRoutes,
        "GET /api/claims": () => [500, { detail: "The database is down" }],
      })}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("The database is down");
});

const customerRoutes: Routes = {
  "POST /api/dev/sign-in": () => [200, { id_token: "token-c", expires_in: 3600 }],
  "GET /api/my/profile": () => [200, MAYA],
  "GET /api/my/claims": () => [200, [MY_SUMMARY]],
  "GET /api/my/policies": () => [200, [MY_POLICY]],
  "GET /api/my/claims/CLM-1001": () => [200, myClaim()],
};

test("a customer signs in and sees their own claims", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch(customerRoutes);
  render(<App fetchFn={fetchFn} />);
  expect(screen.getByRole("radio", { name: /I'm a customer/ })).toBeChecked();
  await user.click(screen.getByRole("radio", { name: /Maya Patel/ }));
  await user.type(screen.getByLabelText("Password"), "secret");
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  expect(await screen.findByRole("heading", { level: 1, name: "My claims" })).toBeInTheDocument();
  expect(screen.getByText("Flight home canceled by the airline")).toBeInTheDocument();
  expect(screen.getByText("Received")).toBeInTheDocument();
  const signIn = fetchFn.calls.find((c) => c.path === "/api/dev/sign-in");
  expect(signIn?.body).toMatchObject({ email: "maya.patel@example.com", role: "customer" });
  expect(fetchFn.calls.some((c) => c.path === "/api/me")).toBe(false);
});

test("a signed-in customer never sees the handlers' queue", async () => {
  saveToken("token-c");
  saveRole("customer");
  window.location.hash = "#/claims/CLM-1001";
  const fetchFn = fakeFetch(customerRoutes);
  render(<App fetchFn={fetchFn} />);
  expect(await screen.findByRole("heading", { level: 1, name: "My claims" })).toBeInTheDocument();
  expect(fetchFn.calls.some((c) => c.path === "/api/claims")).toBe(false);
});

test("the header shows the person signed in and wraps instead of clipping", async () => {
  saveToken("token-1");
  render(<App fetchFn={fakeFetch(signedInRoutes)} />);
  const banner = await screen.findByRole("banner");
  expect(within(banner).getByText("Dana Whitfield")).toBeInTheDocument();
  expect(within(banner).getByRole("link", { name: /Queue/ })).toHaveAttribute("href", "#/");
  expect(within(banner).getByRole("button", { name: "Sign out" })).toBeInTheDocument();
});
