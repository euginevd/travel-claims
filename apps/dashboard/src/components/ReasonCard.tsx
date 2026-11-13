import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ApiError } from "../api";

interface Props {
  title: string;
  detail: string;
  /** An example of a reason, shown in the empty field. */
  example: string;
  confirm: string;
  /** What couldn't happen, said when the change fails for a reason the api didn't give. */
  failed: string;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}

const SHORTEST = 3;

/** A switch's change, with why: the same small card for the agent switch and payouts. One short
 * line says why, kept with who and when; nothing changes until the dark button. */
export function ReasonCard({ title, detail, example, confirm, failed, onConfirm, onClose }: Props) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const ids = useId();
  const field = useRef<HTMLInputElement>(null);
  const ready = reason.trim().length >= SHORTEST;

  // The reason is the one thing to fill in, so the card opens on it.
  useEffect(() => {
    field.current?.focus();
  }, []);

  // Escape closes the card, wherever focus is inside it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  async function submit() {
    if (inFlight.current || !ready) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : failed);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-labelledby={`${ids}-title`}>
      <form
        className="payouts-popover"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="payouts-popover-head">
          <h2 id={`${ids}-title`} className="payouts-panel-title">
            {title}
          </h2>
          <button type="button" className="popover-close" aria-label="Close" onClick={onClose}>
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <p className="muted small">{detail}</p>
        <label htmlFor={`${ids}-reason`}>
          Why? <span className="muted">Kept with your name and the time</span>
        </label>
        <input
          id={`${ids}-reason`}
          value={reason}
          maxLength={200}
          placeholder={example}
          disabled={busy}
          ref={field}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
        <div className="actions popover-actions">
          <button className="popover-cancel" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button small-button" type="submit" disabled={busy || !ready}>
            {confirm}
          </button>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
