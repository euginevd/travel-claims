import { Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useState, type SubmitEvent } from "react";
import { ApiError, type Api, type Policy } from "../api";
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
}

const BLANK: Line = { description: "", category: "accommodation", amount: "" };
const STORY_LIMIT = 4000;

export function NewClaimPage({ api }: { api: Api }) {
  const ids = useId();
  const heading = useFocusHeading();
  const [policies, setPolicies] = useState<Policy[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [policyId, setPolicyId] = useState("");
  const [claimType, setClaimType] = useState("trip_delay");
  const [incidentDate, setIncidentDate] = useState("");
  const [location, setLocation] = useState("");
  const [summary, setSummary] = useState("");
  const [story, setStory] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...BLANK }]);
  const [files, setFiles] = useState<File[]>([]);
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

  function problem(): string | null {
    if (!policy) return "Choose the policy you travelled on.";
    if (!incidentDate) return "Say when it happened.";
    if (!location.trim() || !summary.trim() || !story.trim()) {
      return "Tell us where it happened, what happened in a line, and the whole story.";
    }
    if (lines.some((line) => !line.description.trim() || !(Number(line.amount) > 0))) {
      return "Give each item a description and an amount above zero.";
    }
    return null;
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
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
    setLines(lines.map((line, i) => (i === index ? { ...line, ...change } : line)));
  }

  return (
    <section aria-labelledby="new-claim-heading" className="form-page">
      <p className="eyebrow">Make a claim</p>
      <h1 id="new-claim-heading" ref={heading} tabIndex={-1}>
        Tell us what happened
      </h1>
      <p className="muted">
        It takes a few minutes. Our claims agent checks it against your policy, and a person signs
        off anything large.
      </p>
      {loadError && (
        <p className="error" role="alert">
          We couldn&apos;t load your policies: {loadError}
        </p>
      )}
      <form
        className="steps-form"
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <fieldset className="form-step">
          <legend>
            <span className="step-number">1</span> Your trip
          </legend>
          <label htmlFor={`${ids}-policy`}>Policy</label>
          <select
            id={`${ids}-policy`}
            value={policyId}
            onChange={(event) => {
              setPolicyId(event.target.value);
            }}
          >
            {(policies ?? []).map((p) => (
              <option key={p.policy_id} value={p.policy_id}>
                {p.trip.destination}, {date(p.trip.departs_on)} to {date(p.trip.returns_on)} (
                {p.policy_id})
              </option>
            ))}
          </select>
        </fieldset>

        <fieldset className="form-step">
          <legend>
            <span className="step-number">2</span> What happened
          </legend>
          <label htmlFor={`${ids}-type`}>What kind of claim</label>
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
          <label htmlFor={`${ids}-date`}>When it happened</label>
          <input
            id={`${ids}-date`}
            type="date"
            value={incidentDate}
            min={policy?.trip.departs_on}
            max={policy?.trip.returns_on}
            aria-describedby={`${ids}-date-hint`}
            onChange={(event) => {
              setIncidentDate(event.target.value);
            }}
          />
          {policy && (
            <p id={`${ids}-date-hint`} className="small muted">
              During your trip, {date(policy.trip.departs_on)} to {date(policy.trip.returns_on)}.
            </p>
          )}
          <label htmlFor={`${ids}-where`}>Where it happened</label>
          <input
            id={`${ids}-where`}
            maxLength={200}
            value={location}
            onChange={(event) => {
              setLocation(event.target.value);
            }}
          />
          <label htmlFor={`${ids}-summary`}>In one line</label>
          <input
            id={`${ids}-summary`}
            maxLength={200}
            placeholder="For example: flight home cancelled, stayed an extra night"
            value={summary}
            onChange={(event) => {
              setSummary(event.target.value);
            }}
          />
          <label htmlFor={`${ids}-story`}>The whole story</label>
          <textarea
            id={`${ids}-story`}
            rows={6}
            maxLength={STORY_LIMIT}
            aria-describedby={`${ids}-story-count`}
            value={story}
            onChange={(event) => {
              setStory(event.target.value);
            }}
          />
          <p id={`${ids}-story-count`} className="small muted">
            {story.length} of {STORY_LIMIT} characters
          </p>
        </fieldset>

        <fieldset className="form-step">
          <legend>
            <span className="step-number">3</span> What you&apos;re claiming
          </legend>
          {lines.map((line, index) => (
            <div key={String(index)} className="item-row">
              <label htmlFor={`${ids}-item-${String(index)}`}>Item {index + 1}</label>
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
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
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
                  className="button secondary"
                  onClick={() => {
                    setLines(lines.filter((_, i) => i !== index));
                  }}
                >
                  <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
                  Remove item {index + 1}
                </button>
              )}
            </div>
          ))}
          {lines.length < 20 && (
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setLines([...lines, { ...BLANK }]);
              }}
            >
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
              Add another item
            </button>
          )}
          <p className="total">
            Total claimed <span className="number">{dollars(total)}</span>
          </p>
        </fieldset>

        <fieldset className="form-step">
          <legend>
            <span className="step-number">4</span> Receipts
          </legend>
          <p className="small muted">
            Add a photo or PDF of each receipt. You can also add them later from your claim.
          </p>
          <ReceiptPicker files={files} onChange={setFiles} />
        </fieldset>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button wide" disabled={busy || !policies}>
          {busy ? "Sending your claim…" : "Send my claim"}
        </button>
      </form>
    </section>
  );
}
