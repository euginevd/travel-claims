import { Plus, Sparkle, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { ApiError, caseChips, type Api, type CaseChip, type Draft, type Policy } from "../api";
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

export const CHIPS: Record<CaseChip, { label: string; claimType: string }> = {
  lost_bag: { label: "Lost bag", claimType: "baggage" },
  delayed_bag: { label: "Bag arrived late", claimType: "baggage_delay" },
  flight_delay: { label: "Delayed flight", claimType: "trip_delay" },
  trip_cancelled: { label: "Trip cancelled", claimType: "trip_cancellation" },
  medical: { label: "Medical", claimType: "emergency_medical" },
  stolen: { label: "Something stolen", claimType: "baggage" },
  passport: { label: "Lost passport", claimType: "passport" },
};

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
type Step = "receipts" | "what" | "check";

/** The claim to check, from the assistant's draft or, without one, from what the customer gave. */
export function fromDraft(draft: Draft | null, chip: CaseChip | "", words: string) {
  const lines: Line[] = draft?.items.length
    ? draft.items.map((item) => ({
        description: item.description,
        category: item.category,
        amount: item.amount > 0 ? item.amount.toFixed(2) : "",
        source: item.source,
      }))
    : [{ ...BLANK }];
  return {
    claimType: draft?.claim_type ?? (chip ? CHIPS[chip].claimType : "trip_delay"),
    summary: draft?.summary ?? "",
    // The customer's own words are the record; the assistant's story only fills a blank.
    story: words.trim() || draft?.story || "",
    incidentDate: /^\d{4}-\d{2}-\d{2}$/.test(draft?.incident_date ?? "")
      ? (draft?.incident_date ?? "")
      : "",
    location: draft?.incident_location ?? "",
    lines,
    questions: draft?.missing_questions ?? [],
    unsure: new Set(draft?.low_confidence_fields ?? []),
  };
}

/** Photo first: receipts, then what happened in a tap or a few words, then the assistant's
 * draft to check, one question at a time for anything missing. Nothing is sent until the
 * customer presses Send. */
export function NewClaimPage({ api }: { api: Api }) {
  const ids = useId();
  const heading = useFocusHeading();
  const [policies, setPolicies] = useState<Policy[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [policyId, setPolicyId] = useState("");
  const [step, setStep] = useState<Step>("receipts");
  const [files, setFiles] = useState<File[]>([]);
  const [chip, setChip] = useState<CaseChip | "">("");
  const [words, setWords] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [claimType, setClaimType] = useState("trip_delay");
  const [summary, setSummary] = useState("");
  const [story, setStory] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [location, setLocation] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...BLANK }]);
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

  async function draftIt() {
    setStep("check");
    setDrafting(true);
    setDraftNote(null);
    let draft: Draft | null = null;
    try {
      draft = await api.draft(policyId, words, chip, files);
    } catch (caught) {
      setDraftNote(
        caught instanceof ApiError ? caught.message : "The assistant isn't available; fill it in.",
      );
    }
    const filled = fromDraft(draft, chip, words);
    setClaimType(filled.claimType);
    setSummary(filled.summary);
    setStory(filled.story);
    setIncidentDate(filled.incidentDate);
    setLocation(filled.location);
    setLines(filled.lines);
    setQuestions(filled.questions);
    setUnsure(filled.unsure);
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
    if (!incidentDate) return "Say when it happened.";
    if (!location.trim() || !summary.trim() || !story.trim()) {
      return "Fill in where it happened, a one-line summary and what happened.";
    }
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
    setBusy(true);
    setError(null);
    try {
      const made = await api.makeClaim({
        policy_id: policyId,
        claim_type: claimType,
        incident_date: incidentDate,
        incident_location: location.trim(),
        summary: summary.trim(),
        story: story.trim(),
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
  const stepNumber = { receipts: 1, what: 2, check: 3 }[step];

  return (
    <section aria-labelledby="new-claim-heading" className="form-page">
      <p className="eyebrow">Make a claim · step {stepNumber} of 3</p>
      <h1 id="new-claim-heading" ref={heading} tabIndex={-1}>
        {step === "receipts"
          ? "Start with your receipts"
          : step === "what"
            ? "What happened?"
            : "Check your claim"}
      </h1>
      {loadError && (
        <p className="error" role="alert">
          We couldn&apos;t load your policies: {loadError}
        </p>
      )}
      {policies && policies.length > 1 && step !== "check" && (
        <p className="trip-pick">
          <label htmlFor={`${ids}-policy`}>Trip</label>
          <select
            id={`${ids}-policy`}
            value={policyId}
            onChange={(event) => {
              setPolicyId(event.target.value);
            }}
          >
            {policies.map((p) => (
              <option key={p.policy_id} value={p.policy_id}>
                {p.trip.destination}, {date(p.trip.departs_on)} to {date(p.trip.returns_on)}
              </option>
            ))}
          </select>
        </p>
      )}
      {policies?.length === 1 && policy && step !== "check" && (
        <p className="muted small">
          Your trip to {policy.trip.destination}, {date(policy.trip.departs_on)} to{" "}
          {date(policy.trip.returns_on)}.
        </p>
      )}

      {step === "receipts" && (
        <div className="flow-step">
          <p className="muted">
            Snap a photo or add a PDF of each receipt. Our assistant reads them for you, so
            there&apos;s less to type.
          </p>
          <ReceiptPicker files={files} onChange={setFiles} />
          <div className="flow-actions">
            <button
              type="button"
              className="button wide"
              disabled={!policy}
              onClick={() => {
                setStep("what");
              }}
            >
              {files.length > 0 ? "Next" : "I don't have a receipt"}
            </button>
          </div>
        </div>
      )}

      {step === "what" && (
        <div className="flow-step">
          <fieldset className="chips">
            <legend>Tap the closest one</legend>
            {caseChips.map((name) => (
              <label key={name} className={`chip-choice${chip === name ? " chosen" : ""}`}>
                <input
                  type="radio"
                  name={`${ids}-chip`}
                  value={name}
                  checked={chip === name}
                  onChange={() => {
                    setChip(name);
                  }}
                />
                {CHIPS[name].label}
              </label>
            ))}
          </fieldset>
          <label htmlFor={`${ids}-words`}>A few words, if you like</label>
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
              disabled={!chip && !words.trim() && files.length === 0}
              onClick={() => {
                void draftIt();
              }}
            >
              <Sparkle size={16} strokeWidth={2} aria-hidden="true" />
              Draft my claim
            </button>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setStep("receipts");
              }}
            >
              Back
            </button>
          </div>
        </div>
      )}

      {step === "check" && drafting && (
        <div className="flow-step" aria-hidden="true">
          <p role="status" className="ai-mark live-draft">
            <Sparkle size={14} strokeWidth={2} />
            Reading your receipts and drafting your claim…
          </p>
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-card" />
        </div>
      )}

      {step === "check" && !drafting && (
        <div className="flow-step">
          {draftNote ? (
            <p className="notice" role="status">
              {draftNote}
            </p>
          ) : (
            <p className="ai-mark">
              <Sparkle size={14} strokeWidth={2} aria-hidden="true" />
              Drafted by our AI assistant. Check it and fix anything that&apos;s wrong.
            </p>
          )}

          {questions[0] && (
            <div className="question-card panel">
              <p className="question">{questions[0]}</p>
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
          <div className="pair">
            <div>
              <label htmlFor={`${ids}-date`}>When</label>
              <input
                id={`${ids}-date`}
                type="date"
                className={flag("incident_date")}
                value={incidentDate}
                min={policy?.trip.departs_on}
                max={policy?.trip.returns_on}
                onChange={(event) => {
                  setIncidentDate(event.target.value);
                }}
              />
            </div>
            <div>
              <label htmlFor={`${ids}-where`}>Where</label>
              <input
                id={`${ids}-where`}
                className={flag("incident_location")}
                maxLength={200}
                value={location}
                onChange={(event) => {
                  setLocation(event.target.value);
                }}
              />
            </div>
          </div>
          {unsure.size > 0 && (
            <p className="small muted">
              Highlighted fields are ones the assistant wasn&apos;t sure of.
            </p>
          )}
          <label htmlFor={`${ids}-type`}>Type of claim</label>
          <select
            id={`${ids}-type`}
            value={claimType}
            onChange={(event) => {
              setClaimType(event.target.value);
            }}
          >
            {Object.entries(CLAIM_TYPES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <h2 className="h3">What you&apos;re claiming</h2>
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
              {lines.length > 1 && (
                <button
                  type="button"
                  className="link-button small"
                  onClick={() => {
                    setLines(lines.filter((_, i) => i !== index));
                  }}
                >
                  <Trash2 size={14} strokeWidth={2} aria-hidden="true" /> Remove item {index + 1}
                </button>
              )}
            </div>
          ))}
          {lines.length < 20 && (
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setLines([...lines, { ...BLANK }]);
              }}
            >
              <Plus size={14} strokeWidth={2} aria-hidden="true" /> Add an item
            </button>
          )}
          <p className="total">
            Total claimed <span className="number">{dollars(total)}</span>
          </p>

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
                setStep("what");
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
