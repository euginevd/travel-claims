import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { saveToken } from "./session";
import { fakeFetch, MAYA, MY_POLICY, MY_SUMMARY, myClaim, type Routes } from "./testing";

beforeEach(() => {
  saveToken(null);
  window.location.hash = "";
});

const routes: Routes = {
  "POST /api/customer/dev/sign-in": () => [200, { id_token: "token-c", expires_in: 3600 }],
  "GET /api/customer/profile": () => [200, MAYA],
  "GET /api/customer/claims": () => [200, [MY_SUMMARY]],
  "GET /api/customer/policies": () => [200, [MY_POLICY]],
  "GET /api/customer/claims/CLM-1001": () => [200, myClaim()],
};

test("a customer signs in and sees their own claims", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch(routes);
  render(<App fetchFn={fetchFn} />);
  await user.type(screen.getByLabelText("Email"), "maya.patel@example.com");
  await user.type(screen.getByLabelText("Password"), "secret");
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  expect(await screen.findByRole("heading", { level: 1, name: "My claims" })).toBeInTheDocument();
  expect(screen.getByText("Flight home canceled by the airline")).toBeInTheDocument();
  const signIn = fetchFn.calls.find((c) => c.path === "/api/customer/dev/sign-in");
  expect(signIn?.body).toEqual({ email: "maya.patel@example.com", password: "secret" });
  expect(fetchFn.calls.every((c) => c.path.startsWith("/api/customer/"))).toBe(true);
});

test("the sign-in page is a plain email and password sign-in", () => {
  render(<App fetchFn={fakeFetch(routes)} />);
  expect(screen.queryByText(/claims handler/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  expect(screen.queryByText(/Google/)).not.toBeInTheDocument();
  expect(screen.getByLabelText("Email")).toBeInTheDocument();
});

test("the test account signs in through the dev route, with no password in the browser", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    ...routes,
    "POST /api/customer/dev/test-sign-in": () => [200, { id_token: "token-t", expires_in: 3600 }],
  });
  render(<App fetchFn={fetchFn} />);
  await user.click(screen.getByRole("button", { name: /Use test account/ }));
  expect(await screen.findByRole("heading", { level: 1, name: "My claims" })).toBeInTheDocument();
  const call = fetchFn.calls.find((c) => c.path === "/api/customer/dev/test-sign-in");
  expect(call?.body).toEqual({ account: "customer" });
});

test("asks for both email and password", async () => {
  const user = userEvent.setup();
  render(<App fetchFn={fakeFetch(routes)} />);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Enter your email and password.");
});

test("says when the password is wrong", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    "POST /api/customer/dev/sign-in": () => [401, { detail: "The email or password is wrong" }],
  });
  render(<App fetchFn={fetchFn} />);
  await user.type(screen.getByLabelText("Email"), "maya.patel@example.com");
  await user.type(screen.getByLabelText("Password"), "nope");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "That email and password don't match an account.",
  );
});

test("a rejected token signs the customer out", async () => {
  saveToken("old");
  render(
    <App
      fetchFn={fakeFetch({ "GET /api/customer/profile": () => [401, { detail: "Sign in" }] })}
    />,
  );
  expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
});

test("the header shows the customer and their links", async () => {
  saveToken("token-c");
  render(<App fetchFn={fakeFetch(routes)} />);
  const banner = await screen.findByRole("banner");
  expect(within(banner).getByText("Maya Patel")).toBeInTheDocument();
  expect(within(banner).getByRole("link", { name: /My claims/ })).toHaveAttribute("href", "#/");
  expect(within(banner).getByRole("link", { name: /Make a claim/ })).toHaveAttribute(
    "href",
    "#/new",
  );
});

test("signing out returns to the sign-in page", async () => {
  const user = userEvent.setup();
  saveToken("token-c");
  render(<App fetchFn={fakeFetch(routes)} />);
  await user.click(await screen.findByRole("button", { name: "Sign out" }));
  expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
});

test("a sign-in check that fails for another reason offers to try again", async () => {
  const user = userEvent.setup();
  saveToken("token-c");
  let calls = 0;
  const fetchFn = fakeFetch({
    ...routes,
    "GET /api/customer/profile": () => {
      calls += 1;
      return calls === 1 ? [500, { detail: "The database is busy" }] : [200, MAYA];
    },
  });
  render(<App fetchFn={fetchFn} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("The database is busy");
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { level: 1, name: "My claims" })).toBeInTheDocument();
});

test("a claim's link opens that claim", async () => {
  saveToken("token-c");
  window.location.hash = "#/claims/CLM-1001";
  render(<App fetchFn={fakeFetch(routes)} />);
  expect(await screen.findByText("My flight home from Rome was cancelled.")).toBeInTheDocument();
});

test("the make-a-claim link opens the form", async () => {
  saveToken("token-c");
  window.location.hash = "#/new";
  render(<App fetchFn={fakeFetch(routes)} />);
  expect(
    await screen.findByRole("heading", { level: 1, name: "What happened?" }),
  ).toBeInTheDocument();
});
