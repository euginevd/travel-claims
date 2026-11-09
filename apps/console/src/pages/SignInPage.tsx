import { useId, useState, type SubmitEvent } from "react";
import { ApiError, type Api } from "../api";
import { TravelIllustration } from "../components/Illustration";
import { Logo } from "../components/Logo";

// The test-account buttons appear only where the local sign-in stand-in runs: a development
// build, or a local image built with VITE_LOCAL_SIGN_IN=true. They ask the api's dev route to
// sign in a fixed test account, so no password is ever in the browser.
export const LOCAL_SIGN_IN = import.meta.env.DEV || import.meta.env.VITE_LOCAL_SIGN_IN === "true";

interface SignInPageProps {
  api: Api;
  onSignedIn: (token: string) => void;
  checking: boolean;
}

function problem(caught: unknown): string {
  if (caught instanceof ApiError && caught.status === 401) {
    return "That email and password don't match an AI engineer's account.";
  }
  return caught instanceof ApiError ? caught.message : "We couldn't reach the server.";
}

export function SignInPage({ api, onSignedIn, checking }: SignInPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = useId();

  async function attempt(signIn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await signIn());
    } catch (caught) {
      setError(problem(caught));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    void attempt(() => api.signIn(email.trim(), password));
  }

  const test = () => {
    void attempt(() => api.testSignIn());
  };

  if (checking) {
    return (
      <main className="landing" id="main">
        <p role="status">Checking your sign-in…</p>
      </main>
    );
  }

  return (
    <main className="landing" id="main">
      <section className="landing-hero">
        <Logo />
        <h1>AI assurance console</h1>
        <p className="lead">
          Quality and security for the claims agent: score it against handlers&apos; decisions,
          approve its improvements and attack it with the red team.
        </p>
        <TravelIllustration />
      </section>
      <section className="landing-form panel" aria-labelledby={`${ids}-title`}>
        <h2 id={`${ids}-title`}>Sign in</h2>
        <p className="muted small">UnderCover AI engineers only.</p>
        <form onSubmit={submit} noValidate>
          <label htmlFor={`${ids}-email`}>Work email</label>
          <input
            id={`${ids}-email`}
            type="email"
            autoComplete="username"
            aria-describedby={error ? `${ids}-error` : undefined}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
          <div className="label-row">
            <label htmlFor={`${ids}-password`}>Password</label>
            <span className="muted small">Forgot password?</span>
          </div>
          <input
            id={`${ids}-password`}
            type="password"
            autoComplete="current-password"
            aria-describedby={error ? `${ids}-error` : undefined}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
          {error && (
            <p id={`${ids}-error`} className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="button wide" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        {LOCAL_SIGN_IN && (
          <div className="test-sign-in">
            <button
              type="button"
              className="button secondary small-button"
              disabled={busy}
              onClick={test}
            >
              <span className="test-tag">Test</span> Use test account
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
