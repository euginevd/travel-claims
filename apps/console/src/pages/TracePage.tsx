import { ChevronDown, LoaderCircle, ScrollText, Search } from "lucide-react";
import { useCallback, useEffect, useState, type SubmitEvent } from "react";
import type { Api, Trace } from "../api";
import { TableScroll } from "../components/TableScroll";
import { dollars, when } from "../format";
import { useFocusHeading } from "../useFocusHeading";

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

/** One claim's model calls, tokens, cost and steps: what the agent spent and did. Opened from a
 * claim's link it loads straight away; otherwise it suggests the live claim with the most model
 * calls lately, ready to show. */
export function TracePage({ api, claimId: opened }: { api: Api; claimId?: string }) {
  const heading = useFocusHeading();
  const [claimId, setClaimId] = useState(opened ?? "");
  const [suggested, setSuggested] = useState<{ claimId: string; calls: number } | null>(null);
  const [shown, setShown] = useState<{ claimId: string; trace: Trace } | null>(null);
  const [loading, setLoading] = useState(Boolean(opened));
  const [error, setError] = useState<string | null>(null);

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
          setSuggested({ claimId: id, calls: found.model_calls });
          setClaimId((now) => now || id);
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
    fetchTrace(claimId.trim().toUpperCase(), () => true);
  }

  const trace = shown?.trace;
  return (
    <section className="view" aria-labelledby="trace-heading">
      <header className="page-head">
        <div>
          <p className="eyebrow">Quality · Claim trace</p>
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
      {!shown && !loading && !error && (
        <div className="panel empty">
          <span className="icon-tile">
            <ScrollText size={19} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <h2>No claim open</h2>
          <p className="muted">
            {suggested
              ? `${suggested.claimId} is filled in: the live claim with the most model calls lately (${String(suggested.calls)}), so the fullest trace to read. Press Show, or enter another claim number.`
              : "Enter a claim number above to see each model call and step the agent made on it, and what it cost."}
          </p>
        </div>
      )}
      {shown && trace && (
        <>
          <div className="panel">
            <h2 className="trace-title">{shown.claimId}</h2>
            <p className="trace-summary">
              {trace.model_calls.length} model calls · {count(trace.total_tokens)} tokens ·{" "}
              {dollars(trace.total_cost)}
            </p>
          </div>
          <Totals trace={trace} />
          <div className="cols wide-side">
            <div className="panel">
              <div className="panel-head">
                <h2>What the agent did</h2>
                <p className="panel-note">In order. Open a step for its content.</p>
              </div>
              {trace.steps.length === 0 ? (
                <p className="muted">No steps were recorded for this claim.</p>
              ) : (
                <ol className="trace-steps">
                  {trace.steps.map((step) => (
                    <li key={step.step_id}>
                      <details>
                        <summary>
                          <strong>{step.kind}</strong>{" "}
                          <span className="muted small nowrap">{when(step.created_at)}</span>
                          <ChevronDown
                            className="chevron"
                            size={16}
                            strokeWidth={1.75}
                            aria-hidden="true"
                          />
                        </summary>
                        <pre className="code" dir="auto">
                          {step.content}
                        </pre>
                      </details>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div className="panel">
              <div className="panel-head">
                <h2>Model calls</h2>
                <p className="panel-note">
                  {trace.model_calls.length} calls · {dollars(trace.total_cost)}
                </p>
              </div>
              <TableScroll label="Model calls table">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Model</th>
                      <th scope="col" className="num">
                        Tokens in / out
                      </th>
                      <th scope="col" className="num">
                        Cost
                      </th>
                      <th scope="col" className="num">
                        Time
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {trace.model_calls.map((call, index) => (
                      <tr key={index}>
                        <td>
                          <span className="tag mono">{call.model}</span>
                        </td>
                        <td className="num">
                          {call.input_tokens} / {call.output_tokens}
                        </td>
                        <td className="num">${call.cost.toFixed(4)}</td>
                        <td className="num">
                          {call.latency_ms === null
                            ? "–"
                            : `${(call.latency_ms / 1000).toFixed(1)}s`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
