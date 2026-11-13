import { ErrorBoundary } from "@undercover/web-core/ErrorBoundary";
import { guarded } from "@undercover/web-core/guarded";
import { Logo } from "@undercover/web-core/Logo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, createApi, type Api, type Engineer } from "./api";
import { AskWattle } from "./components/AskWattle";
import { AlertBell } from "./components/AlertBell";
import { ControlPills } from "./components/ControlPills";
import { Header, LOGO_SUBTITLE, type NavSection } from "./components/Header";
import { DetectionsPage } from "./pages/DetectionsPage";
import { ImprovementPage } from "./pages/ImprovementPage";
import { LivePage } from "./pages/LivePage";
import { PosturePage } from "./pages/PosturePage";
import { RedTeamPage } from "./pages/RedTeamPage";
import { AgentsPage } from "./pages/AgentsPage";
import { AuditPage } from "./pages/AuditPage";
import { CostPage } from "./pages/CostPage";
import { OverviewPage } from "./pages/OverviewPage";
import { VersionPage } from "./pages/VersionPage";
import { RunPage } from "./pages/RunPage";
import { ScoreboardPage } from "./pages/ScoreboardPage";
import { SignInPage } from "./pages/SignInPage";
import { TracePage } from "./pages/TracePage";
import { loadToken, saveToken } from "./session";
import {
  DETECTIONS_HREF,
  HOME_HREF,
  IMPROVEMENT_HREF,
  LIVE_HREF,
  POSTURE_HREF,
  REDTEAM_HREF,
  SCOREBOARD_HREF,
  AGENTS_HREF,
  AUDIT_HREF,
  BUDGETS_HREF,
  OVERVIEW_HREF,
  TRACE_HREF,
  useHashRoute,
  type Route,
} from "./useHashRoute";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

interface AppProps {
  fetchFn?: Fetch;
}

const defaultFetch: Fetch = (input, init) => fetch(input, init);

const unauthorised = (error: unknown) => error instanceof ApiError && error.status === 401;

/** The AI control plane, the overview first. Observe: the agents, live behaviour and traces.
 * Evaluate: the exam and the red team. Secure: the posture and guardrails. Govern: versions and
 * the audit log. The agent and payouts switches show in the header on every page. */
export function App({ fetchFn = defaultFetch }: AppProps) {
  const [token, setToken] = useState<string | null>(loadToken);
  const [person, setPerson] = useState<Engineer | null>(null);
  const [meError, setMeError] = useState<string | null>(null);
  const [meAttempt, setMeAttempt] = useState(0);
  const route = useHashRoute();
  const [assistantOpen, setAssistantOpen] = useState(false);
  const assistantToggle = useRef<HTMLButtonElement>(null);
  // Closing the panel puts focus back on the button that opens it.
  const closeAssistant = useCallback(() => {
    setAssistantOpen(false);
    assistantToggle.current?.focus();
  }, []);

  const signOut = useCallback(() => {
    saveToken(null);
    setToken(null);
    setPerson(null);
  }, []);

  const api: Api = useMemo(
    () => guarded(createApi(fetchFn, loadToken), signOut, unauthorised),
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
    window.location.hash = HOME_HREF;
  }, []);

  if (token && !person && meError) {
    return (
      <main className="gate" id="main">
        <Logo subtitle={LOGO_SUBTITLE} />
        <h1>AI control plane</h1>
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
        home={HOME_HREF}
        sections={NAV}
        current={currentHref(route)}
        onSignOut={signOut}
        status={
          <>
            <AlertBell api={api} />
            <ControlPills api={api} />
          </>
        }
        onAssistant={() => {
          setAssistantOpen((now) => !now);
        }}
        assistantOpen={assistantOpen}
        assistantToggle={assistantToggle}
      />
      <main id="main" className="page" tabIndex={-1}>
        <ErrorBoundary
          key={routeKey(route)}
          wayBack={
            <>
              go <a href={HOME_HREF}>back to the overview</a>
            </>
          }
        >
          {page(route, api, person.name)}
        </ErrorBoundary>
      </main>
      {assistantOpen && <AskWattle api={api} route={route} onClose={closeAssistant} />}
    </>
  );
}

const NAV: NavSection[] = [
  { label: "Overview", links: [{ href: OVERVIEW_HREF, label: "Overview" }] },
  {
    label: "Observe",
    links: [
      { href: AGENTS_HREF, label: "Agents" },
      { href: LIVE_HREF, label: "Live" },
      { href: TRACE_HREF, label: "Trace" },
    ],
  },
  {
    label: "Evaluate",
    links: [
      { href: SCOREBOARD_HREF, label: "Scoreboard" },
      { href: REDTEAM_HREF, label: "Red team" },
    ],
  },
  {
    label: "Secure",
    links: [
      { href: POSTURE_HREF, label: "Posture" },
      { href: DETECTIONS_HREF, label: "Guardrails" },
    ],
  },
  {
    label: "Govern",
    links: [
      { href: BUDGETS_HREF, label: "Cost" },
      { href: IMPROVEMENT_HREF, label: "Versions" },
      { href: AUDIT_HREF, label: "Audit log" },
    ],
  },
];

const HREFS: Record<Exclude<Route["page"], "run" | "version">, string> = {
  overview: OVERVIEW_HREF,
  agents: AGENTS_HREF,
  audit: AUDIT_HREF,
  budgets: BUDGETS_HREF,
  posture: POSTURE_HREF,
  detections: DETECTIONS_HREF,
  redteam: REDTEAM_HREF,
  scoreboard: SCOREBOARD_HREF,
  live: LIVE_HREF,
  improvement: IMPROVEMENT_HREF,
  trace: TRACE_HREF,
};

/** The navigation link for a route; a run belongs to the scoreboard, a version to Improvement. */
function currentHref(route: Route): string {
  if (route.page === "run") return SCOREBOARD_HREF;
  if (route.page === "version") return IMPROVEMENT_HREF;
  return HREFS[route.page];
}

function routeKey(route: Route): string {
  if (route.page === "run") return `run:${String(route.runId)}`;
  if (route.page === "version") return `version:${String(route.version)}`;
  if (route.page === "trace") return `trace:${route.claimId ?? ""}`;
  return route.page;
}

function page(route: Route, api: Api, name: string) {
  switch (route.page) {
    case "overview":
      return <OverviewPage api={api} name={name} />;
    case "agents":
      return <AgentsPage api={api} />;
    case "audit":
      return <AuditPage api={api} />;
    case "budgets":
      return <CostPage api={api} />;
    case "version":
      return <VersionPage key={route.version} api={api} version={route.version} />;
    case "run":
      return <RunPage key={route.runId} api={api} runId={route.runId} />;
    case "detections":
      return <DetectionsPage api={api} />;
    case "redteam":
      return <RedTeamPage api={api} />;
    case "scoreboard":
      return <ScoreboardPage api={api} />;
    case "live":
      return <LivePage api={api} />;
    case "improvement":
      return <ImprovementPage api={api} />;
    case "trace":
      return <TracePage api={api} claimId={route.claimId} />;
    case "posture":
      return <PosturePage api={api} />;
  }
}
