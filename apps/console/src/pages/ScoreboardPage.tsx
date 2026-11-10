import { Check, CircleMinus, FlaskConical, LoaderCircle, Play } from "lucide-react";
import { useCallback, useEffect, useState, type SubmitEvent } from "react";
import type { Api, Run, Scores, StartRunRequest } from "../api";
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

/** The latest scored run's four headline measures, each with its trend over the scored runs. */
function Headlines({ runs }: { runs: Run[] }) {
  const scored = runs
    .filter((run): run is Scored => run.scores !== null)
    .sort((a, b) => a.run_id - b.run_id)
    .slice(-TREND_RUNS);
  const latest = scored[scored.length - 1];
  if (!latest) return null;
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
            label={`${label} over the last ${String(scored.length)} scored runs, oldest first: ${scored
              .map((run) => show(of(run.scores)))
              .join(", ")}`}
          />
        </li>
      ))}
    </ul>
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
