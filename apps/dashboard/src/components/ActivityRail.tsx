import { Activity, ChevronDown, ShieldAlert, ShieldCheck } from "lucide-react";
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

/** What the hidden-instruction check found, from its own step: nothing, something, or (when
 * the check hasn't run) null. */
export function screeningOf(steps: Step[]): "clear" | "found" | null {
  const check = steps.find((step) => step.kind === "screening");
  if (!check) return null;
  return check.content.startsWith("Instructions found") ? "found" : "clear";
}

interface ActivityRailProps {
  api: Api;
  claimId: string;
  steps: Step[];
  working: boolean;
  trace: boolean;
  onTraceChange: (on: boolean) => void;
  /** Open to begin with: yes while the agent's work is the news, no once there's a decision. */
  defaultOpen?: boolean;
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
  defaultOpen = true,
}: ActivityRailProps) {
  const [open, setOpen] = useState(defaultOpen || trace);
  // Turning the trace on (the switch, or T) opens the rail if it was folded away.
  const [lastTrace, setLastTrace] = useState(trace);
  if (trace !== lastTrace) {
    setLastTrace(trace);
    if (trace) setOpen(true);
  }
  const [found, setFound] = useState<Trace | null>(null);
  const ids = useId();
  const plain = steps
    .map((step) => ({ step, text: plainStep(step.kind, step.content) }))
    .filter((entry) => entry.text !== null);
  const screening = screeningOf(steps);

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
          <Activity size={17} strokeWidth={1.75} aria-hidden="true" /> Agent activity
        </h2>
        {screening === "clear" && (
          <span className="chip chip-good">
            <ShieldCheck size={13} strokeWidth={1.75} aria-hidden="true" />
            Screened: no hidden instructions
          </span>
        )}
        {screening === "found" && (
          <span className="chip chip-bad">
            <ShieldAlert size={13} strokeWidth={1.75} aria-hidden="true" />
            Screened: hidden instructions found
          </span>
        )}
        <span className="rail-meta">
          <span className="muted small">
            {plain.length} {plain.length === 1 ? "step" : "steps"}
          </span>
          <AiMark />
          <button
            type="button"
            className={`icon-button rail-toggle${open ? " open" : ""}`}
            aria-expanded={open}
            aria-controls={`${ids}-body`}
            aria-label={open ? "Collapse agent activity" : "Expand agent activity"}
            onClick={() => {
              setOpen((value) => !value);
            }}
          >
            <ChevronDown size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </span>
      </div>
      <div id={`${ids}-body`} className="rail-body" hidden={!open}>
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
          Show the details{" "}
          <span className="muted small">(what the agent asked for and got back, step by step)</span>
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

/** A source file as people read it: "claim_rules.yaml" reads "Claim rules". */
export function sourceName(file: string): string {
  const name = file.replace(/\.[a-z]+$/i, "").replaceAll("_", " ");
  return name.charAt(0).toUpperCase() + name.slice(1);
}

interface Entry {
  step: Step;
  result?: Step;
}

/** Each step once, a tool's answer folded into the call that asked for it. */
export function entriesOf(steps: Step[]): Entry[] {
  const entries: Entry[] = [];
  for (const step of steps) {
    const last = entries.at(-1);
    if (step.kind === "tool_result" && last?.step.kind === "tool_call" && !last.result) {
      last.result = step;
    } else {
      entries.push({ step });
    }
  }
  return entries;
}

/** A step's title in plain words: what the agent did, not the tool's name. */
function titleOf(step: Step): string {
  const plain = plainStep(step.kind, step.content);
  if (plain) return plain;
  if (step.kind === "tool_call") return `Used ${step.content.split(" ", 1)[0] ?? "a tool"}`;
  if (step.kind === "tool_result") return "What came back";
  if (step.kind === "lookup" && step.sources[0]) {
    return `Looked up the ${sourceName(step.sources[0].file).toLowerCase()}`;
  }
  return STEP_LABELS[step.kind];
}

function TraceView({ trace }: { trace: Trace | null }) {
  if (!trace) return <p className="muted">Loading the details…</p>;
  return (
    <ol className="trace-steps">
      {entriesOf(trace.steps).map(({ step, result }) => (
        <li key={step.step_id}>
          <details open={step.kind === "screening" || step.kind === "refusal"}>
            <summary>
              <strong>{titleOf(step)}</strong>{" "}
              <span className="muted small">{when(step.created_at)}</span>
            </summary>
            {result && <p className="trace-label small muted">What it asked for</p>}
            <pre dir="auto">{pretty(step.content)}</pre>
            {result && (
              <>
                <p className="trace-label small muted">What came back</p>
                <pre dir="auto">{pretty(result.content)}</pre>
              </>
            )}
            {step.sources.length > 0 && (
              <p className="muted small">
                From {step.sources.map((s) => sourceName(s.file)).join(", ")}
              </p>
            )}
          </details>
        </li>
      ))}
    </ol>
  );
}

export { storedTrace };
