import { useId, useState, type SubmitEvent } from "react";
import { ApiError, type Api } from "../api";

export const HANDLERS = [
  { email: "dana.whitfield@undercover.example", label: "Dana Whitfield, senior handler" },
  { email: "marcus.oyelaran@undercover.example", label: "Marcus Oyelaran, handler" },
  { email: "priya.raman@undercover.example", label: "Priya Raman, handler" },
];

interface SignInPageProps {
  api: Api;
  onSignedIn: (token: string) => void;
  checking: boolean;
}

export function SignInPage({ api, onSignedIn, checking }: SignInPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = useId();

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await api.signIn(email.trim(), password));
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 401
          ? "That email and password don't match a handler."
          : caught instanceof ApiError
            ? caught.message
            : "We couldn't reach the server. Is the app running?",
      );
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return (
      <main className="sign-in" id="main">
        <p role="status">Checking your sign-in…</p>
      </main>
    );
  }

  return (
    <main className="sign-in" id="main">
      <h1>UnderCover claims</h1>
      <p className="muted">Sign in as one of the claims handlers.</p>
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
        noValidate
        aria-describedby={error ? `${ids}-error` : undefined}
      >
        <fieldset>
          <legend>Choose a handler</legend>
          {HANDLERS.map((handler) => (
            <button
              key={handler.email}
              type="button"
              className={`choice${email === handler.email ? " chosen" : ""}`}
              aria-pressed={email === handler.email}
              onClick={() => {
                setEmail(handler.email);
              }}
            >
              {handler.label}
            </button>
          ))}
        </fieldset>
        <label htmlFor={`${ids}-email`}>Email</label>
        <input
          id={`${ids}-email`}
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
        <label htmlFor={`${ids}-password`}>Password</label>
        <input
          id={`${ids}-password`}
          type="password"
          autoComplete="current-password"
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
        <button type="submit" className="button" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
