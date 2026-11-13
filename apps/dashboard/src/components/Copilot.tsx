import { AlertCircle, CheckCircle2, Plus, Search, Send, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  Answer,
  Conversation,
  ConversationSummary,
  CopilotApi,
  Entry,
  Pending,
} from "../copilot";
import { dollars } from "../format";
import { WATTLE_FOOTER, WattleMark } from "./Wattle";

interface CopilotProps {
  copilot: CopilotApi;
  onClose: () => void;
  starters?: string[];
}

const SUGGESTIONS = [
  "What needs me today?",
  "Are we meeting our success criteria?",
  "What does the policy say about delayed bags?",
];
const MESSAGE_LIMIT = 2000;

// Wattle AI for claims experts: a chat in a sidebar that acts as the signed-in handler. Each step it
// takes shows as a card, and anything that pays, spends or sends a decision back waits on a card
// until the handler confirms it.
export function Copilot({ copilot, onClose, starters = SUGGESTIONS }: CopilotProps) {
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
    <aside className="wattle-panel" aria-label="Wattle AI">
      <div className="wattle-head">
        <h2>
          <WattleMark size={22} /> Ask Wattle AI
        </h2>
        <button
          type="button"
          className="wattle-icon"
          onClick={() => {
            setCurrent(null);
          }}
          aria-label="New conversation"
        >
          <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="wattle-icon"
          onClick={onClose}
          aria-label="Close Wattle AI"
        >
          <X size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <div className="wattle-body" aria-live="polite">
        {!current && (
          <div className="wattle-hero">
            <WattleMark size={64} />
            <h3>Ask Wattle AI anything</h3>
            <p>
              Ask about the queue, a claim, a customer or the policy. It works with your access, and
              nothing is paid, sent back or dispatched until you confirm.
            </p>
            <ul className="wattle-chips">
              {starters.map((suggestion) => (
                <li key={suggestion}>
                  <button type="button" disabled={busy} onClick={() => void ask(suggestion)}>
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
          <Bubble
            key={index}
            entry={entry}
            onNext={
              index === current.transcript.length - 1 && !busy && !current.pending
                ? (question) => void ask(question)
                : undefined
            }
          />
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
        {current && !busy && !current.pending && current.model_calls > 0 && (
          <p className="copilot-turn">{turnLine(current)}</p>
        )}
        {busy && (
          <p className="copilot-thinking" role="status">
            <WattleMark size={16} working /> Working on it…
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
          void ask(text);
        }}
      >
        <label htmlFor="copilot-text" className="visually-hidden">
          Your question
        </label>
        <textarea
          id="copilot-text"
          rows={2}
          maxLength={MESSAGE_LIMIT}
          value={text}
          disabled={busy || Boolean(current?.pending)}
          placeholder={current?.pending ? "Confirm or cancel the card first" : "Ask anything…"}
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
          className="wattle-send"
          disabled={busy || !text.trim() || Boolean(current?.pending)}
        >
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

/** Wattle's answers mark what matters with **asterisks**; show those words in bold. Anything
    else stays plain text, so nothing in an answer is ever read as markup. */
export function emphasised(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*\n]+\*\*)/)
    .map((part, index) =>
      part.length > 4 && part.startsWith("**") && part.endsWith("**") ? (
        <strong key={String(index)}>{part.slice(2, -2)}</strong>
      ) : (
        part
      ),
    );
}

function Bubble({ entry, onNext }: { entry: Entry; onNext?: (question: string) => void }) {
  if (entry.role === "assistant" && entry.headline) {
    const sources = entry.sources ?? [];
    return (
      <div className="bubble assistant laid-out">
        <p className="wattle-headline">{entry.headline}</p>
        {entry.points && entry.points.length > 0 && (
          <ul className="wattle-points">
            {entry.points.map((point, i) => {
              const source = sources[point.source - 1];
              return (
                <li key={String(i)}>
                  {emphasised(point.text)}
                  {source && (
                    <span className="wattle-cite" title={source}>
                      {point.source}
                      <span className="visually-hidden">: {source}</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {sources.length > 0 && (
          <ol className="wattle-sources" aria-label="Sources">
            {sources.map((source) => (
              <li key={source}>{source}</li>
            ))}
          </ol>
        )}
        {entry.next && onNext && (
          <p className="wattle-next-q">
            <span>Next</span>
            <button
              type="button"
              onClick={() => {
                onNext(entry.next ?? "");
              }}
            >
              {entry.next}
            </button>
          </p>
        )}
      </div>
    );
  }
  if (entry.role) {
    return (
      <p className={`bubble ${entry.role}`}>
        {entry.role === "assistant" ? emphasised(entry.text ?? "") : entry.text}
      </p>
    );
  }
  if (entry.kind === "confirm") return null;
  const Icon =
    entry.kind === "error" ? AlertCircle : entry.kind === "action" ? CheckCircle2 : Search;
  return (
    <div className={`copilot-card ${entry.kind ?? "step"}`}>
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>
        <strong>{entry.title}</strong>
        {entry.detail && <span className="muted"> · {entry.detail}</span>}
      </span>
    </div>
  );
}

/** What the last answer took, in a quiet line: "3 steps · 4.2 s · $0.012". */
export function turnLine(turn: Pick<Conversation, "steps" | "seconds" | "cost_usd">): string {
  const steps = `${String(turn.steps)} ${turn.steps === 1 ? "step" : "steps"}`;
  return `${steps} · ${turn.seconds.toFixed(1)} s · $${turn.cost_usd.toFixed(3)}`;
}

/** What a card asks, what going ahead does, and the answer its button sends. */
function confirmText(pending: Pending): {
  title: string;
  body: ReactNode;
  button: string;
  answer: Answer;
} {
  const claim = pending.claim_id ?? "the claim";
  if (pending.action === "dispatch") {
    const agents = pending.agents ?? 0;
    const waiting = pending.waiting ?? 0;
    return {
      title: "Start a dispatch?",
      body: (
        <>
          This sends{" "}
          <strong>
            {agents} claim {agents === 1 ? "agent" : "agents"}
          </strong>{" "}
          through the {waiting} {waiting === 1 ? "claim" : "claims"} waiting now. Each claim worked
          costs money.
        </>
      ),
      button: "Start the dispatch",
      answer: "confirm",
    };
  }
  if (pending.action === "send_back") {
    return {
      title: `Send ${claim} back?`,
      body: (
        <>
          This sends {pending.customer ? `${pending.customer}’s` : "the"} held decision back to the
          agent to decide again. Nothing is paid.
        </>
      ),
      button: "Send back",
      answer: "confirm",
    };
  }
  return {
    title: `Sign off ${claim}?`,
    body: (
      <>
        This pays <strong>{dollars(pending.amount ?? 0)}</strong> to {pending.customer}.
      </>
    ),
    button: "Sign off and pay",
    answer: "sign_off",
  };
}

function ConfirmCard({
  pending,
  busy,
  onAnswer,
}: {
  pending: Pending;
  busy: boolean;
  onAnswer: (answer: Answer) => void;
}) {
  const text = confirmText(pending);
  return (
    <section className="copilot-confirm" aria-labelledby="confirm-title">
      <h3 id="confirm-title">{text.title}</h3>
      <p>{text.body}</p>
      {pending.action === "sign_off" && pending.detail && (
        <p className="muted">Agent&apos;s reason: {pending.detail}</p>
      )}
      {pending.action === "send_back" && pending.note && (
        <p className="muted">Your note: {pending.note}</p>
      )}
      <div className="actions">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => {
            onAnswer(text.answer);
          }}
        >
          {text.button}
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
