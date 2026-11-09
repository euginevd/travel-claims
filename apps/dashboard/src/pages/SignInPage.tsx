import { useId, useState, type SubmitEvent } from "react";
import { ApiError, type Api, type TestAccount } from "../api";
import { TravelIllustration } from "../components/Illustration";
import { Logo } from "../components/Logo";

// The test-account buttons: in a development build, a local image built with VITE_LOCAL_SIGN_IN=true,
// or the tier 2 demo built with VITE_TEST_SIGN_IN=true. The api signs in a fixed test account.
export const LOCAL_SIGN_IN =
  import.meta.env.DEV ||
  import.meta.env.VITE_LOCAL_SIGN_IN === "true" ||
  import.meta.env.VITE_TEST_SIGN_IN === "true";

interface SignInPageProps {
  api: Api;
  onSignedIn: (token: string) => void;
  checking: boolean;
}

function problem(caught: unknown): string {
  if (caught instanceof ApiError && caught.status === 401) {
    return "That email and password don't match a staff account.";
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

  const test = (account: TestAccount) => () => {
    void attempt(() => api.testSignIn(account));
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
        <h1>Claims workspace</h1>
        <p className="lead">
          Review what the claims agent recommends, sign off large payouts and step in where a
          person&apos;s judgement is needed.
        </p>
        <TravelIllustration />
      </section>
      <section className="landing-form panel" aria-labelledby={`${ids}-title`}>
        <h2 id={`${ids}-title`}>Sign in</h2>
        <p className="muted small">UnderCover staff only.</p>
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
              onClick={test("senior")}
            >
              <span className="test-tag">Test</span> Use test account
            </button>
            <button
              type="button"
              className="link-button small"
              disabled={busy}
              onClick={test("handler")}
            >
              Test as a handler without sign-off rights
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
