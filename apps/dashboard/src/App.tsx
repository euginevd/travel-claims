import { ListChecks, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, createApi, type Api, type Handler } from "./api";
import { CommandPalette } from "./components/CommandPalette";
import { Copilot } from "./components/Copilot";
import { createCopilot } from "./copilot";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Header } from "./components/Header";
import { PayoutsStatus, PayoutsSwitch, usePayouts } from "./components/PayoutsSwitch";
import { ClaimPage } from "./pages/ClaimPage";
import { QueuePage } from "./pages/QueuePage";
import { SettingsPage } from "./pages/SettingsPage";
import { SignInPage } from "./pages/SignInPage";
import { loadToken, saveToken } from "./session";
import { QUEUE_HREF, SETTINGS_HREF, useHashRoute, type Route } from "./useHashRoute";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

interface AppProps {
  fetchFn?: Fetch;
  pollMs?: number;
}

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

export function App({ fetchFn = defaultFetch, pollMs = 1500 }: AppProps) {
  const [token, setToken] = useState<string | null>(loadToken);
  const [person, setPerson] = useState<Handler | null>(null);
  // Why the signed-in person couldn't be loaded, when it wasn't the token's fault.
  const [meError, setMeError] = useState<string | null>(null);
  const [meAttempt, setMeAttempt] = useState(0);
  const route = useHashRoute();
  const [copilotOpen, setCopilotOpen] = useState(false);

  const signOut = useCallback(() => {
    saveToken(null);
    setToken(null);
    setPerson(null);
  }, []);

  const api: Api = useMemo(
    () => guarded(createApi(fetchFn, loadToken), signOut),
    [fetchFn, signOut],
  );

  const copilot = useMemo(() => createCopilot(fetchFn, loadToken), [fetchFn]);
  const payouts = usePayouts(api, person !== null);
  const [payoutsOpen, setPayoutsOpen] = useState(false);

  useEffect(() => {
    if (!token) return;
    let live = true;
    api.me().then(
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
  }, [api, token, signOut, meAttempt]);

  const signedIn = useCallback((newToken: string) => {
    saveToken(newToken);
    setToken(newToken);
    window.location.hash = QUEUE_HREF;
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
      <Header
        name={person.name}
        detail={person.role}
        home={QUEUE_HREF}
        links={[
          {
            href: QUEUE_HREF,
            label: "Queue",
            Icon: ListChecks,
            current: route.page === "queue",
          },
          {
            href: SETTINGS_HREF,
            label: "Settings",
            Icon: SlidersHorizontal,
            current: route.page === "settings",
          },
        ]}
        onSignOut={signOut}
        onSearch={() => {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
        }}
        onCopilot={() => {
          setCopilotOpen((open) => !open);
        }}
        status={
          <PayoutsStatus
            state={payouts.state}
            senior={person.can_approve_over_limit}
            onOpen={() => {
              setPayoutsOpen(true);
              window.scrollTo({ top: 0 });
            }}
          />
        }
      />
      <main id="main" className="workspace" tabIndex={-1}>
        <PayoutsSwitch
          api={api}
          handler={person}
          state={payouts.state}
          onState={payouts.setState}
          editing={payoutsOpen}
          onEditing={setPayoutsOpen}
        />
        <ErrorBoundary key={routeKey(route)}>
          {handlerPage(route, api, person, pollMs)}
        </ErrorBoundary>
      </main>
      {copilotOpen && (
        <Copilot
          copilot={copilot}
          api={api}
          starters={
            route.page === "claim"
              ? [
                  `Summarise ${route.claimId}`,
                  `Any risk signals on ${route.claimId}?`,
                  `What's still missing on ${route.claimId}?`,
                ]
              : undefined
          }
          onClose={() => {
            setCopilotOpen(false);
          }}
        />
      )}
      <CommandPalette api={api} onSignOut={signOut} />
    </>
  );
}

function routeKey(route: Route): string {
  if ("claimId" in route) return `${route.page}:${route.claimId}`;
  if ("runId" in route) return `${route.page}:${String(route.runId)}`;
  return route.page;
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
  if (route.page === "settings") return <SettingsPage api={api} handler={handler} />;
  return <QueuePage api={api} handler={handler} />;
}
