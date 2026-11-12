import { ArrowRight, Check, LoaderCircle, Lock, Route, ShieldCheck } from "lucide-react";
import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import { ApiError, type Api } from "../api";
import { initials } from "../components/Header";
import { Logo } from "../components/Logo";
import { ProjectLink } from "../components/Wattle";
import { prefersStill, SignInRun } from "../components/SignInRun";

// The test accounts: in a development build, a local image built with VITE_LOCAL_SIGN_IN=true,
// or the AWS demo built with VITE_TEST_SIGN_IN=true. The api signs in a fixed test account.
export const LOCAL_SIGN_IN =
  import.meta.env.DEV ||
  import.meta.env.VITE_LOCAL_SIGN_IN === "true" ||
  import.meta.env.VITE_TEST_SIGN_IN === "true";

// The one test account the api signs in for the console.
const TEST_ACCOUNT = { name: "Sam Carter", role: "AI engineer" };

// How long the "signed in" tick and the page's exit play before the scoreboard rises in.
const EXIT_MS = 450;

// Each is true of the app: every claim has a trace (Claim trace), the red team's attacks are
// mapped to OWASP risks (Threat coverage), and a proposed configuration is only tried after an
// AI engineer approves it (Improvement).
const POINTS = [
  { Icon: Route, text: "Every decision traced" },
  { Icon: ShieldCheck, text: "Red-teamed against OWASP risks" },
  { Icon: Check, text: "Changes need approval" },
];

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
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const exit = useRef<number | undefined>(undefined);
  const ids = useId();

  useEffect(
    () => () => {
      window.clearTimeout(exit.current);
    },
    [],
  );

  async function attempt(signIn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      const token = await signIn();
      // The page stays mounted while the app checks the token, so it must be ready to be used
      // again if that check signs the engineer straight back out.
      if (prefersStill()) {
        onSignedIn(token);
        setBusy(false);
        return;
      }
      setDone(true);
      exit.current = window.setTimeout(() => {
        onSignedIn(token);
        setDone(false);
        setBusy(false);
      }, EXIT_MS);
    } catch (caught) {
      setError(problem(caught));
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
      <main className="gate" id="main">
        <Logo />
        <p role="status" className="loading">
          <LoaderCircle className="spin" size={16} strokeWidth={1.75} aria-hidden="true" />
          Checking your sign-in…
        </p>
      </main>
    );
  }

  const state = done ? " ok" : busy ? " loading" : "";
  const firstName = TEST_ACCOUNT.name.split(" ")[0] ?? TEST_ACCOUNT.name;
  return (
    <div className={`signin${done ? " leaving" : ""}`}>
      <div className="page-glow" aria-hidden="true">
        <span className="blob b1" />
        <span className="blob b2" />
        <span className="blob b3" />
        <span className="blob b4" />
      </div>
      <div className="signin-page">
        <header className="signin-top rise d1">
          <span className="brand">
            <Logo animate />
          </span>
          <p className="signin-staff">
            <ProjectLink />
            <span className="signin-staff-note">
              <Lock size={15} strokeWidth={1.75} aria-hidden="true" />
              UnderCover staff only
            </span>
          </p>
        </header>

        <main className="signin-main" id="main">
          <section className="signin-hero">
            <h1 aria-label="Every AI decision, measured.">
              <span className="headline-line" aria-hidden="true">
                <span className="word w1">Every </span>
                <span className="word w2">AI </span>
                <span className="word w3">decision,</span>
              </span>
              <span className="headline-line" aria-hidden="true">
                <span className="word w4">
                  <em>measured.</em>
                </span>
              </span>
            </h1>
            <p className="signin-lede rise d4">
              Evals and security for the claims agent: score it against handlers&apos; decisions,
              approve its improvements and attack it with the red team.
            </p>
            <div className="rise d5">
              <SignInRun />
            </div>
            <ul className="signin-points">
              {POINTS.map(({ Icon, text }) => (
                <li key={text} className="signin-point">
                  <span className="icon-tile">
                    <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          </section>

          <section className="signin-shell rise d6" aria-labelledby={`${ids}-title`}>
            <form className="signin-card" onSubmit={submit} noValidate>
              <h2 id={`${ids}-title`}>Welcome back</h2>
              <p className="signin-sub">Use your UnderCover work account.</p>
              <div className="float-field">
                <input
                  id={`${ids}-email`}
                  type="email"
                  autoComplete="username"
                  placeholder=" "
                  aria-describedby={error ? `${ids}-error` : undefined}
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                  }}
                />
                <label htmlFor={`${ids}-email`}>Work email</label>
              </div>
              <div className="float-field">
                <input
                  id={`${ids}-password`}
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder=" "
                  aria-describedby={error ? `${ids}-error` : undefined}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                  }}
                />
                <label htmlFor={`${ids}-password`}>Password</label>
                <button
                  type="button"
                  className="field-eye"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  onClick={() => {
                    setShowPassword((now) => !now);
                  }}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              {error && (
                <p id={`${ids}-error`} className="field-error" role="alert">
                  {error}
                </p>
              )}
              <p className="signin-meta">
                <span>Forgot password?</span>
              </p>
              <button type="submit" className={`go${state}`} disabled={busy}>
                {done ? (
                  <span className="go-state">
                    <span className="go-tick">
                      <Check size={12} strokeWidth={3.2} aria-hidden="true" />
                    </span>
                    Welcome back
                  </span>
                ) : busy ? (
                  <span className="go-state">
                    <span className="go-spin" aria-hidden="true" />
                    Signing you in
                  </span>
                ) : (
                  <span className="go-label">
                    <span>Sign in</span>
                    <span className="go-knob" aria-hidden="true">
                      <ArrowRight size={16} strokeWidth={2.2} />
                    </span>
                  </span>
                )}
              </button>
              {LOCAL_SIGN_IN && (
                <fieldset className="accounts">
                  <legend>
                    Test accounts <em className="tag-demo">Demo</em>
                  </legend>
                  <label className="account">
                    <input type="radio" name={`${ids}-account`} defaultChecked />
                    <span className="avatar" aria-hidden="true">
                      {initials(TEST_ACCOUNT.name)}
                    </span>
                    <span className="account-who">
                      <b>{TEST_ACCOUNT.name}</b>
                      <small>{TEST_ACCOUNT.role}</small>
                    </span>
                    <span className="account-radio" aria-hidden="true" />
                  </label>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => {
                      void attempt(() => api.testSignIn());
                    }}
                  >
                    Continue as {firstName}
                  </button>
                </fieldset>
              )}
            </form>
          </section>
        </main>

        <p className="signin-foot rise d5">An AI demo by ArcVault AI</p>
      </div>
    </div>
  );
}
