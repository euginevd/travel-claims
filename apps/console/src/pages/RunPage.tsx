import { Award, CircleCheck, CircleMinus, CircleX, LoaderCircle, RotateCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Api, RunClaim, RunInFull } from "../api";
import { dollars } from "../format";
import { useFocusHeading } from "../useFocusHeading";
import { SCOREBOARD_HREF } from "../useHashRoute";
import { measures } from "./ScoreboardPage";

const POLL_MS = 3000;

// The judge's score as a letter grade, each with its status tone.
const GRADES = [
  { letter: "F", tone: "chip-bad" },
  { letter: "C", tone: "chip-warn" },
  { letter: "B", tone: "chip-info" },
  { letter: "A", tone: "chip-good" },
] as const;

function yesNo(value: boolean | null): string {
  return value ? "Yes" : "No";
}

function Judge({ claim, grading }: { claim: RunClaim; grading: boolean }) {
  if (!claim.decision) return <span className="muted">–</span>;
  if (!claim.judged) {
    return grading ? (
      <span className="chip chip-info">
        <LoaderCircle size={14} strokeWidth={2} aria-hidden="true" />
        Grading…
      </span>
    ) : (
      <span className="muted">Not graded</span>
    );
  }
  if (claim.grade === null) {
    return (
      <>
        <span className="chip">
          <CircleMinus size={14} strokeWidth={2} aria-hidden="true" />
          Not graded
        </span>
        {claim.grade_note && <p className="muted small">{claim.grade_note}</p>}
      </>
    );
  }
  const { letter, tone } = GRADES[Math.min(Math.max(claim.grade, 0), 3)] ?? GRADES[0];
  return (
    <>
      <span className={`chip ${tone}`}>
        <Award size={14} strokeWidth={2} aria-hidden="true" />
        {letter} · {String(claim.grade)}
      </span>
      <p className="muted small">
        Same grounds: {yesNo(claim.same_grounds)} · Same section: {yesNo(claim.same_section)}
      </p>
      {claim.grade_note && <p className="muted small">{claim.grade_note}</p>}
    </>
  );
}

function outcome(decision: string | null, payout: number | null): string {
  if (!decision) return "Not decided";
  return decision === "approve" ? `Approve ${dollars(payout ?? 0)}` : decision;
}

export function RunPage({ api, runId }: { api: Api; runId: number }) {
  const [run, setRun] = useState<RunInFull | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const heading = useFocusHeading();
  const refresh = useCallback(() => {
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api.getRun(runId, controller.signal).then(
      (found) => {
        setRun(found);
        setError(null);
      },
      (caught: unknown) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      },
    );
    return () => {
      controller.abort();
    };
  }, [api, runId, generation]);

  const running = run?.status === "running";
  const grading = run?.grading === true;
  useEffect(() => {
    if (!running && !grading) return;
    const timer = window.setTimeout(refresh, POLL_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [running, grading, refresh, run]);

  async function resume() {
    try {
      await api.resumeRun(runId);
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  const misses = run?.claims.filter((claim) => !claim.payout_matched).length ?? 0;
  const stuck = run?.claims.some((c) => c.status === "waiting" || c.status === "in_progress");

  return (
    <section aria-labelledby="run-heading">
      <p className="eyebrow">
        <a href={SCOREBOARD_HREF}>Scoreboard</a>
      </p>
      <h1 id="run-heading" ref={heading} tabIndex={-1}>
        Run {runId}
      </h1>
      {error && (
        <p className="error" role="alert">
          {error}
          <button type="button" className="button secondary" onClick={refresh}>
            Try again
          </button>
        </p>
      )}
      {!run && !error && <p role="status">Loading the run…</p>}
      {run && (
        <>
          <p className="muted">
            {run.label_set === "evaluation" ? "Evaluation set" : "Held-out set"}, {run.size} ·
            configuration v{run.config_version} · {run.concurrency} at once ·{" "}
            {running ? "running…" : grading ? "grading…" : run.status}
            {run.scores && ` · ${String(misses)} missed of ${String(run.scores.claims)}`}
          </p>
          {run.scores && (
            <ul className="figures" aria-label="The run's measures">
              {measures(run.scores).map((measure) => (
                <li key={measure.label} className="figure">
                  <p className="eyebrow figure-label">{measure.label}</p>
                  <p className="figure-value">{measure.value}</p>
                </li>
              ))}
            </ul>
          )}
          {run.status !== "running" && stuck && (
            <button type="button" className="button secondary" onClick={() => void resume()}>
              <RotateCw size={16} strokeWidth={2} aria-hidden="true" />
              Carry on with the unfinished claims
            </button>
          )}
          <div className="table-wrap">
            <table className="table">
              <caption className="visually-hidden">
                Each claim beside the handler's decision; misses first
              </caption>
              <thead>
                <tr>
                  <th scope="col">Claim</th>
                  <th scope="col">What happened</th>
                  <th scope="col">Agent</th>
                  <th scope="col">Handler</th>
                  <th scope="col">Match</th>
                  <th scope="col">Judge</th>
                  <th scope="col">Cost</th>
                </tr>
              </thead>
              <tbody>
                {[...run.claims]
                  .sort((a, b) => Number(a.payout_matched) - Number(b.payout_matched))
                  .map((claim) => (
                    <tr key={claim.claim_id} className={claim.payout_matched ? "" : "miss"}>
                      <td className="nowrap">
                        <span className="mono">{claim.original_claim_id}</span>
                      </td>
                      <td>{claim.summary}</td>
                      <td>
                        <strong>{outcome(claim.decision, claim.payout)}</strong>
                        {claim.reason && <p className="muted small">{claim.reason}</p>}
                      </td>
                      <td>
                        <strong>{outcome(claim.handler_decision, claim.handler_payout)}</strong>
                        {claim.handler_reason && (
                          <p className="muted small">{claim.handler_reason}</p>
                        )}
                      </td>
                      <td>
                        {claim.payout_matched ? (
                          <span className="chip chip-good">
                            <CircleCheck size={14} strokeWidth={2} aria-hidden="true" />
                            Match
                          </span>
                        ) : (
                          <span className="chip chip-bad">
                            <CircleX size={14} strokeWidth={2} aria-hidden="true" />
                            {claim.matched ? "Payout differs" : "Miss"}
                          </span>
                        )}
                      </td>
                      <td>
                        <Judge claim={claim} grading={grading} />
                      </td>
                      <td className="num">${claim.cost.toFixed(3)}</td>
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
