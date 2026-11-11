import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, createApi, type Api, type Engineer } from "./api";
import { AskWattle } from "./components/AskWattle";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Header, type NavGroup } from "./components/Header";
import { Logo } from "./components/Logo";
import { ImprovementPage } from "./pages/ImprovementPage";
import { LivePage } from "./pages/LivePage";
import { RedTeamPage } from "./pages/RedTeamPage";
import { RunPage } from "./pages/RunPage";
import { ScoreboardPage } from "./pages/ScoreboardPage";
import { SignInPage } from "./pages/SignInPage";
import { ThreatsPage } from "./pages/ThreatsPage";
import { TracePage } from "./pages/TracePage";
import { loadToken, saveToken } from "./session";
import {
  IMPROVEMENT_HREF,
  LIVE_HREF,
  REDTEAM_HREF,
  SCOREBOARD_HREF,
  THREATS_HREF,
  TRACE_HREF,
  useHashRoute,
  type Route,
} from "./useHashRoute";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

interface AppProps {
  fetchFn?: Fetch;
}

const defaultFetch: Fetch = (input, init) => fetch(input, init);

// A rejected token (expired, or the api restarted with new keys) signs the person out.
function guarded(api: Api, signOut: () => void): Api {
  const wrapped = {} as Record<string, unknown>;
  for (const [name, call] of Object.entries(api) as [string, (...args: unknown[]) => unknown][]) {
    wrapped[name] =
      name === "signIn" || name === "testSignIn"
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

/** The AI assurance console. Quality: evaluations and improvement rounds. Security: the red team. */
export function App({ fetchFn = defaultFetch }: AppProps) {
  const [token, setToken] = useState<string | null>(loadToken);
  const [person, setPerson] = useState<Engineer | null>(null);
  const [meError, setMeError] = useState<string | null>(null);
  const [meAttempt, setMeAttempt] = useState(0);
  const route = useHashRoute();
  const [assistantOpen, setAssistantOpen] = useState(false);

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
    api.me().then(
      (found) => {
        if (live) setPerson(found);
      },
      (caught: unknown) => {
        if (!live) return;
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
    window.location.hash = SCOREBOARD_HREF;
  }, []);

  if (token && !person && meError) {
    return (
      <main className="gate" id="main">
        <Logo />
        <h1>AI assurance console</h1>
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
        home={SCOREBOARD_HREF}
        groups={NAV}
        current={currentHref(route)}
        onSignOut={signOut}
        onAssistant={() => {
          setAssistantOpen((now) => !now);
        }}
      />
      <main id="main" className="page" tabIndex={-1}>
        <ErrorBoundary key={routeKey(route)}>{page(route, api)}</ErrorBoundary>
      </main>
      {assistantOpen && (
        <AskWattle
          api={api}
          route={route}
          onClose={() => {
            setAssistantOpen(false);
          }}
        />
      )}
    </>
  );
}

const NAV: NavGroup[] = [
  {
    label: "Quality",
    links: [
      { href: SCOREBOARD_HREF, label: "Scoreboard" },
      { href: LIVE_HREF, label: "Live" },
      { href: IMPROVEMENT_HREF, label: "Improvement" },
      { href: TRACE_HREF, label: "Claim trace" },
    ],
  },
  {
    label: "Security",
    links: [
      { href: REDTEAM_HREF, label: "Red team" },
      { href: THREATS_HREF, label: "Threat coverage" },
    ],
  },
];

/** The navigation link for a route; a run belongs to the scoreboard. */
function currentHref(route: Route): string {
  if (route.page === "live") return LIVE_HREF;
  if (route.page === "improvement") return IMPROVEMENT_HREF;
  if (route.page === "redteam") return REDTEAM_HREF;
  if (route.page === "trace") return TRACE_HREF;
  if (route.page === "threats") return THREATS_HREF;
  return SCOREBOARD_HREF;
}

function routeKey(route: Route): string {
  return route.page === "run" ? `run:${String(route.runId)}` : route.page;
}

function page(route: Route, api: Api) {
  if (route.page === "run") return <RunPage key={route.runId} api={api} runId={route.runId} />;
  if (route.page === "live") return <LivePage api={api} />;
  if (route.page === "improvement") return <ImprovementPage api={api} />;
  if (route.page === "redteam") return <RedTeamPage api={api} />;
  if (route.page === "trace") return <TracePage api={api} />;
  if (route.page === "threats") return <ThreatsPage api={api} />;
  return <ScoreboardPage api={api} />;
}
