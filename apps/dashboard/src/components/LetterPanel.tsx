import { Mail, Send, Sparkle } from "lucide-react";
import { useId, useState } from "react";
import { ApiError, type Api, type Claim } from "../api";
import { when } from "../format";

/** The customer's letter about an approval or a decline: the AI drafts it, the handler edits
 * and sends it, and it reaches the customer's claim and their Updates. */
export function LetterPanel({
  api,
  claim,
  onUpdated,
}: {
  api: Api;
  claim: Claim;
  onUpdated: (claim: Claim) => void;
}) {
  const id = useId();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [byAi, setByAi] = useState(false);
  const [busy, setBusy] = useState<"draft" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);

  async function draft() {
    setBusy("draft");
    setError(null);
    try {
      const found = await api.draftLetter(claim.claim_id);
      setSubject(found.subject);
      setBody(found.body);
      setByAi(true);
      setWriting(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The assistant couldn't help.");
      setWriting(true);
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    setBusy("send");
    setError(null);
    try {
      onUpdated(
        await api.sendLetter(claim.claim_id, {
          subject: subject.trim(),
          body: body.trim(),
          drafted_by_ai: byAi,
        }),
      );
      setWriting(false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We couldn't send that.");
    } finally {
      setBusy(null);
    }
  }

  const sent = claim.letter;
  return (
    <section className="panel letter" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>
        <Mail size={16} strokeWidth={1.75} aria-hidden="true" /> Letter to the customer
      </h2>
      {sent && !writing && (
        <div className="letter-sent">
          <p className="muted small">
            Sent by {sent.sent_by}, {when(sent.sent_at)}
            {sent.drafted_by_ai ? " · drafted with AI" : ""}
          </p>
          <p className="letter-subject">{sent.subject}</p>
          <p className="letter-body" dir="auto">
            {sent.body}
          </p>
        </div>
      )}
      {!writing && (
        <div className="actions">
          <button
            type="button"
            className="button secondary small-button"
            disabled={busy !== null}
            onClick={() => {
              void draft();
            }}
          >
            <Sparkle size={14} strokeWidth={1.75} aria-hidden="true" />
            {busy === "draft" ? "Drafting…" : sent ? "Draft a new letter with AI" : "Draft with AI"}
          </button>
          <button
            type="button"
            className="link-button small"
            disabled={busy !== null}
            onClick={() => {
              setByAi(false);
              setWriting(true);
            }}
          >
            Write it myself
          </button>
        </div>
      )}
      {writing && (
        <form
          className="letter-form"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          {byAi && (
            <p className="muted small">
              <Sparkle size={12} strokeWidth={1.75} aria-hidden="true" /> Drafted with AI: check it
              before you send it.
            </p>
          )}
          <label htmlFor={`${id}-subject`}>Subject</label>
          <input
            id={`${id}-subject`}
            maxLength={200}
            value={subject}
            onChange={(event) => {
              setSubject(event.target.value);
            }}
          />
          <label htmlFor={`${id}-body`}>Letter</label>
          <textarea
            id={`${id}-body`}
            rows={8}
            maxLength={4000}
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
            }}
          />
          <div className="actions">
            <button
              type="submit"
              className="button small-button"
              disabled={busy !== null || !subject.trim() || !body.trim()}
            >
              <Send size={14} strokeWidth={1.75} aria-hidden="true" />
              {busy === "send" ? "Sending…" : "Send to the customer"}
            </button>
            <button
              type="button"
              className="link-button small"
              onClick={() => {
                setWriting(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
