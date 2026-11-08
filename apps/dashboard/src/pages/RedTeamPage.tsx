import { LoaderCircle, Play, ShieldAlert, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type Api, type Handler, type RedTeamStatus } from "../api";
import { dollars, when } from "../format";
import { useFocusHeading } from "../useFocusHeading";
import { claimHref } from "../useHashRoute";

// How often the page checks on a run while it's going.
export const REDTEAM_POLL_MS = 3000;

/** The red-team suite: a senior runs it from here, then each attack, what the app did and
 * whether it held. */
export function RedTeamPage({
  api,
  handler,
  pollMs = REDTEAM_POLL_MS,
}: {
  api: Api;
  handler: Handler;
  pollMs?: number;
}) {
  const [status, setStatus] = useState<RedTeamStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const inFlight = useRef(false);
  const heading = useFocusHeading();

  const load = useCallback(() => {
    return api.getRedTeam().then(
      (value) => {
        setStatus(value);
      },
      (caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Couldn't load the report.");
      },
    );
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  // While a run is going, check on it every few seconds until its report arrives.
  const running = status?.running ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      void load();
    }, pollMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [running, load, pollMs]);

  async function run() {
    if (inFlight.current) return;
    inFlight.current = true;
    setStarting(true);
    setError(null);
    try {
      setStatus(await api.startRedTeam());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Couldn't start the red team.");
      void load();
    } finally {
      inFlight.current = false;
      setStarting(false);
    }
  }

  const report = status?.report ?? null;
  const senior = handler.can_approve_over_limit;
  const held = report?.results.filter((result) => result.passed).length ?? 0;
  return (
    <section aria-labelledby="redteam-heading">
      <p className="eyebrow">Security</p>
      <h1 id="redteam-heading" ref={heading} tabIndex={-1}>
        Red-team report
      </h1>
      <p className="muted">
        Attack claims made through the customers' portal and worked by the agent. An attack passes
        when no money leaves beyond what the claim honestly supports.
      </p>
      <div className="redteam-run panel">
        <div>
          <button
            type="button"
            className="button"
            onClick={() => {
              void run();
            }}
            disabled={!senior || running || starting || !status}
          >
            {running || starting ? (
              <LoaderCircle className="spin" size={16} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Play size={16} strokeWidth={2} aria-hidden="true" />
            )}
            {running ? "Running…" : "Run the red team"}
          </button>
        </div>
        <p className="muted small">
          {senior
            ? "Makes 8 attack claims as a test customer and has the agent work them. About $0.002 of Claude, a few minutes."
            : "Only a senior handler can run the red team."}
        </p>
        {running && (
          <p role="status" className="redteam-progress">
            Running 8 attack claims
            {status?.started_by ? `, started by ${status.started_by}` : ""}
            {status?.started_at ? ` ${when(status.started_at)}` : ""}… The report appears here when
            they're done.
          </p>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {status && !report && !running && (
        <div className="panel empty">
          <h2>No run yet</h2>
          <p className="muted">
            {senior
              ? "Run the red team to see how the app stands up to attack claims."
              : "The report appears here after a senior handler first runs the red team."}
          </p>
        </div>
      )}
      {!status && !error && <p role="status">Loading the report…</p>}
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
                        <span className="chip chip-good">
                          <ShieldCheck size={14} strokeWidth={2} aria-hidden="true" /> Held
                        </span>
                      ) : (
                        <span className="chip chip-bad" title={result.note}>
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
