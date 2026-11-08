import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, createApi, type Api, type Handler } from "./api";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Header } from "./components/Header";
import { ClaimPage } from "./pages/ClaimPage";
import { QueuePage } from "./pages/QueuePage";
import { SignInPage } from "./pages/SignInPage";
import { loadToken, saveToken } from "./session";
import { useHashRoute } from "./useHashRoute";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

interface AppProps {
  fetchFn?: Fetch;
  pollMs?: number;
}

const defaultFetch: Fetch = (input, init) => fetch(input, init);

export function App({ fetchFn = defaultFetch, pollMs = 1500 }: AppProps) {
  const [token, setToken] = useState<string | null>(loadToken);
  const [handler, setHandler] = useState<Handler | null>(null);
  // Why the signed-in handler couldn't be loaded, when it wasn't the token's fault.
  const [meError, setMeError] = useState<string | null>(null);
  const [meAttempt, setMeAttempt] = useState(0);
  const route = useHashRoute();

  const signOut = useCallback(() => {
    saveToken(null);
    setToken(null);
    setHandler(null);
  }, []);

  const api: Api = useMemo(() => {
    const inner = createApi(fetchFn, loadToken);
    // A rejected token (expired, or the api restarted with new keys) signs the handler out.
    const guard =
      <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
      async (...args: A): Promise<R> => {
        try {
          return await call(...args);
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) signOut();
          throw error;
        }
      };
    return {
      signIn: inner.signIn,
      me: guard(inner.me),
      listClaims: guard(inner.listClaims),
      getClaim: guard(inner.getClaim),
      listSteps: guard(inner.listSteps),
      workClaim: guard(inner.workClaim),
      signOff: guard(inner.signOff),
      sendBack: guard(inner.sendBack),
    };
  }, [fetchFn, signOut]);

  useEffect(() => {
    if (!token) return;
    let live = true;
    api.me().then(
      (me) => {
        if (live) setHandler(me);
      },
      (caught: unknown) => {
        if (!live) return;
        // Only a token the api refuses ends the sign-in; anything else may pass, so it waits.
        if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) {
          signOut();
        } else {
          setMeError(caught instanceof Error ? caught.message : String(caught));
        }
      },
    );
    return () => {
      live = false;
    };
  }, [api, token, signOut, meAttempt]);

  const signedIn = useCallback((newToken: string) => {
    saveToken(newToken);
    setToken(newToken);
  }, []);

  if (token && !handler && meError) {
    return (
      <main className="sign-in" id="main">
        <h1>UnderCover claims</h1>
        <p className="error" role="alert">
          We couldn&apos;t check your sign-in: {meError}
        </p>
        <button
          type="button"
          className="button"
          onClick={() => {
            setMeError(null);
            setMeAttempt((value) => value + 1);
          }}
        >
          Try again
        </button>
      </main>
    );
  }

  if (!token || !handler) {
    return <SignInPage api={api} onSignedIn={signedIn} checking={Boolean(token)} />;
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header handler={handler} onSignOut={signOut} />
      <main id="main" tabIndex={-1}>
        <ErrorBoundary key={route.page === "claim" ? route.claimId : "queue"}>
          {route.page === "claim" ? (
            <ClaimPage
              key={route.claimId}
              api={api}
              claimId={route.claimId}
              handler={handler}
              pollMs={pollMs}
            />
          ) : (
            <QueuePage api={api} />
          )}
        </ErrorBoundary>
      </main>
    </>
  );
}
