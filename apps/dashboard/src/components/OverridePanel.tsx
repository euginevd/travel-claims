import { useId, useRef, useState, type SubmitEvent } from "react";
import {
  NOTE_LIMIT,
  reasonCodes,
  type DecisionKind,
  type OverrideRequest,
  type ReasonCode,
} from "../api";
import { dollars, REASON_LABELS } from "../format";

interface OverridePanelProps {
  customerName: string;
  onOverride: (request: OverrideRequest) => Promise<void>;
}

/** A senior handler's own decision in place of the agent's, with a reason code. The button says
 * what will happen before anything does. */
export function OverridePanel({ customerName, onOverride }: OverridePanelProps) {
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<DecisionKind>("approve");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState<ReasonCode>("evidence");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const ids = useId();
  const payout = decision === "approve" ? Number(amount) : 0;

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    if (decision === "approve" && !(payout > 0)) {
      setError("Enter the amount to pay.");
      return;
    }
    if (!note.trim()) {
      setError("Say why, for the record.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await onOverride({ decision, payout, reason_code: reason, note: note.trim() });
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="button secondary small-button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Override the decision
      </button>
    );
  }

  const consequence =
    decision === "approve"
      ? payout > 0
        ? `This pays ${dollars(payout)} to ${customerName} now.`
        : "Enter the amount to pay."
      : decision === "decline"
        ? `This declines the claim. ${customerName} sees your decision.`
        : "This refers the claim for a person to follow up.";

  return (
    <form
      className="panel override"
      noValidate
      aria-labelledby={`${ids}-heading`}
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <h2 id={`${ids}-heading`}>Override the decision</h2>
      <label htmlFor={`${ids}-decision`}>New decision</label>
      <select
        id={`${ids}-decision`}
        value={decision}
        onChange={(event) => {
          setDecision(event.target.value as DecisionKind);
        }}
      >
        <option value="approve">Approve</option>
        <option value="decline">Decline</option>
        <option value="refer">Refer</option>
      </select>
      {decision === "approve" && (
        <>
          <label htmlFor={`${ids}-amount`}>Amount to pay (US dollars)</label>
          <input
            id={`${ids}-amount`}
            inputMode="decimal"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
          />
        </>
      )}
      <label htmlFor={`${ids}-reason`}>Reason</label>
      <select
        id={`${ids}-reason`}
        value={reason}
        onChange={(event) => {
          setReason(event.target.value as ReasonCode);
        }}
      >
        {reasonCodes.map((code) => (
          <option key={code} value={code}>
            {REASON_LABELS[code]}
          </option>
        ))}
      </select>
      <label htmlFor={`${ids}-note`}>Note for the record</label>
      <textarea
        id={`${ids}-note`}
        rows={3}
        maxLength={NOTE_LIMIT}
        value={note}
        onChange={(event) => {
          setNote(event.target.value);
        }}
      />
      <p className="checkpoint" role="status">
        {consequence}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="button" disabled={busy}>
          {busy ? "Saving…" : "Confirm override"}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => {
            setOpen(false);
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
