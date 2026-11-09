import { Search } from "lucide-react";
import { useState, type SubmitEvent } from "react";
import type { Api, Trace } from "../api";
import { dollars, when } from "../format";
import { useFocusHeading } from "../useFocusHeading";

/** One claim's model calls, tokens, cost and steps: what the agent spent and did. */
export function TracePage({ api }: { api: Api }) {
  const heading = useFocusHeading();
  const [claimId, setClaimId] = useState("");
  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState<string | null>(null);

  function look(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    api.getTrace(claimId.trim().toUpperCase()).then(setTrace, (caught: unknown) => {
      setTrace(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    });
  }

  return (
    <section aria-labelledby="trace-heading">
      <p className="eyebrow">Quality · Claim trace</p>
      <h1 id="trace-heading" ref={heading} tabIndex={-1}>
        Claim trace
      </h1>
      <form className="panel trace-form" onSubmit={look}>
        <label htmlFor="trace-claim">Claim</label>
        <input
          id="trace-claim"
          placeholder="CLM-1017"
          pattern="[Cc][Ll][Mm]-[0-9]{1,10}"
          value={claimId}
          onChange={(event) => {
            setClaimId(event.target.value);
          }}
        />
        <button type="submit" className="button" disabled={!claimId.trim()}>
          <Search size={16} strokeWidth={2} aria-hidden="true" />
          Show
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {trace && (
        <>
          <p>
            {trace.model_calls.length} model calls · {trace.total_tokens.toLocaleString("en-AU")}{" "}
            tokens · {dollars(trace.total_cost)}
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col">Tokens in / out</th>
                  <th scope="col">Cost</th>
                  <th scope="col">Time</th>
                </tr>
              </thead>
              <tbody>
                {trace.model_calls.map((call, index) => (
                  <tr key={index}>
                    <td className="mono">{call.model}</td>
                    <td>
                      {call.input_tokens} / {call.output_tokens}
                    </td>
                    <td>${call.cost.toFixed(4)}</td>
                    <td>
                      {call.latency_ms === null ? "–" : `${(call.latency_ms / 1000).toFixed(1)}s`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ol className="trace-steps">
            {trace.steps.map((step) => (
              <li key={step.step_id}>
                <details>
                  <summary>
                    <strong>{step.kind}</strong>{" "}
                    <span className="muted small">{when(step.created_at)}</span>
                  </summary>
                  <pre dir="auto">{step.content}</pre>
                </details>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
