import { Check, CircleMinus, FlaskConical, LoaderCircle, Play, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type SubmitEvent } from "react";
import type { Api, Criterion, Run, Scores, StartRunRequest, SuccessCriteria } from "../api";
import { MiniBar, Sparkline } from "../components/Charts";
import { TableScroll } from "../components/TableScroll";
import { useFocusHeading } from "../useFocusHeading";
import { when } from "../format";
import { runHref } from "../useHashRoute";

const POLL_MS = 3000;
// How many scored runs a trend line looks back over.
const TREND_RUNS = 12;
const SET_LABELS: Record<Run["label_set"], string> = {
  evaluation: "Evaluation set",
  held_out: "Held-out set",
};
const SIZE_LABELS: Record<Run["size"], string> = {
  tiny: "The five tiny claims (about $0.15)",
  whole: "All 25 (about $0.75)",
};

export function percent(value: number): string {
  return `${(value * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

export function cost(value: number): string {
  return `$${value.toFixed(value < 0.1 ? 3 : 2)}`;
}

/** The judge's mean grade out of 3, or why there isn't one. */
export function gradeOf(scores: Scores): string {
  return scores.grade === null ? "Not graded" : `${scores.grade.toFixed(2)} of 3`;
}

/** The measures shown for a run, in the order the scoreboard shows them. */
export function measures(scores: Scores): { label: string; value: string }[] {
  return [
    { label: "Accuracy", value: percent(scores.accuracy) },
    { label: "Payout accuracy", value: percent(scores.payout_accuracy) },
    { label: "Straight through", value: percent(scores.straight_through) },
    { label: "Judge's grade", value: gradeOf(scores) },
    { label: "Cost per claim", value: cost(scores.cost_per_claim) },
    { label: "Time per claim", value: `${scores.seconds_per_claim.toFixed(0)}s` },
  ];
}

/** A status from the api as words: "rolled_back" reads "Rolled back". */
export function words(status: string): string {
  const spaced = status.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A run's status as a pill: a word and an icon. */
export function RunStatus({ status }: { status: string }) {
  if (status === "running") {
    return (
      <span className="chip chip-info">
        <LoaderCircle className="spin" size={13} strokeWidth={1.75} aria-hidden="true" />
        Running…
      </span>
    );
  }
  if (status === "finished") {
    return (
      <span className="chip chip-good">
        <Check size={13} strokeWidth={1.75} aria-hidden="true" />
        Finished
      </span>
    );
  }
  return (
    <span className="chip">
      <CircleMinus size={13} strokeWidth={1.75} aria-hidden="true" />
      {words(status)}
    </span>
  );
}

type Scored = Run & { scores: Scores };

const HEADLINES: { label: string; of: (scores: Scores) => number; show: (n: number) => string }[] =
  [
    { label: "Accuracy", of: (scores) => scores.accuracy, show: percent },
    { label: "Payout accuracy", of: (scores) => scores.payout_accuracy, show: percent },
    { label: "Straight through", of: (scores) => scores.straight_through, show: percent },
    { label: "Cost per claim", of: (scores) => scores.cost_per_claim, show: cost },
  ];

/** The latest scored run's four headline measures, each with its trend over the scored runs on
 * the same set: the evaluation and held-out sets score differently, so they never share a line. */
function Headlines({ runs }: { runs: Run[] }) {
  const all = runs
    .filter((run): run is Scored => run.scores !== null)
    .sort((a, b) => a.run_id - b.run_id);
  const latest = all[all.length - 1];
  if (!latest) return null;
  const scored = all.filter((run) => run.label_set === latest.label_set).slice(-TREND_RUNS);
  return (
    <ul className="kpis" aria-label={`Run ${String(latest.run_id)}'s headline measures`}>
      {HEADLINES.map(({ label, of, show }) => (
        <li key={label} className="kpi">
          <p className="kpi-label">
            {label}
            <span>v{latest.config_version}</span>
          </p>
          <p className="kpi-value">{show(of(latest.scores))}</p>
          <p className="kpi-sub">
            Run {latest.run_id} · {SET_LABELS[latest.label_set]}, {latest.size}
          </p>
          <Sparkline
            values={scored.map((run) => of(run.scores))}
            label={`${label} over the last ${String(scored.length)} scored runs on the ${SET_LABELS[latest.label_set].toLowerCase()}, oldest first: ${scored
              .map((run) => show(of(run.scores)))
              .join(", ")}`}
          />
        </li>
      ))}
    </ul>
  );
}

/** A criterion's target or actual as people read it: a share as a percentage, a count as is. */
export function figure(criterion: Criterion, value: number | null): string {
  if (value === null) return "–";
  return criterion.unit === "share" ? percent(value) : String(value);
}

/** The line under the criteria: all met, or how many are and how many have nothing to go on. */
export function overall(found: SuccessCriteria): string {
  const total = found.criteria.length;
  const met = found.criteria.filter((criterion) => criterion.met === true).length;
  const noData = found.criteria.filter((criterion) => criterion.met === null).length;
  if (found.met) return `All ${String(total)} criteria are met.`;
  const waiting = noData > 0 ? `, ${String(noData)} with no data yet` : "";
  return `${String(met)} of ${String(total)} criteria met${waiting}.`;
}

function Met({ met }: { met: boolean | null }) {
  if (met === null) {
    return (
      <span className="chip">
        <CircleMinus size={13} strokeWidth={1.75} aria-hidden="true" />
        No data
      </span>
    );
  }
  return met ? (
    <span className="chip chip-good">
      <Check size={13} strokeWidth={1.75} aria-hidden="true" />
      Met
    </span>
  ) : (
    <span className="chip chip-bad">
      <X size={13} strokeWidth={1.75} aria-hidden="true" />
      Not met
    </span>
  );
}

/** Whether the agent meets its objectives, as the api worked it out in code. It loads again
 * whenever `refreshKey` changes, which the page ties to its finished runs. */
function SuccessCard({ api, refreshKey }: { api: Api; refreshKey: number }) {
  const [found, setFound] = useState<SuccessCriteria | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    api.getSuccessCriteria().then(
      (criteria) => {
        if (!live) return;
        setFound(criteria);
        setError(null);
      },
      (caught: unknown) => {
        if (live) setError(caught instanceof Error ? caught.message : String(caught));
      },
    );
    return () => {
      live = false;
    };
  }, [api, refreshKey, attempt]);

  return (
    <section className="panel criteria" aria-labelledby="criteria-heading">
      <div className="panel-head">
        <h2 id="criteria-heading">Success criteria</h2>
        <p className="panel-note">
          Worked out in code from the latest held-out run and the payments. No model is asked.
        </p>
      </div>
      {/* A quiet status, not an alert: the scoreboard below still works without this card. */}
      {error && (
        <p className="criteria-error" role="status">
          The success criteria couldn&apos;t be loaded: {error}
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setError(null);
              setAttempt((value) => value + 1);
            }}
          >
            Reload the criteria
          </button>
        </p>
      )}
      {!found && !error && (
        <p role="status" className="loading">
          <LoaderCircle className="spin" size={16} strokeWidth={1.75} aria-hidden="true" />
          Loading the success criteria…
        </p>
      )}
      {found && (
        <>
          <TableScroll label="Success criteria table">
            <table className="table criteria-table">
              <caption className="visually-hidden">
                Each success criterion with its target and the latest figure
              </caption>
              <thead>
                <tr>
                  <th scope="col">Criterion</th>
                  <th scope="col" className="num">
                    Target
                  </th>
                  <th scope="col" className="num">
                    Actual
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {found.criteria.map((criterion) => (
                  <tr key={criterion.key}>
                    <th scope="row">
                      {criterion.label}
                      <span className="criteria-detail">{criterion.detail}</span>
                    </th>
                    <td className="num nowrap">
                      {criterion.unit === "share" ? "At least " : ""}
                      {figure(criterion, criterion.target)}
                    </td>
                    <td className="num">{figure(criterion, criterion.actual)}</td>
                    <td>
                      <Met met={criterion.met} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <p className="criteria-overall">
            <strong>{overall(found)}</strong>
            {found.criteria.some((criterion) => criterion.met === null) &&
              " Run the held-out set below to measure the rest."}
          </p>
        </>
      )}
    </section>
  );
}

function Percent({ value }: { value: number }) {
  return (
    <span className="pct">
      <span className="pct-value">{percent(value)}</span>
      <MiniBar value={value} />
    </span>
  );
}

function StartRun({ api, onStarted }: { api: Api; onStarted: () => void }) {
  const [request, setRequest] = useState<StartRunRequest>({
    label_set: "evaluation",
    size: "tiny",
    concurrency: 5,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const touched = useRef(false);

  // Start from the number the handlers set, unless the engineer has already typed one.
  useEffect(() => {
    let live = true;
    api.getSettings().then(
      (found) => {
        if (live && !touched.current) {
          setRequest((current) => ({ ...current, concurrency: found.values.agents_at_once }));
        }
      },
      () => {
        // Only a starting value: the form works without it.
      },
    );
    return () => {
      live = false;
    };
  }, [api]);

  async function start(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.startRun(request);
      onStarted();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={(event) => void start(event)}>
      <div className="panel-head">
        <h2>Run an evaluation</h2>
      </div>
      <p className="run-form-note">
        Copies of labelled claims are worked by the current configuration and scored against the
        handlers' decisions. Copies are never paid and never show in the queue.
      </p>
      <div className="run-form">
        <fieldset className="seg">
          <legend>Set</legend>
          <div className="seg-track">
            {(["evaluation", "held_out"] as const).map((value) => (
              <label key={value} className="seg-option">
                <input
                  type="radio"
                  name="label_set"
                  checked={request.label_set === value}
                  onChange={() => {
                    setRequest({ ...request, label_set: value });
                  }}
                />
                <span>{SET_LABELS[value]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="seg">
          <legend>Claims</legend>
          <div className="seg-track">
            {(["tiny", "whole"] as const).map((value) => (
              <label key={value} className="seg-option">
                <input
                  type="radio"
                  name="size"
                  checked={request.size === value}
                  onChange={() => {
                    setRequest({ ...request, size: value });
                  }}
                />
                <span>{SIZE_LABELS[value]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="run-concurrency">Claim agents at once</label>
          <input
            id="run-concurrency"
            type="number"
            min={1}
            max={25}
            value={request.concurrency}
            onChange={(event) => {
              touched.current = true;
              setRequest({ ...request, concurrency: Number(event.target.value) });
            }}
          />
        </div>
        <button type="submit" className="button" disabled={busy}>
          <Play size={15} strokeWidth={1.75} aria-hidden="true" />
          {busy ? "Starting…" : "Start the run"}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function ScoreboardPage({ api }: { api: Api }) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const heading = useFocusHeading();
  const refresh = useCallback(() => {
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    let live = true;
    api.listRuns().then(
      (found) => {
        if (live) {
          setRuns(found);
          setError(null);
        }
      },
      (caught: unknown) => {
        if (live) setError(caught instanceof Error ? caught.message : String(caught));
      },
    );
    return () => {
      live = false;
    };
  }, [api, generation]);

  const running = runs?.some((run) => run.status === "running") ?? false;
  const finished = runs?.filter((run) => run.status === "finished").length ?? 0;
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(refresh, POLL_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [running, refresh, runs]);

  return (
    <section className="view" aria-labelledby="scoreboard-heading">
      <header className="page-head">
        <div>
          <p className="eyebrow">Quality · Evaluations</p>
          <h1 id="scoreboard-heading" ref={heading} tabIndex={-1}>
            Scoreboard
          </h1>
        </div>
      </header>
      <SuccessCard api={api} refreshKey={finished} />
      {runs && <Headlines runs={runs} />}
      <StartRun api={api} onStarted={refresh} />
      {error && (
        <p className="error" role="alert">
          {error}
          <button type="button" className="button secondary" onClick={refresh}>
            Try again
          </button>
        </p>
      )}
      {!runs && !error && (
        <p role="status" className="loading">
          <LoaderCircle className="spin" size={16} strokeWidth={1.75} aria-hidden="true" />
          Loading the runs…
        </p>
      )}
      {runs?.length === 0 && (
        <div className="panel empty">
          <span className="icon-tile">
            <FlaskConical size={19} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <h2>No evaluations yet</h2>
          <p className="muted">Start one above to see how the agent compares with the handlers.</p>
        </div>
      )}
      {runs && runs.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h2>Evaluation runs</h2>
            <p className="panel-note">Newest first. Open a run for its claims.</p>
          </div>
          <TableScroll label="Evaluation runs table">
            <table className="table min-wide">
              <caption className="visually-hidden">Evaluation runs, newest first</caption>
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Set</th>
                  <th scope="col">Version</th>
                  <th scope="col">Accuracy</th>
                  <th scope="col">Payout accuracy</th>
                  <th scope="col">Straight through</th>
                  <th scope="col">Grade</th>
                  <th scope="col" className="num">
                    Cost per claim
                  </th>
                  <th scope="col">Started</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.run_id}>
                    <td className="nowrap">
                      <a href={runHref(run.run_id)}>Run {run.run_id}</a>
                    </td>
                    <td className="nowrap">
                      {SET_LABELS[run.label_set]}, {run.size}
                    </td>
                    <td>
                      <span className="tag">v{run.config_version}</span>
                    </td>
                    <td>{run.scores ? <Percent value={run.scores.accuracy} /> : "–"}</td>
                    <td>{run.scores ? <Percent value={run.scores.payout_accuracy} /> : "–"}</td>
                    <td>{run.scores ? <Percent value={run.scores.straight_through} /> : "–"}</td>
                    <td className="nowrap">
                      {run.grading ? "Grading…" : run.scores ? gradeOf(run.scores) : "–"}
                    </td>
                    <td className="num">{run.scores ? cost(run.scores.cost_per_claim) : "–"}</td>
                    <td className="nowrap">{when(run.started_at)}</td>
                    <td>
                      <RunStatus status={run.status} />
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
