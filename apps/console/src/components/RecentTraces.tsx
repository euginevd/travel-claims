import { useEffect, useState } from "react";
import type { Api, TraceRow } from "../api";
import { when } from "../format";
import { traceHref } from "../useHashRoute";
import { TableScroll } from "./TableScroll";

const STATUS: Record<string, string> = {
  paid: "Paid",
  approved: "Approved",
  declined: "Declined",
  referred: "Referred",
  waiting_for_sign_off: "Waiting for sign-off",
  in_progress: "In progress",
  waiting: "Waiting",
};

/** The newest traces, as LangSmith and Langfuse open: each claim the agent worked with its
 * model calls, tokens, cost and time; a row opens its trace. */
export function RecentTraces({ api }: { api: Api }) {
  const [rows, setRows] = useState<TraceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.listTraces().then(
      (found) => {
        if (live) setRows(found);
      },
      (caught: unknown) => {
        if (live) setError(caught instanceof Error ? caught.message : String(caught));
      },
    );
    return () => {
      live = false;
    };
  }, [api]);

  if (error) return <p className="muted panel">Couldn&apos;t list the traces: {error}</p>;
  if (!rows) return <span className="skeleton skeleton-card" aria-hidden="true" />;
  if (rows.length === 0) {
    return (
      <div className="panel">
        <div className="panel-head">
          <h2>Recent traces</h2>
        </div>
        <p className="muted">
          No claim has been worked yet. Turn the agent on in the dashboard, or run the red team, and
          each claim it works is traced here: every step, model call and its cost.
        </p>
      </div>
    );
  }
  return (
    <section className="panel" aria-labelledby="traces-heading">
      <div className="panel-head">
        <h2 id="traces-heading">Recent traces</h2>
        <p className="panel-note">Newest first. A claim opens its trace</p>
      </div>
      <TableScroll label="Recent traces table">
        <table className="table min-wide">
          <thead>
            <tr>
              <th scope="col">Claim</th>
              <th scope="col">Outcome</th>
              <th scope="col" className="num">
                Model calls
              </th>
              <th scope="col" className="num">
                Tokens
              </th>
              <th scope="col" className="num">
                Cost
              </th>
              <th scope="col" className="num">
                Model time
              </th>
              <th scope="col">Started</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.claim_id}>
                <th scope="row">
                  <a className="mono" href={traceHref(row.claim_id)}>
                    {row.claim_id}
                  </a>
                  {row.red_team && <span className="tag tag-owasp">Red team</span>}
                  <span className="sub" dir="auto">
                    {row.summary}
                  </span>
                </th>
                <td>{STATUS[row.status] ?? row.status.replace(/_/g, " ")}</td>
                <td className="num">{row.model_calls}</td>
                <td className="num">{row.tokens.toLocaleString("en-AU")}</td>
                <td className="num">${row.cost.toFixed(4)}</td>
                <td className="num">{row.seconds.toFixed(1)} s</td>
                <td className="nowrap small">{when(row.started_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </section>
  );
}
