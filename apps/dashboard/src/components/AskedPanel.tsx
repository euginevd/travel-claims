import { CircleCheck, CircleDashed, Send } from "lucide-react";
import { useId, useState } from "react";
import { ApiError, type Api, type Claim } from "../api";
import { when } from "../format";

interface AskedPanelProps {
  api: Api;
  claim: Claim;
  onUpdated: (claim: Claim) => void;
}

/** What we've asked the customer for, whether they've sent it, and a way to ask for more.
 * The customer sees each request on their claim, with its own upload, and is emailed and texted. */
export function AskedPanel({ api, claim, onUpdated }: AskedPanelProps) {
  const id = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await api.askCustomer(claim.claim_id, text.trim()));
      setText("");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We couldn't send that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel asked" aria-labelledby={`${id}-title`}>
      <div className="panel-head">
        <h2 id={`${id}-title`}>Asked the customer</h2>
        <span className="muted small">they see each request on their claim</span>
      </div>
      {claim.requests.length === 0 ? (
        <p className="muted small">Nothing asked yet.</p>
      ) : (
        <ul className="asked-list">
          {claim.requests.map((request) => (
            <li key={request.request_id} className={request.fulfilled_at ? "done" : ""}>
              {request.fulfilled_at ? (
                <CircleCheck size={16} strokeWidth={1.75} aria-label="Sent" />
              ) : (
                <CircleDashed size={16} strokeWidth={1.75} aria-label="Waiting" />
              )}
              <span dir="auto">{request.text}</span>
              <span className="muted small">
                {request.fulfilled_at
                  ? `${String(request.files)} file${request.files === 1 ? "" : "s"}, ${when(request.fulfilled_at)}`
                  : `${request.asked_by}, ${when(request.asked_at)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="asked-form"
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <label htmlFor={`${id}-text`} className="visually-hidden">
          Ask the customer for
        </label>
        <input
          id={`${id}-text`}
          placeholder="Ask for a document, e.g. a copy of the police report"
          maxLength={300}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <button
          type="submit"
          className="button secondary small-button"
          disabled={busy || text.trim().length < 3}
        >
          <Send size={14} strokeWidth={1.75} aria-hidden="true" />
          {busy ? "Asking…" : "Ask"}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
