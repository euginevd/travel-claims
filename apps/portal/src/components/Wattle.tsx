import { Plus, Send, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** Wattle AI's mark: a wattle sprig with coral blossoms on ink, the same in every UnderCover
    app. The blossoms swell in turn only while Wattle is working. */
export function WattleMark({ size = 20, working = false }: { size?: number; working?: boolean }) {
  const id = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`wattle-mark${working ? " working" : ""}`}
    >
      <defs>
        <radialGradient id={`${id}-ink`} cx="0.3" cy="0" r="1.1">
          <stop offset="0" stopColor="#4a4844" />
          <stop offset="0.5" stopColor="#262522" />
          <stop offset="1" stopColor="#171614" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="12" fill={`url(#${id}-ink)`} />
      <path
        d="M6.2 18.6 C8.6 14 12.4 10.2 18.4 6.4"
        fill="none"
        stroke="#f4f3f0"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M9.3 14.2 L7.6 11.6 M12.2 11.1 L14.6 13.4 M14.9 8.9 L13.6 6.4"
        fill="none"
        stroke="#f4f3f0"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <g fill="#ec8a70">
        <circle className="b b1" cx="7.1" cy="10.6" r="2.3" />
        <circle className="b b2" cx="15.4" cy="14.3" r="2" />
        <circle className="b b3" cx="13.2" cy="5.5" r="1.7" />
        <circle className="b b4" cx="18.6" cy="6.3" r="1.2" />
      </g>
    </svg>
  );
}

/** The header button that opens Wattle AI. */
export function WattleButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="wattle-pill" aria-label="Ask Wattle AI" onClick={onClick}>
      <WattleMark size={20} />
      <span className="wattle-pill-label">Ask Wattle</span>
      <span className="wattle-ai-tag">AI</span>
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
  headline?: string;
  points?: { text: string; source: number }[];
  next?: string;
  /** Checked against the policy wording's rules by Automated Reasoning (on AWS). */
  verified?: boolean;
}

interface WattleProps {
  ask: (question: string, history: WattleTurn[]) => Promise<WattleAnswer>;
  scope: string;
  starters: string[];
  placeholder?: string;
  /** What the page is about, shown under the header ("About CLM-1903"). */
  context?: string;
  onClose: () => void;
  /** What to show under an answer, given the question it answered. */
  extra?: (answer: WattleAnswer, question: string) => ReactNode;
}

interface Message extends WattleTurn {
  answer?: WattleAnswer;
}

/** A point's text with its **bold** figures as <strong>: split as text, never parsed as HTML. */
export function bolded(text: string): ReactNode[] {
  return text
    .split("**")
    .map((part, i) => (i % 2 === 1 ? <strong key={String(i)}>{part}</strong> : part));
}

/** An answer as Wattle lays it out: a one-sentence headline, then short points, each citing
 * one of the sources by its number. */
function LaidOut({ answer }: { answer: WattleAnswer }) {
  return (
    <>
      <p className="wattle-headline" dir="auto">
        {answer.headline}
      </p>
      {answer.points && answer.points.length > 0 && (
        <ul className="wattle-points">
          {answer.points.map((point, i) => {
            const source = answer.sources[point.source - 1];
            return (
              <li key={String(i)} dir="auto">
                {bolded(point.text)}
                {source && (
                  <span className="wattle-cite" title={source} aria-label={`Source: ${source}`}>
                    {point.source}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

export const WATTLE_FOOTER =
  "AI powered · cites its sources · a claims expert makes the final call";

/** Wattle AI's side panel: one look in every app, with questions and data scoped to who is
 * signed in and which page they're on. */
export function WattlePanel({
  ask,
  scope,
  starters,
  placeholder,
  context,
  onClose,
  extra,
}: WattleProps) {
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
          <WattleMark size={22} working={busy} /> Ask Wattle AI
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
      {context && (
        <p className="wattle-context">
          <WattleMark size={14} /> About <b>{context}</b>
        </p>
      )}
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
            {message.answer?.headline ? (
              <LaidOut answer={message.answer} />
            ) : (
              <p dir="auto">{message.text}</p>
            )}
            {message.answer && message.answer.sources.length > 0 && (
              <ol className="wattle-sources" aria-label="Sources">
                {message.answer.sources.map((source) => (
                  <li key={source}>{source}</li>
                ))}
              </ol>
            )}
            {message.answer && extra?.(message.answer, messages[index - 1]?.text ?? "")}
            {message.answer?.next && index === messages.length - 1 && !busy && (
              <p className="wattle-next-q">
                <span>Next</span>
                <button
                  type="button"
                  onClick={() => {
                    void send(message.answer?.next ?? "");
                  }}
                >
                  {message.answer.next}
                </button>
              </p>
            )}
          </div>
        ))}
        {busy && (
          <p className="wattle-msg assistant wattle-thinking" role="status">
            <WattleMark size={16} working /> Looking that up…
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
