import { Bell, FilePlus2, Inbox } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, createApi, type Api, type Customer } from "./api";
import { AskUnderCover } from "./components/AskUnderCover";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Header } from "./components/Header";
import { MyClaimPage } from "./pages/MyClaimPage";
import { MyClaimsPage } from "./pages/MyClaimsPage";
import { NewClaimPage } from "./pages/NewClaimPage";
import { SignInPage } from "./pages/SignInPage";
import { UpdatesPage } from "./pages/UpdatesPage";
import { loadToken, saveToken } from "./session";
import {
  MY_CLAIMS_HREF,
  NEW_CLAIM_HREF,
  UPDATES_HREF,
  useHashRoute,
  type Route,
} from "./useHashRoute";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

interface AppProps {
  fetchFn?: Fetch;
}

const defaultFetch: Fetch = (input, init) => fetch(input, init);

// A rejected token (expired, or the api restarted with new keys) signs the customer out.
function guarded(api: Api, signOut: () => void): Api {
  const wrapped = {} as Record<string, unknown>;
  for (const [name, call] of Object.entries(api) as [string, (...args: unknown[]) => unknown][]) {
    wrapped[name] =
      name === "signIn"
        ? call
        : async (...args: unknown[]) => {
            try {
              return await call(...args);
            } catch (error) {
              if (error instanceof ApiError && error.status === 401) signOut();
              throw error;
            }
          };
  }
  return wrapped as unknown as Api;
}

export function App({ fetchFn = defaultFetch }: AppProps) {
  const [token, setToken] = useState<string | null>(loadToken);
  const [customer, setCustomer] = useState<Customer | null>(null);
  // Why the signed-in customer couldn't be loaded, when it wasn't the token's fault.
  const [meError, setMeError] = useState<string | null>(null);
  const [meAttempt, setMeAttempt] = useState(0);
  const route = useHashRoute();

  const signOut = useCallback(() => {
    saveToken(null);
    setToken(null);
    setCustomer(null);
  }, []);

  const api: Api = useMemo(
    () => guarded(createApi(fetchFn, loadToken), signOut),
    [fetchFn, signOut],
  );

  useEffect(() => {
    if (!token) return;
    let live = true;
    api.myProfile().then(
      (found) => {
        if (live) setCustomer(found);
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
    window.location.hash = MY_CLAIMS_HREF;
  }, []);

  if (token && !customer && meError) {
    return (
      <main className="landing" id="main">
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

  if (!token || !customer) {
    return <SignInPage api={api} onSignedIn={signedIn} checking={Boolean(token)} />;
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header
        name={customer.name}
        detail="Customer"
        home={MY_CLAIMS_HREF}
        links={[
          { href: MY_CLAIMS_HREF, label: "My claims", Icon: Inbox },
          { href: NEW_CLAIM_HREF, label: "Make a claim", Icon: FilePlus2 },
          { href: UPDATES_HREF, label: "Updates", Icon: Bell },
        ]}
        onSignOut={signOut}
      />
      <div className="sky-band" aria-hidden="true" />
      <main id="main" tabIndex={-1}>
        <ErrorBoundary key={routeKey(route)}>{page(route, api, customer.name)}</ErrorBoundary>
      </main>
      <AskUnderCover api={api} />
    </>
  );
}

function routeKey(route: Route): string {
  return "claimId" in route ? `${route.page}:${route.claimId}` : route.page;
}

function page(route: Route, api: Api, name: string) {
  if (route.page === "my-claim") {
    return <MyClaimPage key={route.claimId} api={api} claimId={route.claimId} />;
  }
  if (route.page === "new-claim") return <NewClaimPage api={api} />;
  if (route.page === "updates") return <UpdatesPage api={api} />;
  return <MyClaimsPage api={api} name={name} />;
}
