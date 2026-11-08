import { AlertCircle, CheckCircle2, MessageSquarePlus, Search, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Conversation, ConversationSummary, CopilotApi, Entry, Pending } from "../copilot";
import { dollars } from "../format";
import { AiMark } from "./AiMark";

interface CopilotProps {
  copilot: CopilotApi;
  onClose: () => void;
}

const SUGGESTIONS = [
  "What needs me today?",
  "Which claims are waiting for sign-off?",
  "Why was CLM-1015 declined?",
];
const MESSAGE_LIMIT = 2000;

// The handlers' Copilot: a chat in a sidebar that acts as the signed-in handler. Each step it
// takes shows as a card, and a sign-off waits on a card until the handler confirms it.
export function Copilot({ copilot, onClose }: CopilotProps) {
  const [past, setPast] = useState<ConversationSummary[]>([]);
  const [current, setCurrent] = useState<Conversation | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
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
    copilot.list().then(setPast, () => {
      setPast([]);
    });
  }, [copilot]);

  useEffect(() => {
    if (typeof end.current?.scrollIntoView === "function") {
      end.current.scrollIntoView({ block: "end" });
    }
  }, [current]);

  async function act(work: () => Promise<Conversation>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      setCurrent(await work());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed) return;
    setText("");
    await act(async () => {
      const conversation = current ?? (await copilot.start());
      return copilot.send(conversation.conversation_id, trimmed);
    });
  }

  return (
    <aside className="copilot" aria-label="Copilot">
      <div className="copilot-head">
        <h2>
          Copilot <AiMark />
        </h2>
        <button
          type="button"
          className="icon-button"
          onClick={() => {
            setCurrent(null);
          }}
          aria-label="New conversation"
        >
          <MessageSquarePlus size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close Copilot">
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <div className="copilot-body" aria-live="polite">
        {!current && (
          <div className="copilot-start">
            <p>Ask about the queue, a claim or a customer. I act as you, with your access.</p>
            <ul className="suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    className="suggestion"
                    disabled={busy}
                    onClick={() => void ask(suggestion)}
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
            {past.length > 0 && (
              <>
                <h3>Earlier</h3>
                <ul className="copilot-past">
                  {past.slice(0, 5).map((item) => (
                    <li key={item.conversation_id}>
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => void act(() => copilot.open(item.conversation_id))}
                      >
                        {item.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        {current?.transcript.map((entry, index) => (
          <Bubble key={index} entry={entry} />
        ))}
        {current?.pending && (
          <ConfirmCard
            pending={current.pending}
            busy={busy}
            onAnswer={(answer) => {
              const id = current.conversation_id;
              void act(() => copilot.confirm(id, answer));
            }}
          />
        )}
        {busy && (
          <p className="copilot-thinking" role="status">
            Working on it…
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
        className="copilot-ask"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(text);
        }}
      >
        <label htmlFor="copilot-text" className="visually-hidden">
          Ask the Copilot
        </label>
        <textarea
          id="copilot-text"
          rows={2}
          maxLength={MESSAGE_LIMIT}
          value={text}
          disabled={busy || Boolean(current?.pending)}
          placeholder={current?.pending ? "Confirm or cancel the sign-off first" : "Ask anything…"}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void ask(text);
            }
          }}
        />
        <button
          type="submit"
          className="button"
          disabled={busy || !text.trim() || Boolean(current?.pending)}
        >
          <Send size={16} strokeWidth={2} aria-hidden="true" />
          Ask
        </button>
      </form>
    </aside>
  );
}

function Bubble({ entry }: { entry: Entry }) {
  if (entry.role) {
    return <p className={`bubble ${entry.role}`}>{entry.text}</p>;
  }
  if (entry.kind === "confirm") return null;
  const Icon =
    entry.kind === "error" ? AlertCircle : entry.kind === "action" ? CheckCircle2 : Search;
  return (
    <div className={`copilot-card ${entry.kind ?? "step"}`}>
      <Icon size={16} strokeWidth={2} aria-hidden="true" />
      <span>
        <strong>{entry.title}</strong>
        {entry.detail && <span className="muted"> · {entry.detail}</span>}
      </span>
    </div>
  );
}

function ConfirmCard({
  pending,
  busy,
  onAnswer,
}: {
  pending: Pending;
  busy: boolean;
  onAnswer: (answer: "sign_off" | "cancel") => void;
}) {
  return (
    <section className="copilot-confirm" aria-labelledby="confirm-title">
      <h3 id="confirm-title">Sign off {pending.claim_id}?</h3>
      <p>
        This pays <strong>{dollars(pending.amount)}</strong> to {pending.customer}.
      </p>
      {pending.detail && <p className="muted">Agent&apos;s reason: {pending.detail}</p>}
      <div className="actions">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => {
            onAnswer("sign_off");
          }}
        >
          Sign off and pay
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => {
            onAnswer("cancel");
          }}
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
