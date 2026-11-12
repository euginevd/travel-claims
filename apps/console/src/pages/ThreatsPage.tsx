import { CircleCheck, CircleX, LoaderCircle, Lock, Zap } from "lucide-react";
import { AgentsTable } from "../components/AgentsTable";
import { useCallback, useEffect, useState } from "react";
import type { Api, ThreatCoverage } from "../api";
import { TableScroll } from "../components/TableScroll";
import { when } from "../format";
import { useFocusHeading } from "../useFocusHeading";
import { REDTEAM_HREF } from "../useHashRoute";

/** The summary cards: built only from what the coverage already holds. */
function Summary({ coverage }: { coverage: ThreatCoverage }) {
  const threats = coverage.threats;
  const controlled = threats.filter((row) => row.control.trim()).length;
  const tested = threats.filter((row) => row.attacks.length > 0).length;
  // An attack can test several risks; count each once.
  const attacks = new Map(
    threats.flatMap((row) => row.attacks.map((attack) => [attack.attack_id, attack.passed])),
  );
  const held = [...attacks.values()].filter(Boolean).length;
  const fired = threats.filter((row) => row.fired > 0);
  const lastFired = fired
    .map((row) => row.last_fired)
    .filter((value) => value !== null)
    .sort()
    .at(-1);
  return (
    <ul className="kpis lead-wide" aria-label="Coverage at a glance">
      <li className="kpi">
        <p className="kpi-label">Risks with a control</p>
        <p className="kpi-value">
          {controlled} of {threats.length}
        </p>
        <ul className="coverage" aria-hidden="true">
          {threats.map((row) => (
            <li key={row.owasp} className={row.attacks.length > 0 ? "tested" : undefined} />
          ))}
        </ul>
        <p className="coverage-key">
          <span className="tested">Tested by the red team ({tested})</span>
          <span>No attack yet ({threats.length - tested})</span>
        </p>
      </li>
      <li className="kpi">
        <p className="kpi-label">Red-team attacks held</p>
        <p className="kpi-value">
          {attacks.size > 0 ? `${String(held)} of ${String(attacks.size)}` : "–"}
        </p>
        <p className="kpi-sub">
          {coverage.redteam_run_at ? `Last run ${when(coverage.redteam_run_at)}` : "Not run yet"}
        </p>
      </li>
      <li className="kpi">
        <p className="kpi-label">Risks whose guardrail has fired</p>
        <p className="kpi-value">
          {fired.length} of {threats.length}
        </p>
        <p className="kpi-sub">{lastFired ? `Last ${when(lastFired)}` : "None has fired yet"}</p>
      </li>
    </ul>
  );
}

/** Each OWASP risk for LLM and agentic apps, its control, the attacks that test it and their last
 * result, when its guardrail last fired, and the payouts switch. Then the agents: what each could do if tricked. */
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
    <section className="view" aria-labelledby="threats-heading">
      <header className="page-head">
        <div>
          <p className="eyebrow">Security · Coverage</p>
          <h1 id="threats-heading" ref={heading} tabIndex={-1}>
            Threat coverage
          </h1>
          <p className="lede">
            OWASP Top 10 for LLM and agentic applications, mapped to MITRE ATLAS where a technique
            matches.{" "}
            {coverage?.redteam_run_at
              ? `Red team last run ${when(coverage.redteam_run_at)}.`
              : "The red team has not run yet."}
          </p>
        </div>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
          <button type="button" className="button secondary" onClick={load}>
            Try again
          </button>
        </p>
      )}
      {!coverage && !error && (
        <p role="status" className="loading">
          <LoaderCircle className="spin" size={16} strokeWidth={1.75} aria-hidden="true" />
          Loading the threat coverage…
        </p>
      )}
      {coverage && (
        <>
          <Summary coverage={coverage} />
          <div className="panel">
            <div className="panel-head">
              <h2>Risks and controls</h2>
              <p className="panel-note">A test ID opens the red-team report.</p>
            </div>
            <TableScroll label="Risks and controls table">
              <table className="table min-wide">
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
                        <span className="tag tag-owasp">{row.owasp}</span>
                        <span className="sub">{row.risk}</span>
                      </th>
                      <td className="mono nowrap">{row.atlas || "–"}</td>
                      <td className="prose">{row.control}</td>
                      <td>
                        {row.attacks.length === 0 ? (
                          <span className="muted small">Not red-teamed yet</span>
                        ) : (
                          row.attacks.map((attack) => (
                            <a
                              key={attack.attack_id}
                              className="tag mono"
                              href={REDTEAM_HREF}
                              title={attack.name}
                            >
                              {attack.passed ? (
                                <CircleCheck
                                  className="held"
                                  size={13}
                                  strokeWidth={1.75}
                                  aria-label="Held"
                                />
                              ) : (
                                <CircleX
                                  className="failed"
                                  size={13}
                                  strokeWidth={1.75}
                                  aria-label="Failed"
                                />
                              )}
                              {attack.attack_id}
                            </a>
                          ))
                        )}
                      </td>
                      <td>
                        {row.fired > 0 && row.last_fired ? (
                          <span className="chip chip-warn">
                            <Zap size={13} strokeWidth={1.75} aria-hidden="true" />
                            {`${String(row.fired)} ${row.fired === 1 ? "time" : "times"}, last ${when(row.last_fired)}`}
                          </span>
                        ) : (
                          "–"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </div>
          <p className="panel payouts-readonly">
            <Lock size={16} strokeWidth={1.75} aria-hidden="true" />
            <span>
              Payouts switch: <strong>{coverage.payouts.paused ? "paused" : "on"}</strong>, owned by
              senior handlers
              {coverage.payouts.changed_at
                ? `, last changed ${when(coverage.payouts.changed_at)} by ${coverage.payouts.changed_by ?? "a handler"}`
                : ""}
              . Read-only here.
            </span>
          </p>
          <AgentsTable agents={coverage.agents} />
        </>
      )}
    </section>
  );
}
