import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Api, ThreatCoverage } from "../api";
import { TableScroll } from "../components/TableScroll";
import { useFocusHeading } from "../useFocusHeading";

/** Every model in UnderCover: its tools, what it reads, the worst it could do if an attack
 * tricked it, and what stops that. */
export function AgentsPage({ api }: { api: Api }) {
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
    <section className="view" aria-labelledby="agents-heading">
      <header className="page-head">
        <div>
          <p className="eyebrow">Security · Agents</p>
          <h1 id="agents-heading" ref={heading} tabIndex={-1}>
            What each agent could do if tricked
          </h1>
          <p className="lede">
            Every model in UnderCover, with its tools and what it reads. Payments and limits are
            code, so no agent pays on its own.
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
          Loading the agents…
        </p>
      )}
      {coverage && (
        <div className="panel">
          <div className="panel-head">
            <h2>Agents</h2>
            <p className="panel-note">The worst case if an attack tricked each one</p>
          </div>
          {coverage.agents.length === 0 ? (
            <p className="muted small">No agents are listed.</p>
          ) : (
            <TableScroll label="Agents table">
              <table className="table min-wide">
                <thead>
                  <tr>
                    <th scope="col">Agent</th>
                    <th scope="col">Model</th>
                    <th scope="col">Tools</th>
                    <th scope="col">Reads</th>
                    <th scope="col">Worst case if tricked</th>
                    <th scope="col">What stops it</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.agents.map((agent) => (
                    <tr key={agent.agent}>
                      <th scope="row">{agent.agent}</th>
                      <td>
                        <span className="tag mono">{agent.model}</span>
                      </td>
                      <td className="prose">{agent.tools}</td>
                      <td className="prose">{agent.sources}</td>
                      <td className="prose">{agent.worst_case}</td>
                      <td className="prose">{agent.stopped_by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </div>
      )}
    </section>
  );
}
