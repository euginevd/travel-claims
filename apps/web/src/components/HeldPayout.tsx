import { useId, useState, type SubmitEvent } from "react";
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

export function HeldPayout({ claim, handler, onSignOff, onSendBack }: HeldPayoutProps) {
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(
    handler.can_approve_over_limit ? null : CANNOT,
  );
  const [busy, setBusy] = useState(false);
  const ids = useId();
  const payout = claim.decision?.payout ?? 0;
  const blocked = refusal !== null;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 403) setRefusal(caught.message);
      else setError(messageOf(caught));
    } finally {
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
    <section className="panel held" aria-labelledby={`${ids}-heading`}>
      <h2 id={`${ids}-heading`}>Waiting for sign-off</h2>
      <p>
        The agent approved {dollars(payout)}, over the {dollars(claim.approval_limit)} approval
        limit, so nothing is paid until a senior handler signs it off.
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
        type="button"
        className="button"
        disabled={blocked || busy}
        aria-describedby={refusal ? `${ids}-refusal` : undefined}
        onClick={() => {
          void run(onSignOff);
        }}
      >
        Sign off and pay {dollars(payout)}
      </button>
      <form
        className="send-back"
        noValidate
        onSubmit={sendBack}
        aria-describedby={refusal ? `${ids}-refusal` : undefined}
      >
        <label htmlFor={`${ids}-note`}>Or send it back to the agent with a note</label>
        <textarea
          id={`${ids}-note`}
          rows={4}
          value={note}
          disabled={blocked}
          aria-invalid={noteError !== null}
          aria-describedby={`${ids}-count${noteError ? ` ${ids}-note-error` : ""}`}
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
        <button type="submit" className="button secondary" disabled={blocked || busy}>
          Send back
        </button>
      </form>
    </section>
  );
}
