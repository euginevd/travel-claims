import { LoaderCircle, Play, ShieldAlert, ShieldCheck, Target } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type Api, type AttackPlan, type RedTeamStatus } from "../api";
import { RingChart } from "../components/Charts";
import { TableScroll } from "../components/TableScroll";
import { dollars, when } from "../format";
import { useFocusHeading } from "@undercover/web-core/useFocusHeading";
import { traceHref } from "../useHashRoute";

// How often the page checks on a run while it's going.
export const REDTEAM_POLL_MS = 3000;

/** The OWASP IDs in a result's field, e.g. "LLM01, ASI01" -> ["LLM01", "ASI01"]. */
export function owaspIds(owasp: string): string[] {
  return owasp.split(/[\s,;/]+/).filter(Boolean);
}

/** The red-team suite: an AI engineer runs it from here, then each attack, what the app did and
 * whether it held. */
export function RedTeamPage({ api, pollMs = REDTEAM_POLL_MS }: { api: Api; pollMs?: number }) {
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

  // What a run tries, shown before the first run; the page works without it.
  const [plan, setPlan] = useState<AttackPlan[]>([]);
  useEffect(() => {
    let live = true;
    api.getAttacks().then(
      (found) => {
        if (live) setPlan(found);
      },
      () => {
        // No plan to show; the run button still works.
      },
    );
    return () => {
      live = false;
    };
  }, [api]);

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
  const held = report?.results.filter((result) => result.passed).length ?? 0;
  const allHeld = report !== null && held === report.results.length;
  // The layer each attack is built to get past, from the suite, beside where it was stopped.
  const aimedAt = new Map(plan.map((attack) => [attack.attack_id, attack.aimed_at]));
  return (
    <section className="view" aria-labelledby="redteam-heading">
      <header className="page-head">
        <div>
          <p className="eyebrow">Secure · Red team</p>
          <h1 id="redteam-heading" ref={heading} tabIndex={-1}>
            Red team
          </h1>
          <p className="lede">
            Attack claims made through the customers&apos; portal and worked by the agent, and the
            risk each one tests. An attack is held when no money leaves beyond what the claim
            honestly supports.
          </p>
        </div>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="cols redteam-top">
        {report ? (
          <div className={`panel verdict${allHeld ? " wash-sage" : " alert"}`}>
            <RingChart part={held} whole={report.results.length} />
            <div className="verdict-text">
              <p className="verdict-title">
                {allHeld ? (
                  <ShieldCheck size={24} strokeWidth={1.75} aria-hidden="true" />
                ) : (
                  <ShieldAlert size={24} strokeWidth={1.75} aria-hidden="true" />
                )}
                <strong>
                  {held} of {report.results.length} attacks held
                </strong>
              </p>
              <p className="muted">
                Run by {report.run_by}, {when(report.run_at)}
                {report.config_version === null
                  ? "."
                  : `, against claim agent version ${String(report.config_version)}.`}{" "}
                {dollars(report.results.reduce((sum, result) => sum + result.paid, 0))} paid across
                the attack claims.
              </p>
            </div>
          </div>
        ) : status && !running ? (
          <div className="panel">
            <div className="panel-head">
              <h2>
                <Target size={17} strokeWidth={1.75} aria-hidden="true" /> Not run yet
              </h2>
            </div>
            <p className="muted">
              The {plan.length > 0 ? String(plan.length) : ""} attacks below are what a run tries.
              Each is a real claim made through the customers&apos; portal, so every layer meets it
              the way it would meet a customer&apos;s.
            </p>
          </div>
        ) : (
          <div className="panel">
            {!status && !error && (
              <p role="status" className="loading">
                <LoaderCircle className="spin" size={16} strokeWidth={1.75} aria-hidden="true" />
                Loading the report…
              </p>
            )}
            {running && (
              <p className="muted">The first report appears here when the run is done.</p>
            )}
          </div>
        )}
        <div className="panel redteam-run">
          <div className="panel-head">
            <h2>Run the red team</h2>
          </div>
          <p className="muted small">
            Makes 9 attack claims as a test customer and has the agent work them. About $0.002 of
            Claude, a few minutes.
          </p>
          <button
            type="button"
            className="button wide"
            onClick={() => {
              void run();
            }}
            disabled={running || starting || !status}
          >
            {running || starting ? (
              <LoaderCircle className="spin" size={15} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Play size={15} strokeWidth={1.75} aria-hidden="true" />
            )}
            {running ? "Running…" : "Run the red team"}
          </button>
          {running && (
            <p role="status" className="redteam-progress small">
              Running 9 attack claims
              {status?.started_by ? `, started by ${status.started_by}` : ""}
              {status?.started_at ? ` ${when(status.started_at)}` : ""}… The report appears here
              when they're done.
            </p>
          )}
        </div>
      </div>
      {!report && plan.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h2>The attacks</h2>
            <p className="panel-note">What a run tries, and the risk each one tests</p>
          </div>
          <TableScroll label="Planned attacks table">
            <table className="table min-wide">
              <thead>
                <tr>
                  <th scope="col">Attack</th>
                  <th scope="col">What it tries</th>
                  <th scope="col">OWASP</th>
                  <th scope="col">Aimed at</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {plan.map((attack) => (
                  <tr key={attack.attack_id}>
                    <th scope="row" className="nowrap">
                      <span className="tag mono">{attack.attack_id}</span>
                    </th>
                    <td className="prose">
                      <strong>{attack.name}</strong>
                      <span className="sub" dir="auto">
                        {attack.technique}
                      </span>
                    </td>
                    <td>
                      {owaspIds(attack.owasp).map((id) => (
                        <span key={id} className="tag tag-owasp">
                          {id}
                        </span>
                      ))}
                    </td>
                    <td>{attack.aimed_at || "—"}</td>
                    <td className="muted">Not run</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </div>
      )}
      {report && (
        <div className="panel">
          <div className="panel-head">
            <h2>Attacks</h2>
            <p className="panel-note">Each one&apos;s claim opens its trace</p>
          </div>
          <TableScroll label="Attacks table">
            <table className="table min-wide">
              <thead>
                <tr>
                  <th scope="col">Attack</th>
                  <th scope="col">What it tried</th>
                  <th scope="col">OWASP</th>
                  <th scope="col">Aimed at</th>
                  <th scope="col">Stopped by</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {report.results.map((result) => (
                  <tr key={result.attack_id}>
                    <th scope="row" className="nowrap">
                      <span className="tag mono">{result.attack_id}</span>
                      {result.claim_id && (
                        <a className="sub mono" href={traceHref(result.claim_id)}>
                          {result.claim_id}
                        </a>
                      )}
                    </th>
                    <td className="prose">
                      <strong>{result.name}</strong>
                      <span className="sub" dir="auto">
                        {result.technique}
                      </span>
                    </td>
                    <td>
                      {owaspIds(result.owasp).map((id) => (
                        <span key={id} className="tag tag-owasp">
                          {id}
                        </span>
                      ))}
                    </td>
                    <td>{aimedAt.get(result.attack_id) ?? "—"}</td>
                    <td>
                      {result.decided_by}
                      <span className="sub">{result.outcome}</span>
                    </td>
                    <td className="nowrap">
                      {result.passed ? (
                        <>
                          <span className="chip chip-good">
                            <ShieldCheck size={13} strokeWidth={1.75} aria-hidden="true" /> Held
                          </span>
                          <span className="sub">{dollars(result.paid)} paid</span>
                        </>
                      ) : (
                        <>
                          <span className="chip chip-bad">
                            <ShieldAlert size={13} strokeWidth={1.75} aria-hidden="true" /> Failed
                          </span>
                          <span className="sub">
                            {dollars(result.paid)} paid{result.note ? `. ${result.note}` : ""}
                          </span>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </div>
      )}
    </section>
  );
}
