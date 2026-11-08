import { Briefcase, UserRound } from "lucide-react";
import { useId, useState, type SubmitEvent } from "react";
import { ApiError, type Api, type Role } from "../api";
import { TravelIllustration } from "../components/Illustration";
import { Logo } from "../components/Logo";

// The seeded people, offered as one-click choices only where the local sign-in stand-in runs:
// a development build, or a local image built with VITE_LOCAL_SIGN_IN=true. Anywhere else
// people sign in through Cognito instead.
export const LOCAL_SIGN_IN = import.meta.env.DEV || import.meta.env.VITE_LOCAL_SIGN_IN === "true";
export const PEOPLE: Record<Role, { email: string; name: string; note: string }[]> = LOCAL_SIGN_IN
  ? {
      handler: [
        {
          email: "dana.whitfield@undercover.example",
          name: "Dana Whitfield",
          note: "Senior handler",
        },
        { email: "marcus.oyelaran@undercover.example", name: "Marcus Oyelaran", note: "Handler" },
        { email: "priya.raman@undercover.example", name: "Priya Raman", note: "Handler" },
      ],
      customer: [
        { email: "maya.patel@example.com", name: "Maya Patel", note: "Trip to Rome" },
        { email: "oliver.grant@example.com", name: "Oliver Grant", note: "Kenya and Sri Lanka" },
        { email: "dorothy.gale@example.com", name: "Dorothy Gale", note: "Trip to Seattle" },
      ],
    }
  : { handler: [], customer: [] };

const ROLES: { role: Role; title: string; hint: string; Icon: typeof UserRound }[] = [
  {
    role: "customer",
    title: "I'm a customer",
    hint: "Make a claim and see how it's going",
    Icon: UserRound,
  },
  {
    role: "handler",
    title: "I'm a claims handler",
    hint: "Work the queue and sign off payouts",
    Icon: Briefcase,
  },
];

interface SignInPageProps {
  api: Api;
  onSignedIn: (token: string, role: Role) => void;
  checking: boolean;
}

export function SignInPage({ api, onSignedIn, checking }: SignInPageProps) {
  const [role, setRole] = useState<Role>("customer");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = useId();
  const people = PEOPLE[role];

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await api.signIn(email.trim(), password, role), role);
    } catch (caught) {
      const who = role === "handler" ? "a claims handler" : "a customer";
      setError(
        caught instanceof ApiError && caught.status === 401
          ? `That email and password don't match ${who}.`
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
      <main className="landing" id="main">
        <p role="status">Checking your sign-in…</p>
      </main>
    );
  }

  return (
    <main className="landing" id="main">
      <section className="landing-hero">
        <Logo />
        <h1>Travel insurance claims, handled with care</h1>
        <p className="lead">
          Customers make a claim in a few minutes. Our AI agent checks it against your policy, and a
          person signs off anything large.
        </p>
        <TravelIllustration />
      </section>
      <section className="landing-form panel" aria-labelledby={`${ids}-title`}>
        <h2 id={`${ids}-title`}>Sign in</h2>
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
          noValidate
        >
          <fieldset className="role-cards">
            <legend>Who are you?</legend>
            {ROLES.map(({ role: value, title, hint, Icon }) => (
              <label key={value} className={`role-card${role === value ? " chosen" : ""}`}>
                <input
                  type="radio"
                  name={`${ids}-role`}
                  value={value}
                  checked={role === value}
                  onChange={() => {
                    setRole(value);
                    setEmail("");
                    setError(null);
                  }}
                />
                <Icon size={24} strokeWidth={2} aria-hidden="true" />
                <span>
                  <span className="role-title">{title}</span>
                  <span className="role-hint">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {people.length > 0 && (
            <fieldset className="person-cards">
              <legend>{role === "handler" ? "Choose a handler" : "Choose a customer"}</legend>
              {people.map((person) => (
                <label
                  key={person.email}
                  className={`person-card${email === person.email ? " chosen" : ""}`}
                >
                  <input
                    type="radio"
                    name={`${ids}-person`}
                    value={person.email}
                    checked={email === person.email}
                    onChange={() => {
                      setEmail(person.email);
                    }}
                  />
                  <span className="person-name">{person.name}</span>
                  <span className="person-note">{person.note}</span>
                </label>
              ))}
            </fieldset>
          )}
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
          <label htmlFor={`${ids}-password`}>Password</label>
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
      </section>
    </main>
  );
}
