import { CircleCheck, CircleX, Lock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Api, ThreatCoverage } from "../api";
import { when } from "../format";
import { useFocusHeading } from "../useFocusHeading";

/** Each OWASP risk for LLM and agentic apps, its control, the attacks that test it and their last
 * result, when its guardrail last fired, the agents with their tools, and the payouts switch. */
export function ThreatsPage({ api }: { api: Api }) {
  const heading = useFocusHeading();
  const [coverage, setCoverage] = useState<ThreatCoverage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const load = useCallback(() => {
    setError(null);
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    let live = true;
    api.getThreats().then(
      (found) => {
        if (live) setCoverage(found);
      },
      (caught: unknown) => {
        if (live) setError(caught instanceof Error ? caught.message : String(caught));
      },
    );
    return () => {
      live = false;
    };
  }, [api, generation]);

  return (
    <section aria-labelledby="threats-heading">
      <p className="eyebrow">Security · Threat coverage</p>
      <h1 id="threats-heading" ref={heading} tabIndex={-1}>
        Threat coverage
      </h1>
      <p className="muted">
        OWASP Top 10 for LLM and agentic applications, mapped to MITRE ATLAS where a technique
        matches.{" "}
        {coverage?.redteam_run_at
          ? `Red team last run ${when(coverage.redteam_run_at)}.`
          : "The red team has not run yet."}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
          <button type="button" className="button secondary" onClick={load}>
            Try again
          </button>
        </p>
      )}
      {!coverage && !error && <p role="status">Loading the threat coverage…</p>}
      {coverage && (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Risk</th>
                  <th scope="col">ATLAS</th>
                  <th scope="col">Control</th>
                  <th scope="col">Tested by</th>
                  <th scope="col">Guardrail fired</th>
                </tr>
              </thead>
              <tbody>
                {coverage.threats.map((row) => (
                  <tr key={row.owasp}>
                    <th scope="row">
                      <span className="mono">{row.owasp}</span> {row.risk}
                    </th>
                    <td className="mono">{row.atlas || "–"}</td>
                    <td>{row.control}</td>
                    <td>
                      {row.attacks.length === 0
                        ? "–"
                        : row.attacks.map((attack) => (
                            <span key={attack.attack_id} className="nowrap attack">
                              {attack.passed ? (
                                <CircleCheck size={14} strokeWidth={2} aria-label="Held" />
                              ) : (
                                <CircleX size={14} strokeWidth={2} aria-label="Failed" />
                              )}
                              {attack.attack_id}
                            </span>
                          ))}
                    </td>
                    <td>
                      {row.fired > 0 && row.last_fired
                        ? `${String(row.fired)} times, last ${when(row.last_fired)}`
                        : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2>Agents</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col">Model</th>
                  <th scope="col">Tools</th>
                  <th scope="col">Reads</th>
                </tr>
              </thead>
              <tbody>
                {coverage.agents.map((agent) => (
                  <tr key={agent.agent}>
                    <th scope="row">{agent.agent}</th>
                    <td className="mono">{agent.model}</td>
                    <td>{agent.tools}</td>
                    <td>{agent.sources}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="panel payouts-readonly">
            <Lock size={16} strokeWidth={2} aria-hidden="true" /> Payouts switch:{" "}
            <strong>{coverage.payouts.paused ? "paused" : "on"}</strong>, owned by senior handlers
            {coverage.payouts.changed_at
              ? `, last changed ${when(coverage.payouts.changed_at)} by ${coverage.payouts.changed_by ?? "a handler"}`
              : ""}
            . Read-only here.
          </p>
        </>
      )}
    </section>
  );
}
