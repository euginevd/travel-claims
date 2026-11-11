import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Api } from "../api";

const DOMAIN = "travel-claims-dev-engineering-1.auth.ap-southeast-2.amazoncognito.com";

async function page(fetchFn?: (input: string, init?: RequestInit) => Promise<Response>) {
  vi.stubEnv("VITE_STAFF_SSO_DOMAIN", DOMAIN);
  vi.stubEnv("VITE_COGNITO_CLIENT_ID", "client-1");
  const { SignInPage } = await import("./SignInPage");
  const signedIn = vi.fn();
  render(<SignInPage api={{} as Api} onSignedIn={signedIn} checking={false} fetchFn={fetchFn} />);
  return signedIn;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

test("without the hosted domain there's no company sign-in", async () => {
  vi.stubEnv("VITE_STAFF_SSO_DOMAIN", "");
  const { SignInPage } = await import("./SignInPage");
  render(<SignInPage api={{} as Api} onSignedIn={vi.fn()} checking={false} />);
  expect(screen.queryByRole("button", { name: /company account/ })).toBeNull();
});

test("company sign-in keeps its state and verifier for the trip to the hosted page", async () => {
  await page();
  // jsdom doesn't navigate; the address it would go to is checked in sso.test.ts.
  await userEvent.click(screen.getByRole("button", { name: "Sign in with your company account" }));
  await waitFor(() => {
    expect(window.sessionStorage.getItem("undercover.sso.state")).toMatch(/^[\w-]{43}$/);
  });
  expect(window.sessionStorage.getItem("undercover.sso.verifier")).toMatch(/^[\w-]{43}$/);
});

test("back from the hosted page, the ID token signs the person in and the code leaves the address", async () => {
  window.sessionStorage.setItem("undercover.sso.state", "s-1");
  window.sessionStorage.setItem("undercover.sso.verifier", "v-1");
  window.history.replaceState(null, "", "/?code=c-1&state=s-1");
  const fetchFn = () => Promise.resolve(new Response(JSON.stringify({ id_token: "id-1" })));
  const signedIn = await page(fetchFn);
  expect(window.location.search).toBe("");
  await waitFor(() => {
    expect(signedIn).toHaveBeenCalledWith("id-1");
  });
});

test("a return that didn't start here is refused with a reason", async () => {
  window.history.replaceState(null, "", "/?code=c-1&state=forged");
  const fetchFn = vi.fn();
  const signedIn = await page(fetchFn);
  expect(await screen.findByRole("alert")).toHaveTextContent("didn't start on this page");
  expect(fetchFn).not.toHaveBeenCalled();
  expect(signedIn).not.toHaveBeenCalled();
});
