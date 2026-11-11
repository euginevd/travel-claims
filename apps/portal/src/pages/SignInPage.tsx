import { ArrowRight, Check } from "lucide-react";
import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import { ApiError, type Api } from "../api";
import { Logo } from "../components/Logo";
import { prefersStill, SignInMap } from "../components/SignInMap";
import { PROJECT_URL } from "../components/Wattle";

// The test-account button: in a development build, a local image built with VITE_LOCAL_SIGN_IN=true,
// or the AWS demo built with VITE_TEST_SIGN_IN=true. The api signs in the fixed test customer.
export const LOCAL_SIGN_IN =
  import.meta.env.DEV ||
  import.meta.env.VITE_LOCAL_SIGN_IN === "true" ||
  import.meta.env.VITE_TEST_SIGN_IN === "true";

// How long the "signed in" tick and the page's exit play before My claims rises in.
const EXIT_MS = 450;

interface SignInPageProps {
  api: Api;
  onSignedIn: (token: string) => void;
  checking: boolean;
}

const HEADLINE = [
  ["Trip", "went", "sideways?"],
  ["Let’s", "sort", "it", "out."],
];

/** A number that counts up from zero once, quickly; still for reduced motion. */
function useCountUp(end: number, delay: number): number {
  const [value, setValue] = useState(() => (prefersStill() ? end : 0));
  useEffect(() => {
    if (prefersStill()) return;
    let frame = 0;
    const start = performance.now() + delay;
    const step = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - start) / 900));
      setValue(Math.round(end * (1 - (1 - k) ** 3)));
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [end, delay]);
  return value;
}

function Stats() {
  const seconds = useCountUp(5, 900);
  const inTen = useCountUp(8, 1050);
  return (
    <dl className="signin-stats">
      <div className="signin-stat">
        <dt>Fastest claim paid</dt>
        <dd>
          {seconds}
          <small>sec</small>
        </dd>
      </div>
      <div className="signin-stat">
        <dt>Decided in under 30 secs</dt>
        <dd>
          {inTen}
          <small>in 10</small>
        </dd>
      </div>
      <div className="signin-stat">
        <dt>People on call</dt>
        <dd>
          24/7
          <span className="live-dot" aria-hidden="true" />
        </dd>
      </div>
    </dl>
  );
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
      if (prefersStill()) {
        onSignedIn(token);
        return;
      }
      setDone(true);
      exit.current = window.setTimeout(() => {
        onSignedIn(token);
      }, EXIT_MS);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 401
          ? "That email and password don't match an account."
          : caught instanceof ApiError
            ? caught.message
            : "We couldn't reach the server.",
      );
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
          <p className="signin-quote">
            <span>New to UnderCover?</span>
            <a className="button soft" href={PROJECT_URL}>
              Get a quote
            </a>
          </p>
        </header>

        <main className="signin-main" id="main">
          <section className="signin-hero">
            <h1 aria-label="Trip went sideways? Let’s sort it out.">
              {HEADLINE.map((line, row) => (
                <span key={row} className="headline-line" aria-hidden="true">
                  {line.map((word, index) => (
                    <span key={word} className={`word w${String(row * 3 + index + 1)}`}>
                      {word === "sideways?" ? <em>{word}</em> : word}{" "}
                    </span>
                  ))}
                </span>
              ))}
            </h1>
            <p className="signin-lede rise d4">
              Tell Wattle what happened. It checks your cover in seconds, and a person steps in
              whenever one should.
            </p>
            <div className="rise d5">
              <SignInMap />
            </div>
            <Stats />
          </section>

          <section className="signin-shell rise d6" aria-labelledby={`${ids}-title`}>
            <form className="signin-card" onSubmit={submit} noValidate>
              <h2 id={`${ids}-title`}>Welcome back</h2>
              <p className="signin-sub">Your trips, claims and payouts in one place.</p>
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
                <label htmlFor={`${ids}-email`}>Email</label>
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
                <div className="signin-demo">
                  <span>
                    No account needed <em className="tag-demo">Demo</em>
                  </span>
                  <button
                    type="button"
                    className="button soft"
                    disabled={busy}
                    onClick={() => {
                      void attempt(() => api.testSignIn());
                    }}
                  >
                    Use test account
                  </button>
                </div>
              )}
            </form>
          </section>
        </main>

        <footer className="signin-foot rise d5">
          <span>An AI demo by ArcVault AI</span>
          <span className="signin-foot-links">
            <span>Privacy</span>
            <span>Terms</span>
          </span>
        </footer>
      </div>
    </div>
  );
}
