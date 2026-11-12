import type { ThreatCoverage } from "../api";
import { TableScroll } from "./TableScroll";

/** Every model in UnderCover: its tools, what it reads, the worst it could do if an attack
 * tricked it, and what stops that. A part of the coverage page. */
export function AgentsTable({ agents }: { agents: ThreatCoverage["agents"] }) {
  const coverage = { agents };
  return (
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
  );
}
