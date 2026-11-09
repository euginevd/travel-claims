import { FlaskConical, ShieldCheck, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, createApi, type Api, type Engineer } from "./api";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Header } from "./components/Header";
import { ImprovementPage } from "./pages/ImprovementPage";
import { RedTeamPage } from "./pages/RedTeamPage";
import { RunPage } from "./pages/RunPage";
import { ScoreboardPage } from "./pages/ScoreboardPage";
import { SignInPage } from "./pages/SignInPage";
import { loadToken, saveToken } from "./session";
import {
  IMPROVEMENT_HREF,
  REDTEAM_HREF,
  SCOREBOARD_HREF,
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

/** The AI engineers' console: evaluations, improvement rounds and the red team. */
export function App({ fetchFn = defaultFetch }: AppProps) {
  const [token, setToken] = useState<string | null>(loadToken);
  const [person, setPerson] = useState<Engineer | null>(null);
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
      <main className="landing" id="main">
        <h1>AI engineering console</h1>
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
        links={[
          { href: SCOREBOARD_HREF, label: "Scoreboard", Icon: FlaskConical },
          { href: IMPROVEMENT_HREF, label: "Improvement", Icon: Sparkles },
          { href: REDTEAM_HREF, label: "Red team", Icon: ShieldCheck },
        ]}
        onSignOut={signOut}
      />
      <main id="main" tabIndex={-1}>
        <ErrorBoundary key={routeKey(route)}>{page(route, api)}</ErrorBoundary>
      </main>
    </>
  );
}

function routeKey(route: Route): string {
  return route.page === "run" ? `run:${String(route.runId)}` : route.page;
}

function page(route: Route, api: Api) {
  if (route.page === "run") return <RunPage key={route.runId} api={api} runId={route.runId} />;
  if (route.page === "improvement") return <ImprovementPage api={api} />;
  if (route.page === "redteam") return <RedTeamPage api={api} />;
  return <ScoreboardPage api={api} />;
}
