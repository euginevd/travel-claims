import { Plus, Send, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** Wattle AI's mark: a golden wattle puff on green, the same in every UnderCover app. */
export function WattleMark({ size = 20 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="wattle-mark">
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffc93c" />
          <stop offset="1" stopColor="#2f7d4a" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill={`url(#${id}-g)`} />
      <g fill="#fff6c9">
        <circle cx="16" cy="11" r="3.4" />
        <circle cx="11" cy="17" r="3" />
        <circle cx="21" cy="17" r="3" />
        <circle cx="16" cy="21.5" r="2.6" />
      </g>
      <path d="M24.5 5.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" fill="#fff" />
    </svg>
  );
}

/** The header button that opens Wattle AI. */
export function WattleButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="wattle-pill" onClick={onClick}>
      <WattleMark size={18} />
      Wattle AI
    </button>
  );
}

export const PROJECT_URL: string =
  // `||`, not `??`: the images build passes an empty string when it's unset.
  import.meta.env.VITE_PROJECT_URL ||
  `${window.location.protocol}//${window.location.hostname}:5172/`;

/** Back to the UnderCover project page. */
export function ProjectLink() {
  return (
    <a className="project-link" href={PROJECT_URL}>
      <span aria-hidden="true">←</span> Project
    </a>
  );
}

export interface WattleTurn {
  role: "user" | "assistant";
  text: string;
}

export interface WattleAnswer {
  answer: string;
  sources: string[];
  suggest: string;
  screened: boolean;
}

interface WattleProps {
  ask: (question: string, history: WattleTurn[]) => Promise<WattleAnswer>;
  scope: string;
  starters: string[];
  placeholder?: string;
  onClose: () => void;
  extra?: (answer: WattleAnswer) => ReactNode;
}

interface Message extends WattleTurn {
  answer?: WattleAnswer;
}

export const WATTLE_FOOTER =
  "AI powered · cites its sources · a claims expert makes the final call";

/** Wattle AI's side panel: one look in every app, with questions and data scoped to who is
 * signed in and which page they're on. */
export function WattlePanel({ ask, scope, starters, placeholder, onClose, extra }: WattleProps) {
  const id = useId();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    if (typeof end.current?.scrollIntoView === "function") {
      end.current.scrollIntoView({ block: "end" });
    }
  }, [messages, busy]);

  async function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    const history = messages.map(({ role, text: said }) => ({ role, text: said }));
    setMessages([...messages, { role: "user", text: trimmed }]);
    setText("");
    setBusy(true);
    setError(null);
    try {
      const answer = await ask(trimmed, history);
      setMessages((now) => [...now, { role: "assistant", text: answer.answer, answer }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Wattle AI is not available.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="wattle-panel" aria-labelledby={`${id}-title`}>
      <header className="wattle-head">
        <h2 id={`${id}-title`}>
          <WattleMark size={22} /> Ask Wattle AI
        </h2>
        <button
          type="button"
          className="wattle-icon"
          aria-label="New conversation"
          onClick={() => {
            setMessages([]);
            setError(null);
          }}
        >
          <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="wattle-icon"
          aria-label="Close Wattle AI"
          onClick={onClose}
        >
          <X size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </header>
      <div className="wattle-body" aria-live="polite">
        {messages.length === 0 && (
          <div className="wattle-hero">
            <WattleMark size={64} />
            <h3>Ask Wattle AI anything</h3>
            <p>{scope}</p>
            <ul className="wattle-chips">
              {starters.map((starter) => (
                <li key={starter}>
                  <button
                    type="button"
                    onClick={() => {
                      void send(starter);
                    }}
                  >
                    {starter}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {messages.map((message, index) => (
          <div key={String(index)} className={`wattle-msg ${message.role}`}>
            <p dir="auto">{message.text}</p>
            {message.answer && message.answer.sources.length > 0 && (
              <ul className="wattle-sources" aria-label="Sources">
                {message.answer.sources.map((source) => (
                  <li key={source}>{source}</li>
                ))}
              </ul>
            )}
            {message.answer && extra?.(message.answer)}
          </div>
        ))}
        {busy && (
          <p className="wattle-msg assistant wattle-thinking" role="status">
            <WattleMark size={16} /> Looking that up…
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
        className="wattle-form"
        onSubmit={(event) => {
          event.preventDefault();
          void send(text);
        }}
      >
        <label htmlFor={`${id}-q`} className="visually-hidden">
          Your question
        </label>
        <input
          id={`${id}-q`}
          placeholder={placeholder ?? "Ask anything…"}
          maxLength={500}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <button type="submit" className="wattle-send" disabled={busy || !text.trim()}>
          <Send size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className="visually-hidden">Ask</span>
        </button>
      </form>
      <p className="wattle-foot">
        <WattleMark size={14} /> {WATTLE_FOOTER}
      </p>
    </aside>
  );
}
