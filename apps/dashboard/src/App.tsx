import { FilePlus2, Inbox, ListChecks } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, createApi, type Api, type Customer, type Handler, type Role } from "./api";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Header } from "./components/Header";
import { ClaimPage } from "./pages/ClaimPage";
import { MyClaimPage } from "./pages/MyClaimPage";
import { MyClaimsPage } from "./pages/MyClaimsPage";
import { NewClaimPage } from "./pages/NewClaimPage";
import { QueuePage } from "./pages/QueuePage";
import { SignInPage } from "./pages/SignInPage";
import { loadRole, loadToken, saveRole, saveToken } from "./session";
import {
  MY_CLAIMS_HREF,
  NEW_CLAIM_HREF,
  QUEUE_HREF,
  useHashRoute,
  type Route,
} from "./useHashRoute";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

interface AppProps {
  fetchFn?: Fetch;
  pollMs?: number;
}

type Person = { role: "handler"; handler: Handler } | { role: "customer"; customer: Customer };

const defaultFetch: Fetch = (input, init) => fetch(input, init);

// A rejected token (expired, or the api restarted with new keys) signs the person out.
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

async function whoIs(api: Api, role: Role): Promise<Person> {
  return role === "handler"
    ? { role, handler: await api.me() }
    : { role, customer: await api.myProfile() };
}

export function App({ fetchFn = defaultFetch, pollMs = 1500 }: AppProps) {
  const [token, setToken] = useState<string | null>(loadToken);
  const [role, setRole] = useState<Role>(loadRole);
  const [person, setPerson] = useState<Person | null>(null);
  // Why the signed-in person couldn't be loaded, when it wasn't the token's fault.
  const [meError, setMeError] = useState<string | null>(null);
  const [meAttempt, setMeAttempt] = useState(0);
  const route = useHashRoute();

  const signOut = useCallback(() => {
    saveToken(null);
    setToken(null);
    setPerson(null);
  }, []);

  const api: Api = useMemo(
    () => guarded(createApi(fetchFn, loadToken), signOut),
    [fetchFn, signOut],
  );

  useEffect(() => {
    if (!token) return;
    let live = true;
    whoIs(api, role).then(
      (found) => {
        if (live) setPerson(found);
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
  }, [api, token, role, signOut, meAttempt]);

  const signedIn = useCallback((newToken: string, newRole: Role) => {
    saveToken(newToken);
    saveRole(newRole);
    setRole(newRole);
    setToken(newToken);
    window.location.hash = newRole === "customer" ? MY_CLAIMS_HREF : QUEUE_HREF;
  }, []);

  if (token && !person && meError) {
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

  if (!token || !person) {
    return <SignInPage api={api} onSignedIn={signedIn} checking={Boolean(token)} />;
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {person.role === "handler" ? (
        <Header
          name={person.handler.name}
          detail={person.handler.role}
          home={QUEUE_HREF}
          links={[{ href: QUEUE_HREF, label: "Queue", Icon: ListChecks }]}
          onSignOut={signOut}
        />
      ) : (
        <Header
          name={person.customer.name}
          detail="Customer"
          home={MY_CLAIMS_HREF}
          links={[
            { href: MY_CLAIMS_HREF, label: "My claims", Icon: Inbox },
            { href: NEW_CLAIM_HREF, label: "Make a claim", Icon: FilePlus2 },
          ]}
          onSignOut={signOut}
        />
      )}
      <main id="main" tabIndex={-1}>
        <ErrorBoundary key={routeKey(route)}>
          {person.role === "handler"
            ? handlerPage(route, api, person.handler, pollMs)
            : customerPage(route, api)}
        </ErrorBoundary>
      </main>
    </>
  );
}

function routeKey(route: Route): string {
  return "claimId" in route ? `${route.page}:${route.claimId}` : route.page;
}

function handlerPage(route: Route, api: Api, handler: Handler, pollMs: number) {
  if (route.page === "claim") {
    return (
      <ClaimPage
        key={route.claimId}
        api={api}
        claimId={route.claimId}
        handler={handler}
        pollMs={pollMs}
      />
    );
  }
  return <QueuePage api={api} />;
}

function customerPage(route: Route, api: Api) {
  if (route.page === "my-claim") {
    return <MyClaimPage key={route.claimId} api={api} claimId={route.claimId} />;
  }
  if (route.page === "new-claim") return <NewClaimPage api={api} />;
  return <MyClaimsPage api={api} />;
}
