import { X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ApiError, type Api, type Controls } from "../api";

type Stop = "agent" | "payouts";

const STOPS: Record<Stop, { title: string; detail: string; example: string; confirm: string }> = {
  agent: {
    title: "Turn the agent off?",
    detail:
      "Every claim waits for a person until a senior handler turns it back on in the dashboard.",
    example: "e.g. Odd approvals on Live",
    confirm: "Turn the agent off",
  },
  payouts: {
    title: "Pause all payouts?",
    detail:
      "The agent keeps deciding, but nothing is paid until a senior handler resumes payouts in the dashboard.",
    example: "e.g. Checking a run of odd approvals",
    confirm: "Pause all payouts",
  },
};

const SHORTEST = 3;
const CARD_WIDTH = 380;
const EDGE = 16;

/** Just below what opened it, centred on it and kept inside the window. */
function below(opener: HTMLElement): { top: number; left: number } {
  const box = opener.getBoundingClientRect();
  const width = Math.min(CARD_WIDTH, window.innerWidth - 2 * EDGE);
  const centred = box.left + box.width / 2 - width / 2;
  return {
    top: box.bottom + 10,
    left: Math.min(Math.max(centred, EDGE), window.innerWidth - width - EDGE),
  };
}

/** The stop, with why in one line; nothing changes until the dark button. */
function StopCard({
  stop,
  opener,
  onStop,
  onClose,
}: {
  stop: Stop;
  opener: HTMLElement;
  onStop: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const ids = useId();
  const card = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [place] = useState(() => below(opener));
  const words = STOPS[stop];
  const ready = reason.trim().length >= SHORTEST;

  // Opens on the reason; closing returns focus to the pill that opened it.
  useEffect(() => {
    field.current?.focus();
    return () => {
      if (opener.isConnected) opener.focus();
    };
  }, [opener]);

  // Escape, or a click outside, closes it unless the stop is on its way.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onDown = (event: PointerEvent) => {
      if (busy) return;
      if (event.target instanceof Node && card.current?.contains(event.target)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [busy, onClose]);

  return (
    <div
      className="stop-card"
      role="dialog"
      aria-labelledby={`${ids}-title`}
      ref={card}
      style={{ top: place.top, left: place.left }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready || busy) return;
          setBusy(true);
          setError(null);
          onStop(reason.trim()).then(
            () => {
              setBusy(false);
              onClose();
            },
            (caught: unknown) => {
              setBusy(false);
              setError(caught instanceof ApiError ? caught.message : "That didn't go through.");
            },
          );
        }}
      >
        <div className="stop-card-head">
          <h2 id={`${ids}-title`}>{words.title}</h2>
          <button type="button" className="stop-card-close" aria-label="Close" onClick={onClose}>
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <p className="muted small">{words.detail}</p>
        <label htmlFor={`${ids}-why`} className="small">
          Why? <span className="muted">Kept with your name and the time</span>
        </label>
        <input
          id={`${ids}-why`}
          ref={field}
          value={reason}
          maxLength={200}
          placeholder={words.example}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
        <div className="stop-card-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={!ready || busy}>
            {busy ? "Stopping…" : words.confirm}
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

/** The agent and payouts switches, on every page: green when on, red when off. An engineer can
 * stop either here in an incident; turning it back on is a senior handler's, in the dashboard. */
export function ControlPills({ api }: { api: Api }) {
  const [controls, setControls] = useState<Controls | null>(null);
  const [open, setOpen] = useState<{ stop: Stop; opener: HTMLElement } | null>(null);

  const load = useCallback(() => {
    api.getControls().then(setControls, () => {
      // Nothing to show until the switches can be read; the page itself says what failed.
    });
  }, [api]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [load]);

  const close = useCallback(() => {
    setOpen(null);
  }, []);

  if (!controls) return null;
  const { agent, payouts } = controls;
  const agentWords = agent.on ? `Agent on · ${String(agent.working)} working` : "Agent off";
  const payoutWords = payouts.paused ? "Payouts paused" : "Payouts live";
  const restart = "A senior handler turns it back on in the dashboard";
  return (
    <span className="control-pills">
      {agent.on ? (
        <button
          type="button"
          className="control-pill is-on"
          aria-haspopup="dialog"
          title="Turn the agent off"
          onClick={(event) => {
            setOpen({ stop: "agent", opener: event.currentTarget });
          }}
        >
          <span className="status-dot" aria-hidden="true" />
          <span className="control-label">{agentWords}</span>
        </button>
      ) : (
        <span className="control-pill is-off" title={restart}>
          <span className="status-dot" aria-hidden="true" />
          <span className="control-label">{agentWords}</span>
        </span>
      )}
      {payouts.paused ? (
        <span className="control-pill is-off" title={restart}>
          <span className="status-dot" aria-hidden="true" />
          <span className="control-label">{payoutWords}</span>
        </span>
      ) : (
        <button
          type="button"
          className="control-pill is-on"
          aria-haspopup="dialog"
          title="Pause all payouts"
          onClick={(event) => {
            setOpen({ stop: "payouts", opener: event.currentTarget });
          }}
        >
          <span className="status-dot" aria-hidden="true" />
          <span className="control-label">{payoutWords}</span>
        </button>
      )}
      {open && (
        <StopCard
          stop={open.stop}
          opener={open.opener}
          onClose={close}
          onStop={async (reason) => {
            await (open.stop === "agent" ? api.stopAgent(reason) : api.pausePayouts(reason));
            load();
          }}
        />
      )}
    </span>
  );
}
