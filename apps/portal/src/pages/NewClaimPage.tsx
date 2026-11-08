import {
  CalendarX,
  Clock,
  HeartPulse,
  IdCard,
  Luggage,
  PlaneTakeoff,
  Plus,
  ShieldAlert,
  Sparkle,
  Trash2,
  type LucideIcon,
  MessageCircleQuestion,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { ApiError, type Api, type CaseChip, type Draft, type Policy } from "../api";
import { DayPicker } from "../components/DayPicker";
import { ReceiptPicker } from "../components/ReceiptPicker";
import { date, dollars } from "../format";
import { useFocusHeading } from "../useFocusHeading";
import { myClaimHref } from "../useHashRoute";

export const CLAIM_TYPES: Record<string, string> = {
  trip_cancellation: "Trip cancelled",
  trip_interruption: "Trip cut short",
  trip_delay: "Delayed travel",
  baggage_delay: "Bags arrived late",
  baggage: "Lost, stolen or damaged belongings",
  passport: "Lost or stolen passport",
  emergency_medical: "Medical emergency",
};

interface Tile {
  label: string;
  hint: string;
  claimType: string;
  Icon: LucideIcon;
}

// What happened, as large tiles: the customer taps one instead of typing.
export const CHIPS: Record<CaseChip, Tile> = {
  lost_bag: { label: "Lost bag", hint: "It never arrived", claimType: "baggage", Icon: Luggage },
  delayed_bag: {
    label: "Bag arrived late",
    hint: "Had to buy essentials",
    claimType: "baggage_delay",
    Icon: Clock,
  },
  flight_delay: {
    label: "Delayed flight",
    hint: "Hours waiting or a missed night",
    claimType: "trip_delay",
    Icon: PlaneTakeoff,
  },
  trip_cancelled: {
    label: "Trip cancelled",
    hint: "Couldn't go at all",
    claimType: "trip_cancellation",
    Icon: CalendarX,
  },
  medical: {
    label: "Medical",
    hint: "Doctor, hospital or dentist",
    claimType: "emergency_medical",
    Icon: HeartPulse,
  },
  stolen: {
    label: "Something stolen",
    hint: "Bag, phone or valuables",
    claimType: "baggage",
    Icon: ShieldAlert,
  },
  passport: {
    label: "Lost passport",
    hint: "Lost or stolen abroad",
    claimType: "passport",
    Icon: IdCard,
  },
  // No type up front: the assistant suggests one from the customer's words, or they pick it.
  other: {
    label: "Something else",
    hint: "Tell us in a sentence",
    claimType: "",
    Icon: MessageCircleQuestion,
  },
};
const TILE_ORDER: CaseChip[] = [
  "lost_bag",
  "delayed_bag",
  "flight_delay",
  "trip_cancelled",
  "medical",
  "stolen",
  "passport",
  "other",
];

const CATEGORIES: Record<string, string> = {
  accommodation: "Accommodation",
  meals: "Meals",
  transport: "Transport",
  rebooking: "Rebooking",
  medical: "Medical",
  luggage: "Luggage",
  clothing: "Clothing",
  toiletries: "Toiletries",
  electronics: "Electronics",
  personal_item: "Personal item",
  document_fees: "Document fees",
  trip_cost: "Trip cost",
  other: "Other",
};

interface Line {
  description: string;
  category: string;
  amount: string;
  source: string;
}

const BLANK: Line = { description: "", category: "other", amount: "", source: "" };
type Step = "what" | "receipts" | "check";

// Text written about the customer or the draft, never for them. The agent filters these too;
// this keeps them off the screen even if one slips through.
const NOTE =
  /\b(the customer|customer has|claimant|the user|draft|pending|not yet (described|provided|selected|given)|no (information|details) (was |were )?provided|unknown|n\/a)\b/i;
// Questions about fields the form already shows.
const ON_SCREEN =
  /\b(type of (claim|problem)|kind of (claim|problem)|what type|when did|what date|which date|where did|where were|what (city|country|place)|how much|amount|cost|item)\b/i;

/** Whether text reads as an assistant's internal note rather than the customer's own words. */
export function isNote(text: string): boolean {
  return NOTE.test(text);
}

const clean = (text: string | undefined) => (text && !isNote(text) ? text : "");

/** The claim to check, from the assistant's draft and the customer's own words and choice. */
export function fromDraft(draft: Draft | null, chip: CaseChip, words: string) {
  return {
    summary: clean(draft?.summary),
    // The customer's own words are the record; the assistant's story only fills a blank.
    story: words.trim() || clean(draft?.story),
    incidentDate: /^\d{4}-\d{2}-\d{2}$/.test(draft?.incident_date ?? "")
      ? (draft?.incident_date ?? "")
      : "",
    location: clean(draft?.incident_location),
    lines: (draft?.items ?? []).map((item) => ({
      description: item.description,
      category: item.category,
      amount: item.amount > 0 ? item.amount.toFixed(2) : "",
      source: item.source,
    })),
    questions: (draft?.missing_questions ?? [])
      .filter((q) => !isNote(q) && !ON_SCREEN.test(q))
      .slice(0, 2),
    unsure: new Set(draft?.low_confidence_fields ?? []),
    claimType: CHIPS[chip].claimType || draft?.claim_type || "",
  };
}

/** What happened in a tap, then receipts, then a short check. The assistant only drafts when
 * there's something to read, and nothing is sent until the customer presses Send. */
export function NewClaimPage({ api }: { api: Api }) {
  const ids = useId();
  const heading = useFocusHeading();
  const [policies, setPolicies] = useState<Policy[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [policyId, setPolicyId] = useState("");
  const [step, setStep] = useState<Step>("what");
  const [files, setFiles] = useState<File[]>([]);
  const [chip, setChip] = useState<CaseChip | "">("");
  const [words, setWords] = useState("");
  const [claimType, setClaimType] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [drafted, setDrafted] = useState(false);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [story, setStory] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [location, setLocation] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [answer, setAnswer] = useState("");
  const [unsure, setUnsure] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api.myPolicies().then(
      (found) => {
        if (!live) return;
        setPolicies(found);
        if (found[0]) setPolicyId(found[0].policy_id);
      },
      (caught: unknown) => {
        if (live) setLoadError(caught instanceof Error ? caught.message : String(caught));
      },
    );
    return () => {
      live = false;
    };
  }, [api]);

  const policy = policies?.find((p) => p.policy_id === policyId);
  const total = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
  const hasSomethingToRead = files.length > 0 || words.trim().length > 0;
  // "Something else" needs the customer's own sentence, since no tile says what happened.
  const needsWords = chip === "other" && words.trim().length === 0;

  async function goToCheck() {
    if (!chip) return;
    setStep("check");
    setDraftNote(null);
    let draft: Draft | null = null;
    if (hasSomethingToRead) {
      setDrafting(true);
      try {
        draft = await api.draft(policyId, words, chip, files);
      } catch (caught) {
        setDraftNote(
          caught instanceof ApiError
            ? `Our assistant couldn't help this time (${caught.message}). Fill in the details below.`
            : "Our assistant isn't available right now. Fill in the details below.",
        );
      }
    }
    const filled = fromDraft(draft, chip, words);
    setSummary(filled.summary || CHIPS[chip].label);
    setStory(filled.story);
    setIncidentDate(filled.incidentDate);
    setLocation(filled.location);
    setLines(filled.lines);
    setQuestions(filled.questions);
    setUnsure(filled.unsure);
    setClaimType(filled.claimType);
    setDrafted(draft !== null);
    setDrafting(false);
  }

  function answerQuestion(skip: boolean) {
    const [question, ...rest] = questions;
    if (!skip && answer.trim() && question) {
      setStory(`${story}${story ? "\n\n" : ""}${question} ${answer.trim()}`);
    }
    setAnswer("");
    setQuestions(rest);
  }

  function problem(): string | null {
    if (!policy) return "Choose the trip this is for.";
    if (!incidentDate) return "Choose the day it happened.";
    if (!location.trim()) return "Say where it happened.";
    if (!summary.trim()) return "Add a one-line summary.";
    if (lines.length === 0) return "Add at least one thing you're claiming for.";
    if (lines.some((line) => !line.description.trim() || !(Number(line.amount) > 0))) {
      return "Give each item a description and an amount above zero.";
    }
    return null;
  }

  async function send() {
    const found = problem();
    if (found) {
      setError(found);
      return;
    }
    if (!chip) return;
    if (!claimType) {
      setError("Choose the type of claim, then send it.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const made = await api.makeClaim({
        policy_id: policyId,
        claim_type: claimType,
        incident_date: incidentDate,
        incident_location: location.trim(),
        summary: summary.trim(),
        story: story.trim() || summary.trim(),
        items: lines.map((line) => ({
          description: line.description.trim(),
          category: line.category,
          amount: Math.round(Number(line.amount) * 100) / 100,
        })),
      });
      if (files.length > 0) {
        try {
          await api.addReceipts(made.claim_id, files);
        } catch (caught) {
          // The claim is made; the receipts can be added again from its page.
          window.location.hash = myClaimHref(made.claim_id);
          throw caught;
        }
      }
      window.location.hash = myClaimHref(made.claim_id);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "We couldn't send your claim.");
      setBusy(false);
    }
  }

  function setLine(index: number, change: Partial<Line>) {
    setLines(lines.map((line, i) => (i === index ? { ...line, ...change, source: "" } : line)));
  }

  const flag = (field: string) => (unsure.has(field) ? " unsure" : "");
  const stepNumber = { what: 1, receipts: 2, check: 3 }[step];

  return (
    <section aria-labelledby="new-claim-heading" className="form-page">
      <ol className="step-dots" aria-label={`Step ${String(stepNumber)} of 3`}>
        {[1, 2, 3].map((n) => (
          <li key={n} className={n <= stepNumber ? "on" : ""} aria-hidden="true" />
        ))}
      </ol>
      <p className="eyebrow">Make a claim · step {stepNumber} of 3</p>
      <h1 id="new-claim-heading" ref={heading} tabIndex={-1}>
        {step === "what"
          ? "What happened?"
          : step === "receipts"
            ? "Add your receipts"
            : "Check your claim"}
      </h1>
      {loadError && (
        <p className="error" role="alert">
          We couldn&apos;t load your policies: {loadError}
        </p>
      )}

      {step === "what" && (
        <div className="flow-step">
          {policies && policies.length > 1 && (
            <fieldset className="trip-cards">
              <legend>Which trip?</legend>
              {policies.map((p) => (
                <label
                  key={p.policy_id}
                  className={`trip-card${p.policy_id === policyId ? " chosen" : ""}`}
                >
                  <input
                    type="radio"
                    name={`${ids}-policy`}
                    value={p.policy_id}
                    checked={p.policy_id === policyId}
                    onChange={() => {
                      setPolicyId(p.policy_id);
                    }}
                  />
                  <span className="trip-name">{p.trip.destination}</span>
                  <span className="trip-dates">
                    {date(p.trip.departs_on)} – {date(p.trip.returns_on)}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {policies?.length === 1 && policy && (
            <p className="trip-line">
              Your trip to <strong>{policy.trip.destination}</strong>,{" "}
              {date(policy.trip.departs_on)} – {date(policy.trip.returns_on)}
            </p>
          )}
          <fieldset className="tiles">
            <legend>Tap the closest one</legend>
            {TILE_ORDER.map((name) => {
              const { label, hint, Icon } = CHIPS[name];
              return (
                <label key={name} className={`tile${chip === name ? " chosen" : ""}`}>
                  <input
                    type="radio"
                    name={`${ids}-chip`}
                    value={name}
                    checked={chip === name}
                    onChange={() => {
                      setChip(name);
                    }}
                  />
                  <span className="tile-icon" aria-hidden="true">
                    <Icon size={22} strokeWidth={2} />
                  </span>
                  <span className="tile-label">{label}</span>
                  <span className="tile-hint">{hint}</span>
                </label>
              );
            })}
          </fieldset>
          <div className="flow-actions">
            <button
              type="button"
              className="button wide"
              disabled={!policy || !chip}
              onClick={() => {
                setStep("receipts");
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {step === "receipts" && (
        <div className="flow-step">
          <p className="muted">
            Snap a photo or add a PDF of each receipt. Our assistant reads them, so there&apos;s
            less for you to type.
          </p>
          <ReceiptPicker files={files} onChange={setFiles} />
          <label htmlFor={`${ids}-words`}>
            {chip === "other"
              ? "What happened? A sentence is enough"
              : "Anything to add? (optional)"}
          </label>
          <textarea
            id={`${ids}-words`}
            rows={3}
            maxLength={1000}
            placeholder="For example: bag didn't arrive in Rome, bought clothes and a charger"
            value={words}
            onChange={(event) => {
              setWords(event.target.value);
            }}
          />
          <div className="flow-actions">
            <button
              type="button"
              className="button wide"
              disabled={needsWords}
              onClick={() => {
                void goToCheck();
              }}
            >
              {hasSomethingToRead ? (
                <>
                  <Sparkle size={16} strokeWidth={2} aria-hidden="true" />
                  Draft my claim
                </>
              ) : (
                "Continue without receipts"
              )}
            </button>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setStep("what");
              }}
            >
              Back
            </button>
          </div>
        </div>
      )}

      {step === "check" && drafting && (
        <div className="flow-step">
          <p role="status" className="ai-mark live-draft">
            <Sparkle size={14} strokeWidth={2} aria-hidden="true" />
            Reading your receipts and drafting your claim…
          </p>
          <div aria-hidden="true">
            <span className="skeleton skeleton-line" />
            <span className="skeleton skeleton-line" />
            <span className="skeleton skeleton-card" />
          </div>
        </div>
      )}

      {step === "check" && !drafting && chip && (
        <div className="flow-step">
          {draftNote && (
            <p className="notice" role="status">
              {draftNote}
            </p>
          )}
          {drafted && !draftNote && (
            <p className="ai-mark">
              <Sparkle size={14} strokeWidth={2} aria-hidden="true" />
              Drafted by our AI assistant. Check it and fix anything that&apos;s wrong.
            </p>
          )}

          <div className="chosen-line">
            <span className="tile-icon" aria-hidden="true">
              {(() => {
                const { Icon } = CHIPS[chip];
                return <Icon size={18} strokeWidth={2} />;
              })()}
            </span>
            <span>
              <strong>{CHIPS[chip].label}</strong>
              {policy && <span className="muted small"> · {policy.trip.destination}</span>}
            </span>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setStep("what");
              }}
            >
              Change
            </button>
          </div>

          {chip === "other" && (
            <>
              <label htmlFor={`${ids}-type`}>Type of claim</label>
              <select
                id={`${ids}-type`}
                value={claimType}
                className={claimType ? undefined : "unsure"}
                onChange={(event) => {
                  setClaimType(event.target.value);
                }}
              >
                <option value="">Choose the closest</option>
                {Object.entries(CLAIM_TYPES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </>
          )}

          {questions[0] && (
            <div className="question-card panel">
              <p className="question">
                <Sparkle size={14} strokeWidth={2} aria-hidden="true" /> {questions[0]}
              </p>
              <label htmlFor={`${ids}-answer`} className="visually-hidden">
                Your answer
              </label>
              <input
                id={`${ids}-answer`}
                value={answer}
                onChange={(event) => {
                  setAnswer(event.target.value);
                }}
              />
              <div className="flow-actions">
                <button
                  type="button"
                  className="button small-button"
                  onClick={() => {
                    answerQuestion(false);
                  }}
                >
                  Answer
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    answerQuestion(true);
                  }}
                >
                  Skip
                </button>
              </div>
            </div>
          )}

          <label htmlFor={`${ids}-summary`}>In one line</label>
          <input
            id={`${ids}-summary`}
            className={flag("summary")}
            maxLength={200}
            value={summary}
            onChange={(event) => {
              setSummary(event.target.value);
            }}
          />
          {policy && (
            <DayPicker
              label="When did it happen?"
              from={policy.trip.departs_on}
              to={policy.trip.returns_on}
              value={incidentDate}
              unsure={unsure.has("incident_date")}
              onChange={setIncidentDate}
            />
          )}
          <label htmlFor={`${ids}-where`}>Where?</label>
          <input
            id={`${ids}-where`}
            className={flag("incident_location")}
            maxLength={200}
            placeholder="City or airport"
            value={location}
            onChange={(event) => {
              setLocation(event.target.value);
            }}
          />
          {unsure.size > 0 && (
            <p className="small muted">
              Highlighted fields are ones our assistant wasn&apos;t sure of.
            </p>
          )}

          <h2 className="h3">What you&apos;re claiming</h2>
          {lines.length === 0 && (
            <p className="muted small">Add each thing you paid for, with what it cost.</p>
          )}
          {lines.map((line, index) => (
            <div key={String(index)} className="item-row">
              <div className="item-head">
                <label htmlFor={`${ids}-item-${String(index)}`}>Item {index + 1}</label>
                {line.source && <span className="source-tag">{line.source}</span>}
              </div>
              <input
                id={`${ids}-item-${String(index)}`}
                maxLength={200}
                value={line.description}
                onChange={(event) => {
                  setLine(index, { description: event.target.value });
                }}
              />
              <div className="item-row-pair">
                <div>
                  <label htmlFor={`${ids}-cat-${String(index)}`}>Kind</label>
                  <select
                    id={`${ids}-cat-${String(index)}`}
                    value={line.category}
                    onChange={(event) => {
                      setLine(index, { category: event.target.value });
                    }}
                  >
                    {Object.entries(CATEGORIES).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`${ids}-amount-${String(index)}`}>Amount (US$)</label>
                  <input
                    id={`${ids}-amount-${String(index)}`}
                    inputMode="decimal"
                    value={line.amount}
                    onChange={(event) => {
                      setLine(index, { amount: event.target.value });
                    }}
                  />
                </div>
              </div>
              <button
                type="button"
                className="link-button small"
                onClick={() => {
                  setLines(lines.filter((_, i) => i !== index));
                }}
              >
                <Trash2 size={14} strokeWidth={2} aria-hidden="true" /> Remove item {index + 1}
              </button>
            </div>
          ))}
          {lines.length < 20 && (
            <button
              type="button"
              className="button secondary add-item"
              onClick={() => {
                setLines([...lines, { ...BLANK }]);
              }}
            >
              <Plus size={16} strokeWidth={2} aria-hidden="true" /> Add an item
            </button>
          )}
          {lines.length > 0 && (
            <p className="total">
              Total claimed <span className="number">{dollars(total)}</span>
            </p>
          )}

          <details className="your-words">
            <summary>What happened, in your words</summary>
            <label htmlFor={`${ids}-story`} className="visually-hidden">
              What happened
            </label>
            <textarea
              id={`${ids}-story`}
              rows={5}
              maxLength={4000}
              value={story}
              onChange={(event) => {
                setStory(event.target.value);
              }}
            />
          </details>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="flow-actions">
            <button
              type="button"
              className="button wide"
              disabled={busy}
              onClick={() => {
                void send();
              }}
            >
              {busy ? "Sending your claim…" : "Send my claim"}
            </button>
            <button
              type="button"
              className="link-button"
              disabled={busy}
              onClick={() => {
                setStep("receipts");
              }}
            >
              Back
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
