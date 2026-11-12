import { Check, CircleMinus, FlaskConical, LoaderCircle, Play, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type SubmitEvent } from "react";
import type {
  Api,
  Criterion,
  Live,
  Run,
  RunClaim,
  Scores,
  StartRunRequest,
  SuccessCriteria,
} from "../api";
import { RangeBar, VersionChart } from "../components/Charts";
import { RunDiff } from "../components/RunDiff";
import { TableScroll } from "../components/TableScroll";
import { when } from "../format";
import { rangeText, wilson } from "../stats";
import { useFocusHeading } from "../useFocusHeading";
import { IMPROVEMENT_HREF, runHref } from "../useHashRoute";

const POLL_MS = 3000;
const SIZE_LABELS: Record<Run["size"], string> = {
  tiny: "5 claims (about $0.15)",
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
  return scores.grade === null ? "Not graded" : `${scores.grade.toFixed(1)} of 3`;
}

/** The measures shown for a run, in plain words, in the order the scoreboard shows them. */
export function measures(scores: Scores): { label: string; value: string }[] {
  return [
    { label: "Right decision", value: percent(scores.accuracy) },
    { label: "Right amount", value: percent(scores.payout_accuracy) },
    { label: "Decided without a person", value: percent(scores.straight_through) },
    { label: "Explanation matches the handler's", value: gradeOf(scores) },
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

function scored(runs: Run[]): Scored[] {
  return runs
    .filter((run): run is Scored => run.scores !== null && run.status === "finished")
    .sort((a, b) => a.run_id - b.run_id);
}

/** An exam is a held-out run: only an improvement round starts one. */
function isExam(run: Run): boolean {
  return run.label_set === "held_out";
}

/** Each version's latest exam, oldest version first; whole exams win over 5-claim ones. */
export function examsByVersion(runs: Run[]): Scored[] {
  const best = new Map<number, Scored>();
  for (const run of scored(runs).filter(isExam)) {
    const held = best.get(run.config_version);
    if (!held || run.size === "whole" || held.size !== "whole") best.set(run.config_version, run);
  }
  return [...best.values()].sort((a, b) => a.config_version - b.config_version);
}

function targetOf(criteria: SuccessCriteria | null, key: string): number | undefined {
  return criteria?.criteria.find((c) => c.key === key)?.target ?? undefined;
}

/** One measure of the exam: the score, its likely range and its target, drawn on one track. */
function MeasureRow({
  label,
  value,
  claims,
  target,
}: {
  label: string;
  value: number;
  claims: number;
  target?: number;
}) {
  const range = wilson(value, claims);
  return (
    <div className="measure-row">
      <dt>{label}</dt>
      <dd>
        <strong>{percent(value)}</strong>
        <span className="muted small"> likely {rangeText(range)}</span>
        <RangeBar value={value} range={range} target={target} />
      </dd>
    </div>
  );
}

/** The version in use's latest exam, measure by measure with how sure each score is, beside
 * every version's exam score. */
function ExamPanel({
  runs,
  version,
  criteria,
}: {
  runs: Run[];
  version: number | null;
  criteria: SuccessCriteria | null;
}) {
  const exams = examsByVersion(runs);
  const exam =
    exams.find((run) => run.config_version === version) ?? exams[exams.length - 1] ?? null;
  const accuracyTarget = targetOf(criteria, "accuracy");
  if (exam === null) {
    return (
      <div className="panel">
        <div className="panel-head">
          <h2>The exam</h2>
        </div>
        <p className="muted small">
          No exam yet. An improvement round runs one on the 25 held-out claims; a practice run below
          doesn&apos;t count.
        </p>
      </div>
    );
  }
  const s = exam.scores;
  return (
    <div className="panel score-hero">
      <div>
        <div className="panel-head">
          <h2>
            v{exam.config_version}&apos;s exam
            {exam.config_version === version && <span className="tag">In use</span>}
          </h2>
          <p className="panel-note">
            <a href={runHref(exam.run_id)}>Run {exam.run_id}</a> · {s.claims} held-out claims ·{" "}
            {when(exam.started_at)}
          </p>
        </div>
        <dl className="measure-list">
          <MeasureRow
            label="Right decision"
            value={s.accuracy}
            claims={s.claims}
            target={accuracyTarget}
          />
          <MeasureRow label="Right amount" value={s.payout_accuracy} claims={s.claims} />
          <MeasureRow
            label="Decided without a person"
            value={s.straight_through}
            claims={s.claims}
            target={targetOf(criteria, "straight_through")}
          />
          <div className="measure-row">
            <dt>Explanation matches the handler&apos;s</dt>
            <dd>
              <strong>{gradeOf(s)}</strong>
              <span className="muted small"> the judge&apos;s grade, 3 is the same reasons</span>
            </dd>
          </div>
          <div className="measure-row">
            <dt>Cost per claim</dt>
            <dd>
              <strong>{cost(s.cost_per_claim)}</strong>
              <span className="muted small"> {s.seconds_per_claim.toFixed(0)} s a claim</span>
            </dd>
          </div>
        </dl>
        <p className="small muted">
          The shaded band is where the true score likely sits: {s.claims} claims can&apos;t pin it
          down closer. A tick marks the target.
        </p>
      </div>
      <div>
        <h3 className="live-sub">Right decision by version</h3>
        <VersionChart
          points={exams.map((run) => ({
            name: `v${String(run.config_version)}`,
            value: run.scores.accuracy,
            range: wilson(run.scores.accuracy, run.scores.claims),
          }))}
          target={accuracyTarget}
          label={`Each version's latest exam, right decision, oldest first: ${exams
            .map(
              (run) =>
                `v${String(run.config_version)} ${percent(run.scores.accuracy)} (likely ${rangeText(wilson(run.scores.accuracy, run.scores.claims))}, ${String(run.scores.claims)} claims)`,
            )
            .join(", ")}`}
        />
        <p className="small muted">
          The dashed line is the target
          {accuracyTarget === undefined ? "" : ` (${percent(accuracyTarget)})`}. Whiskers that
          overlap mean the versions can&apos;t be told apart on their exams.
        </p>
      </div>
    </div>
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

/** The same measure on live claims, over the last 14 days, for the version in use. */
function liveOf(key: string, live: Live | null): string {
  if (live === null) return "–";
  if (key === "straight_through") {
    const share = live.totals.straight_through_share;
    return share === null ? "–" : percent(share);
  }
  if (key === "accuracy") {
    const own = live.by_version.find((row) => row.name === `v${String(live.version)}`);
    return own ? percent(1 - own.disagreements / own.decided) : "None yet";
  }
  return "–";
}

/** Whether the agent meets its objectives, as the api worked it out in code, beside the same
 * measures live. */
function SuccessCard({
  api,
  found,
  error,
  onRetry,
}: {
  api: Api;
  found: SuccessCriteria | null;
  error: string | null;
  onRetry: () => void;
}) {
  const [live, setLive] = useState<Live | null>(null);
  useEffect(() => {
    let current = true;
    api.getLive(14).then(
      (got) => {
        if (current) setLive(got);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [api]);

  return (
    <section className="panel criteria" aria-labelledby="criteria-heading">
      <div className="panel-head">
        <h2 id="criteria-heading">Success criteria</h2>
        <p className="panel-note">
          Worked out in code from the latest exam and the payments, beside the last 14 days live.
        </p>
      </div>
      {/* A quiet status, not an alert: the scoreboard below still works without this card. */}
      {error && (
        <p className="criteria-error" role="status">
          The success criteria couldn&apos;t be loaded: {error}
          <button type="button" className="button secondary" onClick={onRetry}>
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
            <table className="table criteria-table min-mid">
              <caption className="visually-hidden">
                Each success criterion with its target, the exam's figure and the live figure
              </caption>
              <thead>
                <tr>
                  <th scope="col">Criterion</th>
                  <th scope="col" className="num">
                    Target
                  </th>
                  <th scope="col" className="num">
                    Exam
                  </th>
                  <th scope="col" className="num">
                    Live
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
                    <td className="num">
                      {criterion.key === "signed_off"
                        ? figure(criterion, criterion.actual)
                        : liveOf(criterion.key, live)}
                    </td>
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
              " An improvement round's exam measures the rest."}
          </p>
        </>
      )}
    </section>
  );
}

/** The latest exam's right decisions by claim type, weakest first, each with its range. */
function ByClaimType({ api, exam }: { api: Api; exam: Scored | null }) {
  const examId = exam?.run_id ?? null;
  const [claims, setClaims] = useState<{ run: number; found: RunClaim[] } | null>(null);
  useEffect(() => {
    if (examId === null) return;
    let live = true;
    api.getRun(examId).then(
      (got) => {
        if (live) setClaims({ run: got.run_id, found: got.claims });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api, examId]);

  if (exam === null || claims?.run !== exam.run_id) return null;
  const groups = new Map<string, RunClaim[]>();
  for (const claim of claims.found) {
    const type = claim.claim_type ?? "other";
    groups.set(type, [...(groups.get(type) ?? []), claim]);
  }
  const rows = [...groups.entries()]
    .map(([type, found]) => ({
      type: type.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()),
      claims: found.length,
      right: found.filter((c) => c.matched).length,
    }))
    .sort((a, b) => a.right / a.claims - b.right / b.claims || b.claims - a.claims);
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Right decision by claim type</h2>
        <p className="panel-note">
          Run {exam.run_id}, v{exam.config_version}&apos;s exam. Weakest first; few claims means a
          wide band
        </p>
      </div>
      <TableScroll label="By claim type table">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Claim type</th>
              <th scope="col" className="num">
                Right
              </th>
              <th scope="col">Score and likely range</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const share = row.right / row.claims;
              const range = wilson(share, row.claims);
              return (
                <tr key={row.type}>
                  <th scope="row">{row.type}</th>
                  <td className="num nowrap">
                    {row.right} of {row.claims}
                  </td>
                  <td className="range-cell">
                    <RangeBar value={share} range={range} />
                    <span className="muted small nowrap">
                      {percent(share)} · likely {rangeText(range)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
    </div>
  );
}

function runName(run: Run): string {
  return `Run ${String(run.run_id)} · v${String(run.config_version)} ${isExam(run) ? "exam" : "practice"}, ${String(run.scores?.claims ?? 0)} claims`;
}

/** Any two finished runs side by side: the claims they decided differently. */
function Compare({ api, runs }: { api: Api; runs: Run[] }) {
  const [after, setAfter] = useState<number | null>(null);
  const [before, setBefore] = useState<number | null>(null);
  const done = scored(runs).reverse();
  if (done.length < 2) return null;
  const exams = done.filter(isExam);
  const pickAfter = after ?? (exams[0] ?? done[0])?.run_id ?? null;
  // By default, the latest exam against the latest exam of another version.
  const afterVersion = done.find((run) => run.run_id === pickAfter)?.config_version;
  const pickBefore =
    before ??
    (
      exams.find((run) => run.config_version !== afterVersion) ??
      done.find((run) => run.run_id !== pickAfter)
    )?.run_id ??
    null;
  const versionOf = (id: number) =>
    String(done.find((run) => run.run_id === id)?.config_version ?? "");
  const options = done.map((run) => (
    <option key={run.run_id} value={run.run_id}>
      {runName(run)}
    </option>
  ));
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Compare two runs</h2>
        <p className="panel-note">The claims they decided differently, worse ones first</p>
      </div>
      <div className="compare-pick">
        <div className="field">
          <label htmlFor="compare-before">Before</label>
          <select
            id="compare-before"
            value={pickBefore ?? ""}
            onChange={(event) => {
              setBefore(Number(event.target.value));
            }}
          >
            {options}
          </select>
        </div>
        <div className="field">
          <label htmlFor="compare-after">After</label>
          <select
            id="compare-after"
            value={pickAfter ?? ""}
            onChange={(event) => {
              setAfter(Number(event.target.value));
            }}
          >
            {options}
          </select>
        </div>
      </div>
      {pickBefore !== null && pickAfter !== null && pickBefore !== pickAfter ? (
        <RunDiff
          api={api}
          before={pickBefore}
          after={pickAfter}
          beforeLabel={`Run ${String(pickBefore)} (v${versionOf(pickBefore)})`}
          afterLabel={`Run ${String(pickAfter)} (v${versionOf(pickAfter)})`}
          headingId="compare-heading"
          title="Decided differently"
        />
      ) : (
        <p className="muted small">Pick two different runs.</p>
      )}
    </div>
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
        <h2>Run a practice test</h2>
      </div>
      <p className="run-form-note">
        The version in use decides copies of practice claims and is scored against the handlers.
        Copies are never paid and never show in the queue. Only an{" "}
        <a href={IMPROVEMENT_HREF}>improvement round</a> runs the exam, so it isn&apos;t worn out.
      </p>
      <div className="run-form">
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
        <details className="run-more">
          <summary>More options</summary>
          <div className="field">
            <label htmlFor="run-concurrency">Claims worked at once</label>
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
        </details>
        <button type="submit" className="button" disabled={busy}>
          <Play size={15} strokeWidth={1.75} aria-hidden="true" />
          {busy ? "Starting…" : "Start the practice run"}
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

/** A share with its likely range under it. */
function Share({ value, claims }: { value: number; claims: number }) {
  return (
    <>
      {percent(value)}
      <span className="sub">{rangeText(wilson(value, claims))}</span>
    </>
  );
}

function RunsTable({ runs }: { runs: Run[] }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>All runs</h2>
        <p className="panel-note">
          Newest first. Under each score, its likely range. Open a run for its claims
        </p>
      </div>
      <TableScroll label="Evaluation runs table">
        <table className="table min-wide">
          <caption className="visually-hidden">Evaluation runs, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Run</th>
              <th scope="col">Kind</th>
              <th scope="col">Version</th>
              <th scope="col">Right decision</th>
              <th scope="col">Right amount</th>
              <th scope="col">Without a person</th>
              <th scope="col">Explanation</th>
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
                  <span className={isExam(run) ? "tag tag-exam" : "tag"}>
                    {isExam(run) ? "Exam" : "Practice"}
                  </span>
                  <span className="sub">
                    {run.size === "tiny" ? "5 claims, a rough check" : "25 claims"}
                    {run.round_id !== null && (
                      <>
                        {" · "}
                        <a href={IMPROVEMENT_HREF}>round {run.round_id}</a>
                      </>
                    )}
                  </span>
                </td>
                <td>
                  <span className="tag">v{run.config_version}</span>
                </td>
                <td className="nowrap">
                  {run.scores ? (
                    <Share value={run.scores.accuracy} claims={run.scores.claims} />
                  ) : (
                    "–"
                  )}
                </td>
                <td className="nowrap">
                  {run.scores ? (
                    <Share value={run.scores.payout_accuracy} claims={run.scores.claims} />
                  ) : (
                    "–"
                  )}
                </td>
                <td className="nowrap">
                  {run.scores ? (
                    <Share value={run.scores.straight_through} claims={run.scores.claims} />
                  ) : (
                    "–"
                  )}
                </td>
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
  );
}

export function ScoreboardPage({ api }: { api: Api }) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [version, setVersion] = useState<number | null>(null);
  const [criteria, setCriteria] = useState<SuccessCriteria | null>(null);
  const [criteriaError, setCriteriaError] = useState<string | null>(null);
  const [criteriaAttempt, setCriteriaAttempt] = useState(0);
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

  useEffect(() => {
    let live = true;
    api.listConfigurations().then(
      (found) => {
        if (live) setVersion(found.find((c) => c.current)?.version ?? null);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api]);

  const running = runs?.some((run) => run.status === "running") ?? false;
  const finished = runs?.filter((run) => run.status === "finished").length ?? 0;

  useEffect(() => {
    let live = true;
    api.getSuccessCriteria().then(
      (found) => {
        if (!live) return;
        setCriteria(found);
        setCriteriaError(null);
      },
      (caught: unknown) => {
        if (live) setCriteriaError(caught instanceof Error ? caught.message : String(caught));
      },
    );
    return () => {
      live = false;
    };
  }, [api, finished, criteriaAttempt]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(refresh, POLL_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [running, refresh, runs]);

  const latestExam = runs ? (scored(runs).filter(isExam).at(-1) ?? null) : null;
  return (
    <section className="view" aria-labelledby="scoreboard-heading">
      <header className="page-head">
        <div>
          <p className="eyebrow">Evals · Evaluations</p>
          <h1 id="scoreboard-heading" ref={heading} tabIndex={-1}>
            Scoreboard
          </h1>
          <p className="lede">
            How the agent scores on claims a senior handler already decided. The exam is 25 claims
            it never learns from; practice runs are for quick checks.
          </p>
        </div>
      </header>
      {runs && <ExamPanel runs={runs} version={version} criteria={criteria} />}
      <SuccessCard
        api={api}
        found={criteria}
        error={criteriaError}
        onRetry={() => {
          setCriteriaError(null);
          setCriteriaAttempt((value) => value + 1);
        }}
      />
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
      {runs && runs.length > 0 && (
        <div className="live-charts">
          <ByClaimType api={api} exam={latestExam} />
          <Compare api={api} runs={runs} />
        </div>
      )}
      <StartRun api={api} onStarted={refresh} />
      {runs?.length === 0 && (
        <div className="panel empty">
          <span className="icon-tile">
            <FlaskConical size={19} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <h2>No runs yet</h2>
          <p className="muted">Start a practice run above, or an improvement round for an exam.</p>
        </div>
      )}
      {runs && runs.length > 0 && <RunsTable runs={runs} />}
    </section>
  );
}
