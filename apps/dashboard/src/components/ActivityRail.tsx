import { Activity, ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { Api, Step, Trace } from "../api";
import { plainStep, STEP_LABELS, when } from "../format";
import { AiMark } from "./AiMark";

const TRACE_KEY = "undercover.dashboard.trace";

function storedTrace(): boolean {
  try {
    return window.localStorage.getItem(TRACE_KEY) === "on";
  } catch {
    return false;
  }
}

function storeTrace(on: boolean) {
  try {
    window.localStorage.setItem(TRACE_KEY, on ? "on" : "off");
  } catch {
    // Storage blocked: the toggle still works for this page.
  }
}

/** A step's content as the trace shows it: JSON pretty-printed, anything else as it came. */
export function pretty(content: string): string {
  const space = content.indexOf(" ");
  const head = space > 0 && content.slice(space + 1).startsWith("{") ? content.slice(0, space) : "";
  const body = head ? content.slice(space + 1) : content;
  try {
    const parsed: unknown = JSON.parse(body);
    return `${head ? `${head}\n` : ""}${JSON.stringify(parsed, null, 2)}`;
  } catch {
    return content;
  }
}

interface ActivityRailProps {
  api: Api;
  claimId: string;
  steps: Step[];
  working: boolean;
  trace: boolean;
  onTraceChange: (on: boolean) => void;
}

/** The agent's work, kept apart from the decision: plain steps by default, and with the trace on,
 * every step's raw content and every model call. */
export function ActivityRail({
  api,
  claimId,
  steps,
  working,
  trace,
  onTraceChange,
}: ActivityRailProps) {
  const [open, setOpen] = useState(true);
  const [found, setFound] = useState<Trace | null>(null);
  const ids = useId();
  const plain = steps
    .map((step) => ({ step, text: plainStep(step.kind, step.content) }))
    .filter((entry) => entry.text !== null);

  useEffect(() => {
    if (!trace) return;
    const controller = new AbortController();
    api.getTrace(claimId, controller.signal).then(
      (loaded) => {
        setFound(loaded);
      },
      () => {
        // A trace that fails to load leaves the plain steps; the claim page shows load errors.
      },
    );
    return () => {
      controller.abort();
    };
  }, [api, claimId, trace, steps.length]);

  return (
    <section className="panel rail" aria-labelledby={`${ids}-heading`}>
      <div className="rail-head">
        <h2 id={`${ids}-heading`}>
          <Activity size={18} strokeWidth={2} aria-hidden="true" /> Agent activity
        </h2>
        <AiMark />
        <button
          type="button"
          className="icon-button"
          aria-expanded={open}
          aria-controls={`${ids}-body`}
          aria-label={open ? "Collapse agent activity" : "Expand agent activity"}
          onClick={() => {
            setOpen((value) => !value);
          }}
        >
          {open ? (
            <ChevronUp size={18} aria-hidden="true" />
          ) : (
            <ChevronDown size={18} aria-hidden="true" />
          )}
        </button>
      </div>
      <div id={`${ids}-body`} hidden={!open}>
        <label className="toggle">
          <input
            type="checkbox"
            role="switch"
            checked={trace}
            onChange={(event) => {
              storeTrace(event.target.checked);
              onTraceChange(event.target.checked);
            }}
          />
          Show trace <span className="muted small">(every tool call and its sources · T)</span>
        </label>
        {working && (
          <p className="muted small live" role="status">
            The agent is working…
          </p>
        )}
        {!trace &&
          (plain.length === 0 ? (
            <p className="muted">Nothing yet.</p>
          ) : (
            <ol className="rail-steps">
              {plain.map(({ step, text }) => (
                <li key={step.step_id} className={`rail-step rail-${step.kind}`}>
                  <span dir="auto">{text}</span>
                  <time dateTime={step.created_at} className="muted small">
                    {when(step.created_at)}
                  </time>
                </li>
              ))}
            </ol>
          ))}
        {trace && <TraceView trace={found} />}
      </div>
    </section>
  );
}

function TraceView({ trace }: { trace: Trace | null }) {
  if (!trace) return <p className="muted">Loading the trace…</p>;
  return (
    <>
      <ol className="trace-steps">
        {trace.steps.map((step) => (
          <li key={step.step_id}>
            <details open={step.kind === "screening" || step.kind === "refusal"}>
              <summary>
                <strong>{STEP_LABELS[step.kind]}</strong>{" "}
                <span className="muted small">{when(step.created_at)}</span>
              </summary>
              <pre dir="auto">{pretty(step.content)}</pre>
              {step.sources.length > 0 && (
                <p className="muted small">From {step.sources.map((s) => s.file).join(", ")}</p>
              )}
            </details>
          </li>
        ))}
      </ol>
    </>
  );
}

export { storedTrace };
