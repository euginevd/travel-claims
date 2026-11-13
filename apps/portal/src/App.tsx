import { ErrorBoundary } from "@undercover/web-core/ErrorBoundary";
import { guarded } from "@undercover/web-core/guarded";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, createApi, type Api, type Cover, type Customer } from "./api";
import { Home } from "./chat/Home";
import { lastSeen, markSeen } from "./chat/messages";
import { useRecords } from "./chat/records";
import { SidePanel, type PanelTarget } from "./chat/SidePanel";
import { Header } from "./components/Header";
import { SignInPage } from "./pages/SignInPage";
import { loadToken, saveToken } from "./session";
import { HOME_HREF, useHashRoute, type Route } from "./useHashRoute";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

interface AppProps {
  fetchFn?: Fetch;
}

const defaultFetch: Fetch = (input, init) => fetch(input, init);

const unauthorised = (error: unknown) => error instanceof ApiError && error.status === 401;

export function App({ fetchFn = defaultFetch }: AppProps) {
  const [token, setToken] = useState<string | null>(loadToken);
  const [customer, setCustomer] = useState<Customer | null>(null);
  // Why the signed-in customer couldn't be loaded, when it wasn't the token's fault.
  const [meError, setMeError] = useState<string | null>(null);
  const [meAttempt, setMeAttempt] = useState(0);

  const signOut = useCallback(() => {
    saveToken(null);
    setToken(null);
    setCustomer(null);
  }, []);

  const api: Api = useMemo(
    () => guarded(createApi(fetchFn, loadToken), signOut, unauthorised),
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
  return <Portal api={api} customer={customer} onSignOut={signOut} />;
}

function targetFor(route: Route): PanelTarget | null {
  if (route.page === "claims") return { view: "claims", claimId: route.claimId };
  if (route.page === "messages") return { view: "messages" };
  if (route.page === "settings") return { view: "settings" };
  return null;
}

/** The signed-in portal: the conversation, with the side panel over it when it's open. */
function Portal({
  api,
  customer,
  onSignOut,
}: {
  api: Api;
  customer: Customer;
  onSignOut: () => void;
}) {
  const route = useHashRoute();
  const { records, loaded, refresh } = useRecords(api);
  const [panel, setPanel] = useState<PanelTarget | null>(() => targetFor(route));
  const [restart, setRestart] = useState(0);
  // Each press of Home: back to the start screen, the conversation kept.
  const [homeTick, setHomeTick] = useState(0);
  const [start, setStart] = useState<{ kind: "claim" } | { kind: "policy"; cover: Cover } | null>(
    () => (route.page === "new-claim" ? { kind: "claim" } : null),
  );
  const [seen, setSeen] = useState(lastSeen);

  // A link (from an email, or typed) opens the panel where it points.
  const [lastRoute, setLastRoute] = useState(route);
  if (route !== lastRoute) {
    setLastRoute(route);
    const target = targetFor(route);
    if (target) setPanel(target);
    if (route.page === "new-claim") setStart({ kind: "claim" });
  }

  // Messages open, however they were opened, counts as seen.
  const unread = panel?.view !== "messages" && records.notices.some((n) => n.notice_id > seen);

  const open = useCallback(
    (target: PanelTarget) => {
      setPanel(target);
      if (target.view === "messages") {
        markSeen(records.notices);
        setSeen(lastSeen());
      }
    },
    [records.notices],
  );

  const close = useCallback(() => {
    if (panel?.view === "messages") {
      markSeen(records.notices);
      setSeen(lastSeen());
    }
    setPanel(null);
    if (window.location.hash !== HOME_HREF && window.location.hash !== "") {
      window.history.replaceState(null, "", HOME_HREF);
    }
  }, [panel, records.notices]);

  const firstName = customer.name.split(/\s+/)[0] ?? customer.name;
  return (
    <div className="portal">
      <div className="page-glow" aria-hidden="true">
        <span className="blob b1" />
        <span className="blob b3" />
        <span className="blob b2" />
      </div>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {/* With the panel open, only the panel can be reached. */}
      <div className="portal-top" inert={panel !== null}>
        <Header
          name={customer.name}
          unread={unread}
          open={panel?.view ?? null}
          onHome={() => {
            setPanel(null);
            setHomeTick((value) => value + 1);
          }}
          onMessages={() => {
            open({ view: "messages" });
          }}
          onClaims={() => {
            open({ view: "claims" });
          }}
          onSettings={() => {
            open({ view: "settings" });
          }}
        />
      </div>
      <main id="main" tabIndex={-1} className="portal-main" inert={panel !== null}>
        <ErrorBoundary wayBack={<a href={HOME_HREF}>start again</a>}>
          <Home
            key={restart}
            onNewChat={() => {
              setPanel(null);
              setStart(null);
              setRestart((value) => value + 1);
            }}
            homeTick={homeTick}
            api={api}
            firstName={firstName}
            records={records}
            loaded={loaded}
            onOpen={open}
            onChanged={refresh}
            start={start}
          />
        </ErrorBoundary>
      </main>
      {panel && (
        <SidePanel
          api={api}
          records={records}
          target={panel}
          onTarget={open}
          onClose={close}
          onChanged={refresh}
          onStartClaim={() => {
            close();
            setRestart((value) => value + 1);
            setStart({ kind: "claim" });
          }}
          onAskAboutPolicy={(cover) => {
            close();
            setRestart((value) => value + 1);
            setStart({ kind: "policy", cover });
          }}
          onSignOut={onSignOut}
        />
      )}
    </div>
  );
}
