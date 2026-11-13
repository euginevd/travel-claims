import { useEffect, useState } from "react";
import type { Api, Run } from "../api";
import { dollars } from "../format";

const percent = (value: number) => `${String(Math.round(value * 100))}%`;

/** The newest finished run of each agent version, from the console's own run records. */
export function latestScored(runs: Run[], version: number): Run | undefined {
  return runs
    .filter((run) => run.config_version === version && run.scores !== null)
    .sort((a, b) => b.run_id - a.run_id)[0];
}

/** Two agent versions side by side, built in code from the runs: Wattle only names them. */
export function VersionsCard({ api, versions }: { api: Api; versions: number[] }) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  useEffect(() => {
    let live = true;
    api.listRuns().then(
      (found) => {
        if (live) setRuns(found);
      },
      () => {
        if (live) setRuns([]);
      },
    );
    return () => {
      live = false;
    };
  }, [api]);

  if (runs === null) return <p className="muted small">Loading the runs…</p>;
  const shown = versions.map((version) => ({ version, run: latestScored(runs, version) }));
  if (shown.every(({ run }) => !run)) {
    return <p className="muted small">No finished runs for those versions yet.</p>;
  }
  const rows: [string, (run: Run) => string][] = [
    ["Decision accuracy", (run) => percent(run.scores?.accuracy ?? 0)],
    ["Payout accuracy", (run) => percent(run.scores?.payout_accuracy ?? 0)],
    ["Straight through", (run) => percent(run.scores?.straight_through ?? 0)],
    ["Cost a claim", (run) => dollars(run.scores?.cost_per_claim ?? 0)],
    ["Seconds a claim", (run) => (run.scores?.seconds_per_claim ?? 0).toFixed(1)],
  ];
  return (
    <table className="versions-card">
      <caption className="visually-hidden">Agent versions side by side</caption>
      <thead>
        <tr>
          <th scope="col">Latest run</th>
          {shown.map(({ version, run }) => (
            <th key={version} scope="col">
              v{version}
              <span className="muted"> {run ? `run ${String(run.run_id)}` : "no run"}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            {shown.map(({ version, run }) => (
              <td key={version}>{run ? value(run) : "–"}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
