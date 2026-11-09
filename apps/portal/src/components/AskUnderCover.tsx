import { MessageCircle, Send, Sparkle, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ApiError, type Answer, type Api, type AskTurn } from "../api";
import { MY_CLAIMS_HREF, NEW_CLAIM_HREF } from "../useHashRoute";

interface Message extends AskTurn {
  answer?: Answer;
}

const STARTERS = [
  "Am I covered if my flight is delayed?",
  "What's my excess?",
  "Where is my latest claim up to?",
];

/** Ask UnderCover: questions about the customer's own policy and claims, answered from their
 * policy wording and records. It explains and cites, and never promises cover or payment. */
export function AskUnderCover({ api }: { api: Api }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof end.current?.scrollIntoView === "function") {
      end.current.scrollIntoView({ block: "end" });
    }
  }, [messages, busy]);

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    const history: AskTurn[] = messages.map(({ role, text: said }) => ({ role, text: said }));
    setMessages([...messages, { role: "user", text: trimmed }]);
    setText("");
    setBusy(true);
    setError(null);
    try {
      const answer = await api.ask(trimmed, history);
      setMessages((now) => [...now, { role: "assistant", text: answer.answer, answer }]);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The assistant isn't available.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="ask-fab"
        onClick={() => {
          setOpen(true);
        }}
      >
        <MessageCircle size={20} strokeWidth={2} aria-hidden="true" />
        Ask UnderCover
      </button>
    );
  }

  return (
    <aside className="ask-panel" aria-labelledby={`${id}-title`}>
      <header className="ask-head">
        <h2 id={`${id}-title`}>
          <Sparkle size={16} strokeWidth={2} aria-hidden="true" /> Ask UnderCover
        </h2>
        <button
          type="button"
          className="ask-close"
          aria-label="Close Ask UnderCover"
          onClick={() => {
            setOpen(false);
          }}
        >
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>
      <div className="ask-body" aria-live="polite">
        {messages.length === 0 && (
          <>
            <p className="muted small">
              Ask about your policy or your claims. Answers come from your policy wording and your
              own records, and an AI assistant writes them. Only a decision on a claim can say what
              is paid.
            </p>
            <ul className="ask-starters">
              {STARTERS.map((starter) => (
                <li key={starter}>
                  <button
                    type="button"
                    onClick={() => {
                      void ask(starter);
                    }}
                  >
                    {starter}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {messages.map((message, index) => (
          <div key={String(index)} className={`ask-msg ask-${message.role}`}>
            <p dir="auto">{message.text}</p>
            {message.answer && message.answer.sources.length > 0 && (
              <p className="ask-sources small">From: {message.answer.sources.join(", ")}</p>
            )}
            {message.answer?.suggest === "start_claim" && (
              <a className="button small-button" href={NEW_CLAIM_HREF}>
                Start a claim
              </a>
            )}
            {message.answer?.suggest === "ask_person" && (
              <a className="button secondary small-button" href={MY_CLAIMS_HREF}>
                Ask a person from your claim
              </a>
            )}
          </div>
        ))}
        {busy && (
          <p className="ask-msg ask-assistant muted" role="status">
            Looking that up…
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div ref={end} />
      </div>
      <form
        className="ask-form"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(text);
        }}
      >
        <label htmlFor={`${id}-q`} className="visually-hidden">
          Your question
        </label>
        <input
          id={`${id}-q`}
          placeholder="Ask about your policy or claims"
          maxLength={500}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <button type="submit" className="button small-button" disabled={busy || !text.trim()}>
          <Send size={14} strokeWidth={2} aria-hidden="true" />
          <span className="visually-hidden">Ask</span>
        </button>
      </form>
    </aside>
  );
}
