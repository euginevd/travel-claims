import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, createApi, type Api, type Handler } from "./api";
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
      () => {
        // A 401 has already signed out; any other failure leaves the sign-in page showing.
        if (live) signOut();
      },
    );
    return () => {
      live = false;
    };
  }, [api, token, signOut]);

  const signedIn = useCallback((newToken: string) => {
    saveToken(newToken);
    setToken(newToken);
  }, []);

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
      </main>
    </>
  );
}
