import { CircleCheck, CircleX, ShieldAlert, TriangleAlert, UserRoundPen } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { ApiError, type Api, type Check, type Claim } from "../api";
import { dollars } from "../format";
import { sorted } from "./Checklist";
import { needsYou } from "./NeedsYou";
import { WattleMark } from "./Wattle";

const ICONS = { pass: CircleCheck, warn: TriangleAlert, fail: CircleX } as const;
const LABELS = { pass: "Passed", warn: "Warning", fail: "Failed" } as const;
// What a request to the customer may hold, as the api accepts.
const REQUEST_LIMIT = 300;

const firstName = (name: string) => name.split(/\s+/)[0] ?? name;

/** The request the agent's checks point to: what to ask the customer for, drafted in code from
 * the check that failed, for the handler to edit before it's sent. */
export function draftRequest(claim: Claim): { title: string; text: string } {
  const name = firstName(claim.customer_name);
  const failed = claim.decision?.checklist.find((check) => check.result === "fail");
  const end = "We'll finish your claim as soon as it arrives.";
  if (failed && /receipt/i.test(`${failed.label} ${failed.source}`)) {
    return {
      title: `Ask ${name} for a clearer copy of the receipt`,
      text: `Hi ${name}, thanks for your claim. We couldn't read the receipt you sent. Could you send a clearer photo, or the PDF from the business? ${end}`,
    };
  }
  if (failed) {
    const need = (failed.detail || failed.label).replace(/[.!?]$/, "");
    const text = `Hi ${name}, thanks for your claim. To finish it we need one more thing: ${need}. Could you send it to us? ${end}`;
    return {
      title: `Ask ${name} about: ${failed.label.toLowerCase()}`,
      text: text.slice(0, REQUEST_LIMIT),
    };
  }
  return {
    title: `Ask ${name} for what's missing`,
    text: `Hi ${name}, thanks for your claim. Could you send us any receipts or documents that show what happened and what it cost? ${end}`,
  };
}

/** The agent's suggested next step on a referral: a request to the customer, drafted, then
 * edited and sent by the handler. Once asked, what's still awaited. */
export function NextStep({
  api,
  claim,
  onUpdated,
}: {
  api: Api;
  claim: Claim;
  onUpdated: (claim: Claim, notice: string) => void;
}) {
  const id = useId();
  const draft = draftRequest(claim);
  const [text, setText] = useState(draft.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waiting = claim.requests.filter((request) => request.fulfilled_at === null);
  const name = firstName(claim.customer_name);
  if (waiting.length > 0) {
    return (
      <div className="next-step">
        <p>
          <b>Waiting on {name}.</b>{" "}
          <span className="muted">
            Asked: &ldquo;{waiting[0]?.text}&rdquo; It comes back here once they send it.
          </span>
        </p>
      </div>
    );
  }
  return (
    <form
      className="next-step"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        api.askCustomer(claim.claim_id, text.trim()).then(
          (updated) => {
            setBusy(false);
            onUpdated(updated, `Sent to ${name}. The claim waits on their reply.`);
          },
          (caught: unknown) => {
            setBusy(false);
            setError(caught instanceof ApiError ? caught.message : "We couldn't send that.");
          },
        );
      }}
    >
      <label htmlFor={`${id}-text`}>
        The agent&apos;s next step: {draft.title.replace(/^Ask/, "ask")}
      </label>
      <textarea
        id={`${id}-text`}
        rows={3}
        maxLength={REQUEST_LIMIT}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      <div className="next-step-actions">
        <button type="submit" className="button" disabled={busy || text.trim().length < 3}>
          {busy ? "Sending…" : `Send to ${name}`}
        </button>
        <span className="muted small">
          Drafted from the agent&apos;s checks · edit it first if you like · {name} sees it on their
          claim
        </span>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** The agent's checks, failures first, each with its source. */
export function ChecksSummary({ checks }: { checks: Check[] }) {
  if (checks.length === 0) return null;
  const passed = checks.filter((check) => check.result === "pass").length;
  return (
    <div className="verdict-checks">
      <h3>
        {passed} of {checks.length} checks passed
      </h3>
      <ul>
        {sorted(checks).map((check, index) => {
          const Icon = ICONS[check.result];
          return (
            <li key={index} className={`check-${check.result}`}>
              <Icon size={15} strokeWidth={1.75} aria-label={LABELS[check.result]} />
              <span>
                {check.label}
                {check.source && <span className="source-chip">{check.source}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Who the conclusion is from: the agent, the hidden-instruction check or a person. */
function ByLine({ claim }: { claim: Claim }) {
  const decision = claim.decision;
  if (decision?.override) {
    return (
      <p className="verdict-by">
        <UserRoundPen size={15} strokeWidth={1.75} aria-hidden="true" />
        Decided by {decision.override.by}
      </p>
    );
  }
  if (decision?.by_screening) {
    return (
      <p className="verdict-by">
        <ShieldAlert size={15} strokeWidth={1.75} aria-hidden="true" />
        The hidden-instruction check stopped this claim
      </p>
    );
  }
  return (
    <p className="verdict-by">
      <WattleMark size={18} />
      UnderCover Agent
    </p>
  );
}

/** The headline: what this claim needs, or what was decided, in one line. */
export function headlineOf(claim: Claim, senior = true): string {
  const decision = claim.decision;
  const name = firstName(claim.customer_name);
  if (claim.stalled) return "The agent stopped working on this claim.";
  if (claim.status === "in_progress") return "The agent is working on this claim.";
  if (claim.status === "waiting" || claim.status === "sent_back") return "Ready for the agent.";
  if (!decision) return "Waiting for a person.";
  if (claim.status === "waiting_for_sign_off") {
    const held = needsYou(claim) ?? `Approve ${dollars(decision.payout)}.`;
    return senior ? held : held.replace("your sign-off", "a senior handler's sign-off");
  }
  if (claim.review_requested_at && !decision.override) {
    return `${name} asked for a person to review this.`;
  }
  if (decision.decision === "refer" && !decision.override) {
    const asked = claim.requests.length > 0;
    const allIn = asked && claim.requests.every((request) => request.fulfilled_at !== null);
    if (allIn) return `${name} sent what you asked for. Decide it now.`;
    return "Referred to you.";
  }
  if (decision.decision === "approve") {
    return `Approved ${dollars(decision.payout)}${claim.payment ? ", paid" : ""}.`;
  }
  return decision.decision === "decline" ? "Declined." : "Referred.";
}

/** The top of a claim: the conclusion, why, the checks, and the one thing to do now. */
export function Verdict({
  claim,
  senior = true,
  action,
  more,
}: {
  claim: Claim;
  senior?: boolean;
  action?: ReactNode;
  more?: ReactNode;
}) {
  const decision = claim.decision;
  const checks = decision?.checklist ?? [];
  return (
    <section
      className={`verdict${checks.length > 0 ? " has-checks" : ""}`}
      aria-labelledby="verdict-heading"
    >
      <div className="verdict-main">
        <ByLine claim={claim} />
        <h2 id="verdict-heading">{headlineOf(claim, senior)}</h2>
        {decision && (
          <p className="verdict-reason" dir="auto">
            {decision.reason}
          </p>
        )}
        {claim.review_note && claim.review_requested_at && (
          <p className="verdict-reason muted">
            {firstName(claim.customer_name)} said: &ldquo;{claim.review_note}&rdquo;
          </p>
        )}
        {action && <div className="verdict-action">{action}</div>}
        {more && <div className="verdict-more">{more}</div>}
      </div>
      {checks.length > 0 && <ChecksSummary checks={checks} />}
    </section>
  );
}
