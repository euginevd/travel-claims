import {
  Bot,
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  Search,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type SubmitEvent } from "react";
import type { Api, Trace } from "../api";
import { Sparkline } from "../components/Charts";
import { RecentTraces } from "../components/RecentTraces";
import { dollars, when } from "../format";
import { modelName, timeline, unscopedCalls, type Entry } from "../traceTimeline";
import { useFocusHeading } from "../useFocusHeading";

const OUTCOMES = {
  approve: "Approved",
  decline: "Declined",
  refer: "Referred to a handler",
} as const;

function count(value: number): string {
  return value.toLocaleString("en-AU");
}

/** The trace's totals, worked out from its model calls. */
function Totals({ trace }: { trace: Trace }) {
  const tokensIn = trace.model_calls.reduce((sum, call) => sum + call.input_tokens, 0);
  const tokensOut = trace.model_calls.reduce((sum, call) => sum + call.output_tokens, 0);
  const timed = trace.model_calls.filter((call) => call.latency_ms !== null);
  const seconds = timed.reduce((sum, call) => sum + (call.latency_ms ?? 0), 0) / 1000;
  return (
    <ul className="kpis" aria-label="The trace's totals">
      <li className="kpi">
        <p className="kpi-label">Steps</p>
        <p className="kpi-value">{count(trace.steps.length)}</p>
      </li>
      <li className="kpi">
        <p className="kpi-label">Tokens in</p>
        <p className="kpi-value">{count(tokensIn)}</p>
      </li>
      <li className="kpi">
        <p className="kpi-label">Tokens out</p>
        <p className="kpi-value">{count(tokensOut)}</p>
      </li>
      <li className="kpi">
        <p className="kpi-label">Model time</p>
        <p className="kpi-value">{timed.length > 0 ? `${seconds.toFixed(1)} s` : "–"}</p>
        {timed.length < trace.model_calls.length && timed.length > 0 && (
          <p className="kpi-sub">
            Timed on {timed.length} of {trace.model_calls.length} calls
          </p>
        )}
      </li>
    </ul>
  );
}

function cents(value: number): string {
  return value < 1 ? `${(value * 100).toFixed(1)}¢` : dollars(value);
}

/** How the claim ended up, first: the decision, its reason and what it cites. */
function Outcome({ claimId, trace }: { claimId: string; trace: Trace }) {
  const outcome = trace.outcome;
  return (
    <div className="panel trace-outcome">
      <h2 className="trace-title">{claimId}</h2>
      <p className="trace-summary" dir="auto">
        {trace.summary}
      </p>
      {outcome ? (
        <>
          <p className="trace-decision">
            <strong>
              {OUTCOMES[outcome.decision]}
              {outcome.decision === "approve" ? ` ${dollars(outcome.payout)}` : ""}
            </strong>
            <span className="muted small">
              {" "}
              by {outcome.decided_by}, {when(outcome.decided_at)}
            </span>
          </p>
          {/* The agent's own words: text only, never markup. */}
          <p className="prose" dir="auto">
            {outcome.reason}
          </p>
          <p className="small muted">
            Cites {outcome.section || "nothing"}
            {trace.config_version === null
              ? ""
              : ` · claim agent version ${String(trace.config_version)}`}
          </p>
        </>
      ) : (
        <p className="muted small">Not decided yet ({trace.status.replaceAll("_", " ")}).</p>
      )}
    </div>
  );
}

function EntryRow({ entry }: { entry: Entry }) {
  if (entry.type === "model") {
    const { call } = entry;
    return (
      <li className="trace-model">
        <Bot size={14} strokeWidth={1.75} aria-hidden="true" />
        <span>
          Claude {modelName(call.model)} · {call.input_tokens.toLocaleString("en-AU")} in /{" "}
          {call.output_tokens.toLocaleString("en-AU")} out · ${call.cost.toFixed(4)}
          {call.latency_ms === null ? "" : ` · ${(call.latency_ms / 1000).toFixed(1)}s`}
        </span>
      </li>
    );
  }
  return (
    <li className={`trace-step ${entry.tone}`}>
      <details>
        <summary>
          <span className="trace-label">
            {entry.tone === "warn" && (
              <CircleAlert size={14} strokeWidth={1.75} aria-hidden="true" />
            )}
            {entry.label}
          </span>
          <span className="muted small nowrap">{when(entry.at)}</span>
          <ChevronDown className="chevron" size={16} strokeWidth={1.75} aria-hidden="true" />
        </summary>
        {/* Recorded content, some of it the claim's or a model's words: text only. */}
        <pre className="code" dir="auto">
          {entry.content}
        </pre>
        {entry.result !== null && (
          <>
            <p className="small muted trace-result-label">What came back</p>
            <pre className="code" dir="auto">
              {entry.result}
            </pre>
          </>
        )}
      </details>
    </li>
  );
}

/** The controls this claim went through, each a word and an icon. */
function Security({ trace }: { trace: Trace }) {
  const screening = trace.steps.find((step) => step.kind === "screening");
  const flagged = screening?.content.startsWith("Instructions found") ?? false;
  const unscoped = unscopedCalls(trace);
  const toolCalls = trace.steps.filter((step) => step.kind === "tool_call").length;
  const trouble = trace.steps.filter((s) => s.kind === "refusal" || s.kind === "error").length;
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Security</h2>
      </div>
      <ul className="trace-checks">
        <li>
          {!screening ? (
            <span className="chip">
              <CircleAlert size={13} strokeWidth={1.75} aria-hidden="true" />
              Not screened
            </span>
          ) : flagged ? (
            <span className="chip chip-warn">
              <ShieldAlert size={13} strokeWidth={1.75} aria-hidden="true" />
              Screening flagged it
            </span>
          ) : (
            <span className="chip chip-good">
              <ShieldCheck size={13} strokeWidth={1.75} aria-hidden="true" />
              Screened first: clean
            </span>
          )}
        </li>
        <li>
          {unscoped.length === 0 ? (
            <span className="chip chip-good">
              <ShieldCheck size={13} strokeWidth={1.75} aria-hidden="true" />
              {`All ${String(toolCalls)} tool calls took the claim from the session`}
            </span>
          ) : (
            <span className="chip chip-warn">
              <ShieldAlert size={13} strokeWidth={1.75} aria-hidden="true" />
              {`Passed an id itself: ${unscoped.join(", ")}`}
            </span>
          )}
        </li>
        <li>
          {trouble === 0 ? (
            <span className="chip chip-good">
              <ShieldCheck size={13} strokeWidth={1.75} aria-hidden="true" />
              No refusals or errors
            </span>
          ) : (
            <span className="chip chip-warn">
              <CircleAlert size={13} strokeWidth={1.75} aria-hidden="true" />
              {`${String(trouble)} ${trouble === 1 ? "refusal or error" : "refusals or errors"}`}
            </span>
          )}
        </li>
      </ul>
    </div>
  );
}

/** Where the money went: by model, against the average live claim, and how the context grew. */
function Cost({ trace }: { trace: Trace }) {
  const byModel = new Map<string, { calls: number; cost: number }>();
  for (const call of trace.model_calls) {
    const name = modelName(call.model);
    const now = byModel.get(name) ?? { calls: 0, cost: 0 };
    byModel.set(name, { calls: now.calls + 1, cost: now.cost + call.cost });
  }
  const inputs = trace.model_calls.map((call) => call.input_tokens);
  const average = trace.average_cost;
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Cost</h2>
        <p className="panel-note">{dollars(trace.total_cost)}</p>
      </div>
      {average !== null && average > 0 && (
        <p className="small">
          {cents(trace.total_cost)}, {(trace.total_cost / average).toFixed(1)}× the average live
          claim ({cents(average)}, last 30 days).
        </p>
      )}
      <dl className="stage-rows">
        {[...byModel].map(([name, found]) => (
          <div key={name}>
            <dt>
              Claude {name} × {found.calls}
            </dt>
            <dd>${found.cost.toFixed(4)}</dd>
          </div>
        ))}
      </dl>
      {inputs.length > 1 && (
        <>
          <h3 className="live-sub">Input tokens per call</h3>
          <Sparkline
            values={inputs}
            label={`Input tokens per model call, in order: ${inputs.join(", ")}`}
          />
          <p className="small muted">
            From {inputs[0]?.toLocaleString("en-AU")} to {inputs.at(-1)?.toLocaleString("en-AU")}:
            each call re-reads the conversation so far.
          </p>
        </>
      )}
    </div>
  );
}

/** One claim's model calls, tokens, cost and steps: what the agent spent and did. Opened from a
 * claim's link it loads straight away; otherwise it suggests the live claim with the most model
 * calls lately, ready to show. */
export function TracePage({ api, claimId: opened }: { api: Api; claimId?: string }) {
  const heading = useFocusHeading();
  const [claimId, setClaimId] = useState(opened ?? "");
  const [shown, setShown] = useState<{ claimId: string; trace: Trace } | null>(null);
  const [loading, setLoading] = useState(Boolean(opened));
  const [error, setError] = useState<string | null>(null);
  // Each lookup's number: only the latest one may show its answer, so a slow earlier lookup
  // never replaces a later claim's trace.
  const latest = useRef(0);

  // Fetch a trace and show it; the caller has already set it loading.
  const fetchTrace = useCallback(
    (wanted: string, live: () => boolean) => {
      api
        .getTrace(wanted)
        .then(
          (trace) => {
            if (live()) setShown({ claimId: wanted, trace });
          },
          (caught: unknown) => {
            if (!live()) return;
            setShown(null);
            setError(caught instanceof Error ? caught.message : String(caught));
          },
        )
        .finally(() => {
          if (live()) setLoading(false);
        });
    },
    [api],
  );

  useEffect(() => {
    let live = true;
    if (opened) {
      // Opened from a claim's link: it starts loading.
      fetchTrace(opened, () => live);
    } else {
      // A suggestion is a convenience: if it can't load, the box is simply left empty.
      api.suggestTrace().then(
        (found) => {
          if (!live || found.claim_id === null) return;
          const id = found.claim_id;
          setClaimId((now) => now || id);
          // The fullest trace opens straight away; another claim number replaces it.
          setLoading(true);
          fetchTrace(id, () => live);
        },
        () => undefined,
      );
    }
    return () => {
      live = false;
    };
  }, [api, opened, fetchTrace]);

  function look(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    latest.current += 1;
    const mine = latest.current;
    fetchTrace(claimId.trim().toUpperCase(), () => latest.current === mine);
  }

  const trace = shown?.trace;
  return (
    <section className="view" aria-labelledby="trace-heading">
      <header className="page-head">
        <div>
          <p className="eyebrow">Observe · Trace</p>
          <h1 id="trace-heading" ref={heading} tabIndex={-1}>
            Claim trace
          </h1>
        </div>
        <form className="trace-form" onSubmit={look}>
          <div className="field">
            <label htmlFor="trace-claim">Claim</label>
            <Search size={15} strokeWidth={1.75} aria-hidden="true" />
            <input
              id="trace-claim"
              placeholder="CLM-1017"
              pattern="[Cc][Ll][Mm]-[0-9]{1,10}"
              value={claimId}
              onChange={(event) => {
                setClaimId(event.target.value);
              }}
            />
          </div>
          <button type="submit" className="button" disabled={!claimId.trim()}>
            Show
          </button>
        </form>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loading && (
        <p role="status" className="loading">
          <LoaderCircle className="spin" size={16} strokeWidth={1.75} aria-hidden="true" />
          Loading the trace…
        </p>
      )}
      {shown && trace && (
        <>
          <Outcome claimId={shown.claimId} trace={trace} />
          <Totals trace={trace} />
          <div className="cols wide-side">
            <div className="panel">
              <div className="panel-head">
                <h2>What happened</h2>
                <p className="panel-note">
                  Steps and model calls in order. Open a step for its data.
                </p>
              </div>
              {trace.steps.length === 0 && trace.model_calls.length === 0 ? (
                <p className="muted">Nothing was recorded for this claim.</p>
              ) : (
                <ol className="trace-timeline">
                  {timeline(trace).map((entry, index) => (
                    <EntryRow key={`${entry.type}-${String(index)}`} entry={entry} />
                  ))}
                </ol>
              )}
            </div>
            <div className="stack">
              <Security trace={trace} />
              <Cost trace={trace} />
            </div>
          </div>
        </>
      )}
      {!loading && <RecentTraces api={api} />}
    </section>
  );
}
