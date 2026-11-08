import { useId, useState, type SubmitEvent } from "react";
import { ApiError, type Api } from "../api";
import { TravelIllustration } from "../components/Illustration";
import { Logo } from "../components/Logo";

// The test-account button appears only where the local sign-in stand-in runs: a development
// build, or a local image built with VITE_LOCAL_SIGN_IN=true. It asks the api's dev route to
// sign in the fixed test customer, so no password is ever in the browser.
export const LOCAL_SIGN_IN = import.meta.env.DEV || import.meta.env.VITE_LOCAL_SIGN_IN === "true";

interface SignInPageProps {
  api: Api;
  onSignedIn: (token: string) => void;
  checking: boolean;
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.6 9.2c0-.6-.1-1.2-.2-1.8H9v3.4h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.5Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H.9v2.3A9 9 0 0 0 9 18Z"
      />
      <path fill="#FBBC05" d="M3.9 10.7a5.4 5.4 0 0 1 0-3.4V5H.9a9 9 0 0 0 0 8l3-2.3Z" />
      <path
        fill="#EA4335"
        d="M9 3.6c1.3 0 2.5.5 3.5 1.4L15 2.4A9 9 0 0 0 .9 5l3 2.3C4.6 5.2 6.6 3.6 9 3.6Z"
      />
    </svg>
  );
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
      setError(
        caught instanceof ApiError && caught.status === 401
          ? "That email and password don't match an account."
          : caught instanceof ApiError
            ? caught.message
            : "We couldn't reach the server.",
      );
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
        <h1>Claim in minutes</h1>
        <p className="lead">
          Snap your receipts, tell us what happened in a few words, and track your claim as we look
          at it.
        </p>
        <TravelIllustration />
      </section>
      <section className="landing-form panel" aria-labelledby={`${ids}-title`}>
        <h2 id={`${ids}-title`}>Sign in</h2>
        <button
          type="button"
          className="button secondary wide google"
          disabled
          aria-describedby={`${ids}-soon`}
        >
          <GoogleMark />
          Continue with Google
        </button>
        <p id={`${ids}-soon`} className="muted small center">
          Coming soon
        </p>
        <p className="divider">
          <span>or with your email</span>
        </p>
        <form onSubmit={submit} noValidate>
          <label htmlFor={`${ids}-email`}>Email</label>
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
              onClick={() => {
                void attempt(() => api.testSignIn());
              }}
            >
              <span className="test-tag">Test</span> Use test account
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
