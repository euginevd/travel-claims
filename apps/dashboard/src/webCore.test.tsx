import { ErrorBoundary } from "@undercover/web-core/ErrorBoundary";
import { guarded } from "@undercover/web-core/guarded";
import { createTokenStore } from "@undercover/web-core/session";
import { render, screen } from "@testing-library/react";
import { ApiError } from "./api";

function Broken(): never {
  throw new Error("A field was missing");
}

const wayBack = (
  <>
    go <a href="#/">back to the queue</a>
  </>
);

test("a page that fails to render shows a way back, not a blank app", () => {
  const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
  render(
    <ErrorBoundary wayBack={wayBack}>
      <Broken />
    </ErrorBoundary>,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Something went wrong showing this pageTry reloading, or go back to the queue.",
  );
  expect(screen.getByRole("link", { name: "back to the queue" })).toHaveAttribute("href", "#/");
  quiet.mockRestore();
});

test("a page that renders is shown as it is", () => {
  render(
    <ErrorBoundary wayBack={wayBack}>
      <p>The queue</p>
    </ErrorBoundary>,
  );
  expect(screen.getByText("The queue")).toBeInTheDocument();
});

describe("guarded", () => {
  const unauthorised = (error: unknown) => error instanceof ApiError && error.status === 401;
  const refused = () => Promise.reject(new ApiError(401, "Expired"));

  test("a call the api refuses for the token signs the person out, and still fails", async () => {
    const signOut = vi.fn();
    const api = guarded({ me: refused, version: 2 }, signOut, unauthorised);
    await expect(api.me()).rejects.toThrow("Expired");
    expect(signOut).toHaveBeenCalledOnce();
    expect(api.version).toBe(2);
  });

  test("other failures and the sign-in calls leave the sign-in alone", async () => {
    const signOut = vi.fn();
    const api = guarded(
      {
        signIn: refused,
        answerChallenge: refused,
        me: () => Promise.reject(new ApiError(500, "")),
      },
      signOut,
      unauthorised,
    );
    await expect(api.signIn()).rejects.toThrow("Expired");
    await expect(api.answerChallenge()).rejects.toThrow("Expired");
    await expect(api.me()).rejects.toThrow();
    expect(signOut).not.toHaveBeenCalled();
  });

  test("each call is wrapped once, so it can sit in a hook's dependencies", async () => {
    const api = guarded({ me: () => Promise.resolve("Dana") }, vi.fn(), unauthorised);
    expect(api.me).toBe(api.me);
    await expect(api.me()).resolves.toBe("Dana");
  });
});

describe("createTokenStore", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  test("keeps the token for the tab under the audience's own key", () => {
    createTokenStore("one").saveToken("t-1");
    expect(window.sessionStorage.getItem("one")).toBe("t-1");
    expect(createTokenStore("one").loadToken()).toBe("t-1");
    expect(createTokenStore("two").loadToken()).toBeNull();
  });

  test("signing out clears the stored token", () => {
    const store = createTokenStore("one");
    store.saveToken("t-1");
    store.saveToken(null);
    expect(store.loadToken()).toBeNull();
    expect(window.sessionStorage.getItem("one")).toBeNull();
  });

  test("blocked storage keeps the token in memory", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const store = createTokenStore("one");
    expect(store.loadToken()).toBeNull();
    store.saveToken("t-1");
    expect(store.loadToken()).toBe("t-1");
  });
});
