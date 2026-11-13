import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi } from "../api";
import { fakeFetch } from "../testing";
import { SignInPage, testAccounts } from "./SignInPage";

const CONFIG = { clientId: "client-1", region: "ap-southeast-2" };

// Cognito answers each call in turn, whatever was asked.
function cognito(...replies: [number, unknown][]) {
  let next = 0;
  const targets: string[] = [];
  const fetchFn = (_url: string, init?: RequestInit) => {
    targets.push(new Headers(init?.headers).get("X-Amz-Target")?.split(".")[1] ?? "");
    const [status, body] = replies[next++] ?? [500, {}];
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return { api: createApi(fetchFn, () => null, CONFIG), targets };
}

async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Work email"), "dana@undercover.example");
  await user.type(screen.getByLabelText("Password"), "secret");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

test("an account with MFA asks for the authenticator code, then signs in", async () => {
  const user = userEvent.setup();
  const onSignedIn = vi.fn();
  const { api, targets } = cognito(
    [200, { ChallengeName: "SOFTWARE_TOKEN_MFA", Session: "s-1" }],
    [200, { AuthenticationResult: { IdToken: "id-1" } }],
  );
  render(<SignInPage api={api} onSignedIn={onSignedIn} checking={false} />);
  await signIn(user);

  expect(
    await screen.findByRole("heading", { name: "Enter your authenticator code" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("6-digit code")).toHaveFocus();
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Verify code" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Enter the 6-digit code from your authenticator app.",
  );

  await user.type(screen.getByLabelText("6-digit code"), "123 456");
  await user.click(screen.getByRole("button", { name: "Verify code" }));
  expect(onSignedIn).toHaveBeenCalledWith("id-1");
  expect(targets).toEqual(["InitiateAuth", "RespondToAuthChallenge"]);
});

test("the first sign-in with MFA shows the key for an authenticator app", async () => {
  const user = userEvent.setup();
  const onSignedIn = vi.fn();
  const { api, targets } = cognito(
    [200, { ChallengeName: "MFA_SETUP", Session: "s-1" }],
    [200, { SecretCode: "ABC234", Session: "s-2" }],
    [200, { Status: "SUCCESS", Session: "s-3" }],
    [200, { AuthenticationResult: { IdToken: "id-2" } }],
  );
  render(<SignInPage api={api} onSignedIn={onSignedIn} checking={false} />);
  await signIn(user);

  expect(
    await screen.findByRole("heading", { name: "Add an authenticator app" }),
  ).toBeInTheDocument();
  expect(screen.getByText("ABC234")).toBeInTheDocument();
  expect(screen.getByText(/^otpauth:\/\/totp\/UnderCover/)).toBeInTheDocument();
  await user.type(screen.getByLabelText("6-digit code"), "654321");
  await user.click(screen.getByRole("button", { name: "Add and sign in" }));
  expect(onSignedIn).toHaveBeenCalledWith("id-2");
  expect(targets).toEqual([
    "InitiateAuth",
    "AssociateSoftwareToken",
    "VerifySoftwareToken",
    "RespondToAuthChallenge",
  ]);
});

test("a wrong code stays on the step; an expired one goes back to the password", async () => {
  const user = userEvent.setup();
  const { api } = cognito(
    [200, { ChallengeName: "SOFTWARE_TOKEN_MFA", Session: "s-1" }],
    [400, { __type: "CodeMismatchException" }],
    [400, { __type: "NotAuthorizedException" }],
  );
  render(<SignInPage api={api} onSignedIn={vi.fn()} checking={false} />);
  await signIn(user);

  await user.type(await screen.findByLabelText("6-digit code"), "000000");
  await user.click(screen.getByRole("button", { name: "Verify code" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("That code doesn't match.");
  expect(screen.getByLabelText("6-digit code")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Verify code" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("That sign-in has expired.");
  expect(screen.getByLabelText("Password")).toBeInTheDocument();
});

test("another account can be used instead of answering the code", async () => {
  const user = userEvent.setup();
  const { api } = cognito([200, { ChallengeName: "SOFTWARE_TOKEN_MFA", Session: "s-1" }]);
  render(<SignInPage api={api} onSignedIn={vi.fn()} checking={false} />);
  await signIn(user);
  await user.click(await screen.findByRole("button", { name: "Use a different account" }));
  expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  expect(screen.getByLabelText("Password")).toHaveValue("");
  // Focus lands in the form again, not on the page.
  expect(screen.getByRole("textbox", { name: /email/i })).toHaveFocus();
});

test("a sign-in step the page doesn't offer says so", async () => {
  const user = userEvent.setup();
  const { api } = cognito([200, { ChallengeName: "CUSTOM_CHALLENGE", Session: "s-1" }]);
  render(<SignInPage api={api} onSignedIn={vi.fn()} checking={false} />);
  await signIn(user);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This account needs a sign-in step this page doesn't offer.",
  );
});

test("the AWS demo offers the handler only; a local build offers both", () => {
  const names = (env: Partial<ImportMetaEnv>) =>
    testAccounts(env as ImportMetaEnv).map((option) => option.account);
  expect(names({ VITE_TEST_SIGN_IN: "true" })).toEqual(["handler"]);
  expect(names({ VITE_LOCAL_SIGN_IN: "true" })).toEqual(["senior", "handler"]);
  expect(names({})).toEqual(["senior", "handler"]);

  vi.stubEnv("VITE_TEST_SIGN_IN", "true");
  render(<SignInPage api={cognito().api} onSignedIn={vi.fn()} checking={false} />);
  expect(screen.getAllByRole("radio")).toHaveLength(1);
  expect(screen.getByRole("radio", { name: /Marcus Oyelaran/ })).toBeChecked();
});

test("a demo that refuses the senior handler says why", async () => {
  const user = userEvent.setup();
  const api = createApi(fakeFetch({}), () => null, null);
  render(<SignInPage api={api} onSignedIn={vi.fn()} checking={false} />);
  await user.click(screen.getByRole("button", { name: "Continue as Dana" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The senior handler is only on the laptop version, so the public demo can't pause payouts or sign them off.",
  );
});
