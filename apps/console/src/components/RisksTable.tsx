import { CircleCheck, CircleX, LoaderCircle, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Api, ThreatCoverage } from "../api";
import { when } from "../format";
import { TableScroll } from "./TableScroll";

/** The attacks testing a risk, each with whether it held; the IDs match the attacks above. */
function Tests({ row }: { row: ThreatCoverage["threats"][number] }) {
  if (row.attacks.length === 0) {
    return <span className="chip chip-warn">No attack yet</span>;
  }
  return (
    <span className="test-ids">
      {row.attacks.map((attack) => (
        <span key={attack.attack_id} className="tag mono" title={attack.name}>
          {attack.passed ? (
            <CircleCheck className="held" size={13} strokeWidth={1.75} aria-label="Held" />
          ) : (
            <CircleX className="failed" size={13} strokeWidth={1.75} aria-label="Failed" />
          )}
          {attack.attack_id}
        </span>
      ))}
    </span>
  );
}

/** Each OWASP risk for LLM and agentic apps with its control, the attacks that test it and when
 * its guardrail last fired; then what each agent could do if tricked. A part of the red-team page. */
export function RisksTable({ api }: { api: Api }) {
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

  if (error) {
    return (
      // A quiet status, not an alert: the attacks above still work without this part.
      <p className="error" role="status">
        The risks couldn&apos;t be loaded: {error}
        <button type="button" className="button secondary" onClick={load}>
          Try again
        </button>
      </p>
    );
  }
  if (!coverage) {
    return (
      <p role="status" className="loading">
        <LoaderCircle className="spin" size={16} strokeWidth={1.75} aria-hidden="true" />
        Loading the risks…
      </p>
    );
  }
  const tested = coverage.threats.filter((row) => row.attacks.length > 0).length;
  return (
    <>
      {/* The page's last row: it fills the window and its rows scroll inside. */}
      <div className="panel fill">
        <div className="panel-head">
          <h2>Each risk and its control</h2>
          <p className="panel-note">
            OWASP Top 10 for LLM and agentic apps: {tested} of {coverage.threats.length} tested by
            an attack
          </p>
        </div>
        <TableScroll label="Risks and controls table">
          <table className="table min-wide">
            <thead>
              <tr>
                <th scope="col">Risk</th>
                <th scope="col">Control</th>
                <th scope="col">Tested by</th>
                <th scope="col">Fired live</th>
              </tr>
            </thead>
            <tbody>
              {coverage.threats.map((row) => (
                <tr key={row.owasp}>
                  <th scope="row">
                    <span className="tag tag-owasp">{row.owasp}</span> {row.risk}
                    {row.atlas && <span className="sub mono">MITRE ATLAS {row.atlas}</span>}
                  </th>
                  <td className="prose">{row.control}</td>
                  <td>
                    <Tests row={row} />
                  </td>
                  <td className="nowrap">
                    {row.fired > 0 && row.last_fired ? (
                      <>
                        <span className="chip chip-warn">
                          <Zap size={13} strokeWidth={1.75} aria-hidden="true" />
                          {`${String(row.fired)} ${row.fired === 1 ? "time" : "times"}`}
                        </span>
                        <span className="sub">last {when(row.last_fired)}</span>
                      </>
                    ) : (
                      <span className="muted">–</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </div>
    </>
  );
}
