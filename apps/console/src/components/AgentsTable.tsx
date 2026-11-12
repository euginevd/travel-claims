import type { ThreatCoverage } from "../api";
import { TableScroll } from "./TableScroll";

/** Every model in UnderCover: its tools and what it reads, the worst it could do if an attack
 * tricked it, and what stops that. */
export function AgentsTable({ agents }: { agents: ThreatCoverage["agents"] }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>What each agent could do if tricked</h2>
        <p className="panel-note">No agent pays on its own: payouts and limits are code</p>
      </div>
      {agents.length === 0 ? (
        <p className="muted small">No agents are listed.</p>
      ) : (
        <TableScroll label="Agents table">
          <table className="table min-wide">
            <thead>
              <tr>
                <th scope="col">Agent</th>
                <th scope="col">Can use and read</th>
                <th scope="col">Worst case if tricked</th>
                <th scope="col">What stops it</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.agent}>
                  <th scope="row">
                    {agent.agent}
                    <span className="sub mono">{agent.model}</span>
                  </th>
                  <td className="prose">
                    {agent.tools}
                    <span className="sub">Reads {agent.sources}</span>
                  </td>
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
