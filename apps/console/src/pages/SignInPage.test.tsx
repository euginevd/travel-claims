import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createApi } from "../api";
import { SignInPage } from "./SignInPage";

const CONFIG = { clientId: "client-1", region: "ap-southeast-2" };

function cognito(...replies: [number, unknown][]) {
  let next = 0;
  const fetchFn = () => {
    const [status, body] = replies[next++] ?? [500, {}];
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return createApi(fetchFn, () => null, CONFIG);
}

async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Work email"), "sam@undercover.example");
  await user.type(screen.getByLabelText("Password"), "secret");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

test("an engineer with MFA enters the authenticator code, then signs in", async () => {
  const user = userEvent.setup();
  const onSignedIn = vi.fn();
  const api = cognito(
    [200, { ChallengeName: "SOFTWARE_TOKEN_MFA", Session: "s-1" }],
    [200, { AuthenticationResult: { IdToken: "id-1" } }],
  );
  render(<SignInPage api={api} onSignedIn={onSignedIn} checking={false} />);
  await signIn(user);

  expect(screen.getByRole("heading", { name: "Enter your authenticator code" })).toBeVisible();
  expect(screen.getByLabelText("6-digit code")).toHaveFocus();
  expect(screen.queryByRole("button", { name: /Continue as/ })).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("6-digit code"), "12345");
  await user.click(screen.getByRole("button", { name: "Verify code" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Enter the 6-digit code");

  await user.type(screen.getByLabelText("6-digit code"), "6");
  await user.click(screen.getByRole("button", { name: "Verify code" }));
  expect(onSignedIn).toHaveBeenCalledWith("id-1");
});

test("the first sign-in shows the setup key, and an expired step starts again", async () => {
  const user = userEvent.setup();
  const api = cognito(
    [200, { ChallengeName: "MFA_SETUP", Session: "s-1" }],
    [200, { SecretCode: "ABC234", Session: "s-2" }],
    [400, { __type: "NotAuthorizedException" }],
  );
  render(<SignInPage api={api} onSignedIn={vi.fn()} checking={false} />);
  await signIn(user);

  expect(await screen.findByText("ABC234")).toBeInTheDocument();
  await user.type(screen.getByLabelText("6-digit code"), "654321");
  await user.click(screen.getByRole("button", { name: "Add and sign in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("That sign-in has expired.");
  expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
});

test("another account can be used instead", async () => {
  const user = userEvent.setup();
  const api = cognito([200, { ChallengeName: "SOFTWARE_TOKEN_MFA", Session: "s-1" }]);
  render(<SignInPage api={api} onSignedIn={vi.fn()} checking={false} />);
  await signIn(user);
  await user.click(await screen.findByRole("button", { name: "Use a different account" }));
  expect(screen.getByLabelText("Password")).toHaveValue("");
});
