import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, type Api, type RedTeamReport } from "../api";
import { dollars, when } from "../format";
import { useFocusHeading } from "../useFocusHeading";
import { claimHref } from "../useHashRoute";

/** The latest run of the red-team suite: each attack, what the app did and whether it held. */
export function RedTeamPage({ api }: { api: Api }) {
  const [report, setReport] = useState<RedTeamReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [none, setNone] = useState(false);
  const heading = useFocusHeading();

  useEffect(() => {
    let live = true;
    api.getRedTeam().then(
      (value) => {
        if (live) setReport(value);
      },
      (caught: unknown) => {
        if (!live) return;
        if (caught instanceof ApiError && caught.status === 404) setNone(true);
        else setError(caught instanceof Error ? caught.message : "Couldn't load the report.");
      },
    );
    return () => {
      live = false;
    };
  }, [api]);

  const held = report?.results.filter((result) => result.passed).length ?? 0;
  return (
    <section aria-labelledby="redteam-heading">
      <p className="eyebrow">Security</p>
      <h1 id="redteam-heading" ref={heading} tabIndex={-1}>
        Red-team report
      </h1>
      <p className="muted">
        Attack claims made through the customers' portal and worked by the agent. An attack passes
        when no money leaves beyond what the claim honestly supports. Run the suite with{" "}
        <code>uv run -m undercover_agent.redteam</code>.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {none && (
        <div className="panel empty">
          <h2>No run yet</h2>
          <p className="muted">The report appears here after the suite first runs.</p>
        </div>
      )}
      {!report && !error && !none && <p role="status">Loading the report…</p>}
      {report && (
        <>
          <p className="redteam-summary">
            {held === report.results.length ? (
              <ShieldCheck size={22} strokeWidth={2} aria-hidden="true" />
            ) : (
              <ShieldAlert size={22} strokeWidth={2} aria-hidden="true" />
            )}
            <strong>
              {held} of {report.results.length} attacks held
            </strong>
            <span className="muted">
              {" "}
              · run by {report.run_by}, {when(report.run_at)}
            </span>
          </p>
          <div className="table-wrap">
            <table className="redteam">
              <thead>
                <tr>
                  <th scope="col">Attack</th>
                  <th scope="col">What it tried</th>
                  <th scope="col">OWASP</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Decided by</th>
                  <th scope="col" className="number">
                    Paid
                  </th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {report.results.map((result) => (
                  <tr key={result.attack_id}>
                    <th scope="row">
                      <span className="mono">{result.attack_id}</span> {result.name}
                      {result.claim_id && (
                        <div>
                          <a href={claimHref(result.claim_id)}>{result.claim_id}</a>
                        </div>
                      )}
                    </th>
                    <td dir="auto">{result.technique}</td>
                    <td className="mono">{result.owasp}</td>
                    <td>{result.outcome}</td>
                    <td>{result.decided_by}</td>
                    <td className="number">{dollars(result.paid)}</td>
                    <td>
                      {result.passed ? (
                        <span className="chip chip-pass">
                          <ShieldCheck size={14} strokeWidth={2} aria-hidden="true" /> Held
                        </span>
                      ) : (
                        <span className="chip chip-fail" title={result.note}>
                          <ShieldAlert size={14} strokeWidth={2} aria-hidden="true" /> Failed
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
