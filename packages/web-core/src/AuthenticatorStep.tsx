import { useEffect, useRef, type ReactNode } from "react";
import type { CognitoChallenge } from "./cognito";

// The sign-in step after the password when the staff pool asks for MFA: a code from an
// authenticator app, and the first time, the key to add the account to one. The page's own
// form wraps it, so it keeps the page's fields, submit button and error styles.
interface AuthenticatorStepProps {
  challenge: CognitoChallenge;
  /** A prefix for the step's element ids, unique on the page. */
  idPrefix: string;
  code: string;
  onCode: (code: string) => void;
  error: string | null;
  busy: boolean;
  /** The page's primary button, of type submit. */
  submit: ReactNode;
  onRestart: () => void;
}

/** A code as typed or pasted, as Cognito wants it: six digits, or null. */
export function authenticatorCode(typed: string): string | null {
  const digits = typed.replace(/\s/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

export const CODE_PROMPT = "Enter the 6-digit code from your authenticator app.";

export function AuthenticatorStep({
  challenge,
  idPrefix,
  code,
  onCode,
  error,
  busy,
  submit,
  onRestart,
}: AuthenticatorStepProps) {
  const field = useRef<HTMLInputElement>(null);
  const setup = challenge.kind === "mfa-setup";

  // The step replaces the password fields, so focus moves to the one thing to do next.
  useEffect(() => {
    field.current?.focus();
  }, [challenge]);

  return (
    <>
      <h2 id={`${idPrefix}-title`}>
        {setup ? "Add an authenticator app" : "Enter your authenticator code"}
      </h2>
      <p className="signin-sub">
        {setup
          ? "Your account now needs a code at sign-in. Add it to an authenticator app with the key below, then enter the code the app shows."
          : `Open your authenticator app and enter the code for ${challenge.label}.`}
      </p>
      {setup && (
        <dl className="mfa-key">
          <dt>Setup key</dt>
          <dd>
            <code>{challenge.secret}</code>
          </dd>
          <dt>Or the full link, for apps that take one</dt>
          <dd>
            <code className="mfa-uri">{challenge.uri}</code>
          </dd>
        </dl>
      )}
      <div className="float-field">
        <input
          ref={field}
          id={`${idPrefix}-code`}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder=" "
          aria-describedby={error ? `${idPrefix}-error` : undefined}
          value={code}
          onChange={(event) => {
            onCode(event.target.value);
          }}
        />
        <label htmlFor={`${idPrefix}-code`}>6-digit code</label>
      </div>
      {error && (
        <p id={`${idPrefix}-error`} className="field-error" role="alert">
          {error}
        </p>
      )}
      {submit}
      <p className="signin-meta">
        <button type="button" className="link-button" disabled={busy} onClick={onRestart}>
          Use a different account
        </button>
      </p>
    </>
  );
}
