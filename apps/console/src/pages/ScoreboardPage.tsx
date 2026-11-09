import { FlaskConical, Play } from "lucide-react";
import { useCallback, useEffect, useState, type SubmitEvent } from "react";
import type { Api, Run, Scores, StartRunRequest } from "../api";
import { useFocusHeading } from "../useFocusHeading";
import { when } from "../format";
import { runHref } from "../useHashRoute";

const POLL_MS = 3000;
const SET_LABELS: Record<Run["label_set"], string> = {
  evaluation: "Evaluation set",
  held_out: "Held-out set",
};

export function percent(value: number): string {
  return `${(value * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

export function cost(value: number): string {
  return `$${value.toFixed(value < 0.1 ? 3 : 2)}`;
}

/** The measures shown for a run, in the order the scoreboard shows them. */
export function measures(scores: Scores): { label: string; value: string }[] {
  return [
    { label: "Accuracy", value: percent(scores.accuracy) },
    { label: "Payout accuracy", value: percent(scores.payout_accuracy) },
    { label: "Straight through", value: percent(scores.straight_through) },
    { label: "Cost per claim", value: cost(scores.cost_per_claim) },
    { label: "Time per claim", value: `${scores.seconds_per_claim.toFixed(0)}s` },
  ];
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
    <form className="panel run-form" onSubmit={(event) => void start(event)}>
      <h2>Run an evaluation</h2>
      <p className="muted">
        Copies of labelled claims are worked by the current configuration and scored against the
        handlers' decisions. Copies are never paid and never show in the queue.
      </p>
      <div className="run-form-fields">
        <label>
          Set
          <select
            value={request.label_set}
            onChange={(event) => {
              setRequest({ ...request, label_set: event.target.value as Run["label_set"] });
            }}
          >
            <option value="evaluation">Evaluation set</option>
            <option value="held_out">Held-out set</option>
          </select>
        </label>
        <label>
          Claims
          <select
            value={request.size}
            onChange={(event) => {
              setRequest({ ...request, size: event.target.value as Run["size"] });
            }}
          >
            <option value="tiny">The five tiny claims (about $0.15)</option>
            <option value="whole">All 25 (about $0.75)</option>
          </select>
        </label>
        <label>
          Claim agents at once
          <input
            type="number"
            min={1}
            max={25}
            value={request.concurrency}
            onChange={(event) => {
              setRequest({ ...request, concurrency: Number(event.target.value) });
            }}
          />
        </label>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="button" disabled={busy}>
        <Play size={16} strokeWidth={2} aria-hidden="true" />
        {busy ? "Starting…" : "Start the run"}
      </button>
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
    <section aria-labelledby="scoreboard-heading">
      <p className="eyebrow">Evaluations</p>
      <h1 id="scoreboard-heading" ref={heading} tabIndex={-1}>
        Scoreboard
      </h1>
      <StartRun api={api} onStarted={refresh} />
      {error && (
        <p className="error" role="alert">
          {error}
          <button type="button" className="button secondary" onClick={refresh}>
            Try again
          </button>
        </p>
      )}
      {!runs && !error && <p role="status">Loading the runs…</p>}
      {runs?.length === 0 && (
        <div className="panel empty">
          <FlaskConical size={24} strokeWidth={2} aria-hidden="true" />
          <h2>No evaluations yet</h2>
          <p className="muted">Start one above to see how the agent compares with the handlers.</p>
        </div>
      )}
      {runs && runs.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <caption className="visually-hidden">Evaluation runs, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Run</th>
                <th scope="col">Set</th>
                <th scope="col">Version</th>
                <th scope="col">Accuracy</th>
                <th scope="col">Payout accuracy</th>
                <th scope="col">Straight through</th>
                <th scope="col">Cost per claim</th>
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
                  <td>
                    {SET_LABELS[run.label_set]}, {run.size}
                  </td>
                  <td className="num">v{run.config_version}</td>
                  <td className="num">{run.scores ? percent(run.scores.accuracy) : "–"}</td>
                  <td className="num">{run.scores ? percent(run.scores.payout_accuracy) : "–"}</td>
                  <td className="num">{run.scores ? percent(run.scores.straight_through) : "–"}</td>
                  <td className="num">{run.scores ? cost(run.scores.cost_per_claim) : "–"}</td>
                  <td className="nowrap">{when(run.started_at)}</td>
                  <td>{run.status === "running" ? "Running…" : run.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
