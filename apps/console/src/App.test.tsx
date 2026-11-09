import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { saveToken } from "./session";
import { fakeFetch, SAM } from "./testing";

beforeEach(() => {
  saveToken(null);
  window.location.hash = "";
});

test("an AI engineer signs in with the test account and sees the scoreboard", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    "POST /api/engineering/dev/test-sign-in": () => [200, { id_token: "t", expires_in: 3600 }],
    "GET /api/engineering/me": () => [200, SAM],
    "GET /api/engineering/runs": () => [200, []],
  });
  render(<App fetchFn={fetchFn} />);
  expect(screen.getByRole("heading", { name: "AI assurance console" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /Use test account/ }));
  expect(await screen.findByRole("heading", { name: "Scoreboard" })).toBeInTheDocument();
  expect(screen.getByText("Sam Carter")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Security: Red team" })).toHaveAttribute(
    "href",
    "#/redteam",
  );
  expect(screen.queryByRole("link", { name: "Queue" })).not.toBeInTheDocument();
});

test("a rejected token signs the engineer out", async () => {
  saveToken("old");
  const fetchFn = fakeFetch({ "GET /api/engineering/me": () => [401, { detail: "Sign in" }] });
  render(<App fetchFn={fetchFn} />);
  expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
});

test("a sign-in check that can't reach the server can be tried again", async () => {
  const user = userEvent.setup();
  saveToken("t");
  let fail = true;
  const fetchFn = fakeFetch({
    "GET /api/engineering/me": () => (fail ? [500, { detail: "Down" }] : [200, SAM]),
    "GET /api/engineering/runs": () => [200, []],
  });
  render(<App fetchFn={fetchFn} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Down");
  fail = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { name: "Scoreboard" })).toBeInTheDocument();
});

test("the email sign-in says when the password is wrong, and signing out returns", async () => {
  const user = userEvent.setup();
  const fetchFn = fakeFetch({
    "POST /api/engineering/dev/sign-in": () => [401, { detail: "Wrong" }],
  });
  render(<App fetchFn={fetchFn} />);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Enter your email and password.");
  await user.type(screen.getByLabelText("Work email"), "sam.carter@undercover.example");
  await user.type(screen.getByLabelText("Password"), "nope");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("AI engineer");
});

test("each page opens from its route", async () => {
  saveToken("t");
  window.location.hash = "#/redteam";
  const fetchFn = fakeFetch({
    "GET /api/engineering/me": () => [200, SAM],
    "GET /api/engineering/redteam": () => [
      200,
      { running: false, started_at: null, started_by: null, report: null },
    ],
  });
  render(<App fetchFn={fetchFn} />);
  expect(await screen.findByRole("heading", { name: "Red-team report" })).toBeInTheDocument();
});
