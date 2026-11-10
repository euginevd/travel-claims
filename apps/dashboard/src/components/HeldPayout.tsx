import { BadgeCheck, Lock } from "lucide-react";
import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import { ApiError, NOTE_LIMIT, type Claim, type Handler } from "../api";
import { dollars } from "../format";

interface HeldPayoutProps {
  claim: Claim;
  handler: Handler;
  onSignOff: () => Promise<void>;
  onSendBack: (note: string) => Promise<void>;
}

const CANNOT =
  "Only a handler who can sign off over the approval limit can sign off or send back this claim.";

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

interface ConfirmProps {
  claim: Claim;
  handler: Handler;
  payout: number;
  onCancel: () => void;
  onConfirm: () => void;
}

/** The last look before money moves: who is paid, how much, on which claim, and who signs. */
function ConfirmSignOff({ claim, handler, payout, onCancel, onConfirm }: ConfirmProps) {
  const box = useRef<HTMLDialogElement>(null);
  const ids = useId();

  useEffect(() => {
    const dialog = box.current;
    if (!dialog) return;
    // A modal where the browser has one; shown in place where it doesn't (as in tests).
    if ("showModal" in dialog) dialog.showModal();
    else (dialog as HTMLElement).setAttribute("open", "");
  }, []);

  return (
    <dialog
      ref={box}
      className="confirm"
      aria-labelledby={`${ids}-title`}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id={`${ids}-title`}>Sign off and pay {dollars(payout)}?</h2>
      <p className="muted">
        This pays {claim.customer_name} straight away. It can&apos;t be undone from here.
      </p>
      {/* TODO: show where the money goes (the PayID) once the claim carries it before payment. */}
      <dl className="confirm-facts">
        <div>
          <dt>Payee</dt>
          <dd>{claim.customer_name}</dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd className="number">{dollars(payout)}</dd>
        </div>
        <div>
          <dt>Claim</dt>
          <dd className="mono">{claim.claim_id}</dd>
        </div>
        <div>
          <dt>Signed off by</dt>
          <dd>
            {handler.name}, {handler.role}
          </dd>
        </div>
      </dl>
      <div className="confirm-actions">
        <button type="button" className="button secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button" onClick={onConfirm}>
          Pay {dollars(payout)}
        </button>
      </div>
    </dialog>
  );
}

/** A payout over the approval limit, waiting for a senior handler: sign it off (after a
 * confirm) or send it back to the agent with a note. */
export function HeldPayout({ claim, handler, onSignOff, onSendBack }: HeldPayoutProps) {
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(
    handler.can_approve_over_limit ? null : CANNOT,
  );
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Set at once on the first click, before React re-renders, so a double click acts once.
  const inFlight = useRef(false);
  const signOff = useRef<HTMLButtonElement>(null);
  const ids = useId();
  const payout = claim.decision?.payout ?? 0;
  const blocked = refusal !== null;

  async function run(action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 403) setRefusal(caught.message);
      else setError(messageOf(caught));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function sendBack(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = note.trim();
    if (!trimmed) {
      setNoteError("Write a note saying what the agent should look at again.");
      return;
    }
    if (trimmed.length > NOTE_LIMIT) {
      setNoteError(`Keep the note to ${String(NOTE_LIMIT)} characters or fewer.`);
      return;
    }
    setNoteError(null);
    void run(() => onSendBack(trimmed));
  }

  return (
    <section className="held" aria-labelledby={`${ids}-heading`}>
      <h3 id={`${ids}-heading`}>Your sign-off</h3>
      <p className="limit-note">
        <Lock size={16} strokeWidth={1.75} aria-hidden="true" />
        <span>
          The agent approved {dollars(payout)}, over the {dollars(claim.approval_limit)} limit.
          Nothing is paid until a senior handler signs it off, however long it waits.
        </span>
      </p>
      <p className="checkpoint">
        Signing off pays {dollars(payout)} to {claim.customer_name} now.
      </p>
      {refusal && (
        <p id={`${ids}-refusal`} className="notice" role="status">
          {refusal}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        ref={signOff}
        type="button"
        className="button wide"
        data-shortcut="sign-off"
        disabled={blocked || busy}
        aria-describedby={refusal ? `${ids}-refusal` : undefined}
        aria-keyshortcuts="S"
        aria-haspopup="dialog"
        onClick={() => {
          setConfirming(true);
        }}
      >
        <BadgeCheck size={17} strokeWidth={1.75} aria-hidden="true" />
        Sign off and pay {dollars(payout)}
      </button>
      {confirming && (
        <ConfirmSignOff
          claim={claim}
          handler={handler}
          payout={payout}
          onCancel={() => {
            setConfirming(false);
            signOff.current?.focus();
          }}
          onConfirm={() => {
            setConfirming(false);
            void run(onSignOff);
          }}
        />
      )}
      <form className="send-back" noValidate onSubmit={sendBack}>
        <label htmlFor={`${ids}-note`}>Or send it back to the agent with a note</label>
        <textarea
          id={`${ids}-note`}
          data-shortcut="send-back"
          aria-keyshortcuts="B"
          rows={3}
          value={note}
          disabled={blocked || busy}
          aria-invalid={noteError !== null}
          aria-describedby={[
            `${ids}-count`,
            noteError ? `${ids}-note-error` : "",
            refusal ? `${ids}-refusal` : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
        <p id={`${ids}-count`} className={`muted small${note.length > NOTE_LIMIT ? " over" : ""}`}>
          {note.length} of {NOTE_LIMIT} characters
        </p>
        {noteError && (
          <p id={`${ids}-note-error`} className="error" role="alert">
            {noteError}
          </p>
        )}
        <button
          type="submit"
          className="button secondary"
          disabled={blocked || busy}
          aria-describedby={refusal ? `${ids}-refusal` : undefined}
        >
          Send back
        </button>
      </form>
    </section>
  );
}
