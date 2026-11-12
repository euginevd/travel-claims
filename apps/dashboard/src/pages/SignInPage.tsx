import { ArrowRight, Check, FileSearch, Lock, UserRound } from "lucide-react";
import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import { ApiError, type Api, type TestAccount } from "../api";
import { initials } from "../components/Header";
import { Logo } from "../components/Logo";
import { ProjectLink } from "../components/Wattle";
import { prefersStill, SignInScene } from "../components/SignInScene";

// The test accounts: in a development build, a local image built with VITE_LOCAL_SIGN_IN=true,
// or the AWS demo built with VITE_TEST_SIGN_IN=true. The api signs in a fixed test account.
export const LOCAL_SIGN_IN =
  import.meta.env.DEV ||
  import.meta.env.VITE_LOCAL_SIGN_IN === "true" ||
  import.meta.env.VITE_TEST_SIGN_IN === "true";

// How long the "signed in" tick and the page's exit play before the queue comes in.
const EXIT_MS = 450;

const ACCOUNTS: { account: TestAccount; name: string; detail: string }[] = [
  { account: "senior", name: "Dana Whitfield", detail: "Senior handler · can sign off" },
  { account: "handler", name: "Marcus Oyelaran", detail: "Handler · no sign-off rights" },
];

// Each is true of the app: a decision names what it relied on and each check its source; a
// payout over the approval limit waits for a senior handler; a customer can ask for a person.
const POINTS = [
  { Icon: FileSearch, text: "Sources on every recommendation" },
  { Icon: Lock, text: "Senior sign-off over the approval limit" },
  { Icon: UserRound, text: "A person whenever one is asked for" },
];

const HEADLINE = [
  ["The", "agent", "recommends."],
  ["You", "decide."],
];

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
  const [showPassword, setShowPassword] = useState(false);
  const [account, setAccount] = useState<TestAccount>("senior");
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
      if (prefersStill()) {
        onSignedIn(token);
        return;
      }
      setDone(true);
      exit.current = window.setTimeout(() => {
        onSignedIn(token);
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
      <main className="landing" id="main">
        <Logo />
        <p role="status" className="muted">
          Checking your sign-in…
        </p>
      </main>
    );
  }

  const chosen = ACCOUNTS.find((option) => option.account === account) ?? ACCOUNTS[0];
  const state = done ? " ok" : busy ? " loading" : "";
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
            <h1 aria-label="The agent recommends. You decide.">
              {HEADLINE.map((line, row) => (
                <span key={row} className="headline-line" aria-hidden="true">
                  {line.map((word, index) => (
                    <span key={word} className={`word w${String(row * 3 + index + 1)}`}>
                      {word === "You" ? <em>{word}</em> : word}{" "}
                    </span>
                  ))}
                </span>
              ))}
            </h1>
            <p className="signin-lede rise d4">
              Review what the claims agent recommends, sign off large payouts and step in where a
              person&apos;s judgement is needed.
            </p>
            <div className="rise d5">
              <SignInScene />
            </div>
            <ul className="signin-points">
              {POINTS.map(({ Icon, text }) => (
                <li key={text} className="signin-point">
                  <span className="icon-tile" aria-hidden="true">
                    <Icon size={15} strokeWidth={1.75} />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          </section>

          <section className="signin-shell rise d6" aria-labelledby={`${ids}-title`}>
            <div className="signin-card">
              <form onSubmit={submit} noValidate>
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
                        <Check size={12} strokeWidth={1.75} nonScalingStroke aria-hidden="true" />
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
                        <ArrowRight size={16} strokeWidth={1.75} />
                      </span>
                    </span>
                  )}
                </button>
              </form>
              {LOCAL_SIGN_IN && chosen && (
                <fieldset className="accounts" disabled={busy}>
                  <legend>
                    Test accounts <span className="tag-demo">Demo</span>
                  </legend>
                  {ACCOUNTS.map((option) => (
                    <label key={option.account} className="account">
                      <input
                        type="radio"
                        name={`${ids}-account`}
                        value={option.account}
                        checked={option.account === account}
                        onChange={() => {
                          setAccount(option.account);
                        }}
                      />
                      <span className="account-avatar" aria-hidden="true">
                        {initials(option.name)}
                      </span>
                      <span className="account-who">
                        <b>{option.name}</b>
                        <small>{option.detail}</small>
                      </span>
                      <span className="account-dot" aria-hidden="true" />
                    </label>
                  ))}
                  <button
                    type="button"
                    className="button secondary wide"
                    onClick={() => {
                      void attempt(() => api.testSignIn(chosen.account));
                    }}
                  >
                    Continue as {chosen.name.split(" ")[0]}
                  </button>
                </fieldset>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
