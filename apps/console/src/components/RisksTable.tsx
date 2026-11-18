import { CircleCheck, CircleX, LoaderCircle, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Api, ThreatCoverage } from "../api";
import { when } from "../format";
import { TableScroll } from "./TableScroll";

type Framework = ThreatCoverage["frameworks"][number];
type Row = Framework["risks"][number];

const STATUS: Record<Row["status"], { label: string; tone: string }> = {
  tested: { label: "Tested", tone: "chip-good" },
  failing: { label: "Got through", tone: "chip-bad" },
  built_in: { label: "Built in", tone: "chip-info" },
  gap: { label: "Gap", tone: "chip-warn" },
  na: { label: "Doesn't apply", tone: "" },
};

/** The attacks testing a risk, each with whether it held; the IDs match the red team's. */
function Tests({ row }: { row: Row }) {
  if (row.attacks.length === 0) {
    return <span className="muted small">{row.note || "No attack yet"}</span>;
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

/** "10 of 10 mapped · 6 tested · 2 gaps", worked out by the api. */
function coverageLine(framework: Framework): string {
  const parts = [
    `${String(framework.mapped)} of ${String(framework.risks.length)} mapped`,
    `${String(framework.tested)} tested`,
  ];
  if (framework.failing > 0) parts.push(`${String(framework.failing)} got through`);
  if (framework.built_in > 0) parts.push(`${String(framework.built_in)} built in`);
  parts.push(`${String(framework.gaps)} ${framework.gaps === 1 ? "gap" : "gaps"}`);
  return parts.join(" · ");
}

/** Each risk in the chosen framework (OWASP LLM 2026, OWASP Agentic 2026, the MCP Top 10 or
 * MAESTRO's layers) with our control, the attacks that test it, its status and when its
 * guardrail last fired. A part of the Posture page. */
export function RisksTable({ api }: { api: Api }) {
  const [coverage, setCoverage] = useState<ThreatCoverage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [chosen, setChosen] = useState<Framework["key"]>("llm");
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
      // A quiet status, not an alert: the rest of the page still works without this part.
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
  const framework =
    coverage.frameworks.find((found) => found.key === chosen) ?? coverage.frameworks[0];
  if (!framework) return null;
  const layers = framework.key === "maestro";
  return (
    // The page's last row: it fills the window and its rows scroll inside.
    <div className="panel fill">
      <div className="panel-head">
        <h2>Coverage</h2>
        <fieldset className="seg">
          <legend>Framework</legend>
          <div className="seg-track">
            {coverage.frameworks.map((found) => (
              <label key={found.key} className="seg-option">
                <input
                  type="radio"
                  name="coverage-framework"
                  checked={found.key === framework.key}
                  onChange={() => {
                    setChosen(found.key);
                  }}
                />
                <span>
                  {found.name.replace(/^OWASP /, "")} <small>{found.version}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="panel-note">
          {framework.name}: {coverageLine(framework)}
        </p>
      </div>
      <TableScroll label={`${framework.name} coverage table`}>
        <table className="table min-wide">
          <thead>
            <tr>
              <th scope="col">{layers ? "Layer" : "Risk"}</th>
              <th scope="col">Our control</th>
              <th scope="col">Tested by</th>
              <th scope="col">Status</th>
              <th scope="col">Fired live</th>
            </tr>
          </thead>
          <tbody>
            {framework.risks.map((row) => (
              <tr key={row.id}>
                <th scope="row">
                  <span className="tag tag-owasp">{row.id}</span> {row.risk}
                  {row.was && <span className="sub mono">was {row.was} (2025)</span>}
                  {row.atlas && <span className="sub mono">MITRE ATLAS {row.atlas}</span>}
                </th>
                <td className="prose">{row.control}</td>
                <td>
                  <Tests row={row} />
                </td>
                <td className="nowrap">
                  <span className={`chip ${STATUS[row.status].tone}`}>
                    {STATUS[row.status].label}
                  </span>
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
  );
}
