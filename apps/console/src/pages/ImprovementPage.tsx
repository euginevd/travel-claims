import {
  Check,
  CircleMinus,
  Clock,
  GitPullRequestArrow,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  Square,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Api, Configuration, Round, Run, Scores } from "../api";
import { AiMark } from "../components/AiMark";
import { Meter } from "../components/Charts";
import { RunDiff } from "../components/RunDiff";
import { TableScroll } from "../components/TableScroll";
import { when } from "../format";
import { modelName } from "../traceTimeline";
import { useFocusHeading } from "@undercover/web-core/useFocusHeading";
import { runHref } from "../useHashRoute";
import { cost } from "./ScoreboardPage";

const POLL_MS = 3000;
const OPEN = ["baselining", "improving", "awaiting_review", "evaluating", "red_teaming"];

type Tone = "good" | "warn" | "info" | "plain";

const TONE_CLASS: Record<Tone, string> = {
  good: "chip chip-good",
  warn: "chip chip-warn",
  info: "chip chip-info",
  plain: "chip",
};

/** A status as a pill: its word and an icon for its tone. */
function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  const Icon = { good: Check, warn: Clock, info: LoaderCircle, plain: CircleMinus }[tone];
  return (
    <span className={TONE_CLASS[tone]}>
      <Icon
        className={tone === "info" ? "spin" : undefined}
        size={13}
        strokeWidth={1.75}
        aria-hidden="true"
      />
      {children}
    </span>
  );
}

interface Verdict {
  kept?: boolean;
  outcome?: "better" | "worse" | "unclear";
  why?: string;
  baseline?: Scores;
  candidate?: Scores;
}

function verdictOf(round: Round): Verdict {
  return round.verdict ?? {};
}

/** How a round ended, in a word: rounds from before "no clear difference" read from their why. */
function result(round: Round): { tone: Tone; label: string } {
  if (OPEN.includes(round.status)) {
    return round.status === "awaiting_review"
      ? { tone: "warn", label: "Needs your review" }
      : { tone: "info", label: "Running" };
  }
  if (round.status === "kept") return { tone: "good", label: "Kept" };
  if (round.status === "rejected") return { tone: "plain", label: "Rejected" };
  if (round.status === "stopped") return { tone: "plain", label: "Stopped" };
  const verdict = verdictOf(round);
  const unclear = verdict.outcome === "unclear" || verdict.why?.includes("no measure improved");
  return { tone: "plain", label: unclear ? "No clear difference" : "Rolled back" };
}

/** The proposal in one sentence: what changes from the version it started from. */
function changeOf(round: Round, versions: Configuration[]): string | null {
  const before = versions.find((v) => v.version === round.baseline_version);
  const after = versions.find((v) => v.version === round.candidate_version);
  if (!before || !after) return null;
  const parts: string[] = [];
  if (before.model !== after.model) {
    parts.push(`Switch ${modelName(before.model)} → ${modelName(after.model)}`);
  }
  if (before.effort !== after.effort) parts.push(`effort ${before.effort} → ${after.effort}`);
  parts.push(
    before.instructions === after.instructions ? "instructions unchanged" : "instructions changed",
  );
  const sentence = parts.join(", ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

// The round's path, and which step each status is at.
const STEPS = ["Baseline", "Proposal", "Your review", "Exam (25 claims)", "Red team", "Result"];
const STEP_AT: Record<string, number> = {
  baselining: 0,
  improving: 1,
  awaiting_review: 2,
  evaluating: 3,
  red_teaming: 4,
};

function Stepper({ round }: { round: Round }) {
  const at = STEP_AT[round.status] ?? STEPS.length;
  return (
    <ol className="round-steps" aria-label="Where the round is">
      {STEPS.map((step, index) => {
        const state = index < at ? "done" : index === at ? "now" : undefined;
        return (
          <li key={step} className={state} aria-current={state === "now" ? "step" : undefined}>
            <span className="step-dot" aria-hidden="true">
              {state === "done" ? <Check size={11} strokeWidth={2.4} /> : index + 1}
            </span>
            {step}
            {state === "done" && <span className="visually-hidden"> (done)</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Review(props: { api: Api; round: Round; onDone: () => void; stop: ReactNode }) {
  const { api, round, onDone, stop } = props;
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function review(approve: boolean) {
    if (!reason.trim()) {
      setError("Say why, for the record.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.reviewRound(round.round_id, approve, reason.trim());
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="review">
      <label htmlFor="review-reason">Your reason</label>
      <textarea
        id="review-reason"
        value={reason}
        maxLength={1000}
        disabled={busy}
        onChange={(event) => {
          setReason(event.target.value);
        }}
      />
      <p className="small muted">
        If you approve, it takes the 25-claim exam, then faces the red team, within the round&apos;s
        spending limit.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="button" disabled={busy} onClick={() => void review(true)}>
          <Check size={15} strokeWidth={1.75} aria-hidden="true" />
          Approve and run the exam
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => void review(false)}
        >
          <X size={15} strokeWidth={1.75} aria-hidden="true" />
          Reject
        </button>
        {stop}
      </div>
    </div>
  );
}

/** A diff with its removed lines red-tinted and its added lines green-tinted. */
function Diff({ text }: { text: string }) {
  if (!text) {
    return (
      <pre className="diff">
        <span className="diff-line note">(no change to the text)</span>
      </pre>
    );
  }
  return (
    <pre className="diff">
      {text.split("\n").map((line, index) => {
        const header = line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@");
        const kind = header
          ? " hunk"
          : line.startsWith("+")
            ? " add"
            : line.startsWith("-")
              ? " del"
              : "";
        return (
          <span key={index} className={`diff-line${kind}`}>
            {line}
          </span>
        );
      })}
    </pre>
  );
}

const MEASURES: [key: "accuracy" | "payout_accuracy" | "straight_through", label: string][] = [
  ["accuracy", "Right decision"],
  ["payout_accuracy", "Right amount"],
  ["straight_through", "Decided without a person"],
];

function percent(share: number): string {
  return `${String(Math.round(share * 100))}%`;
}

function Change({ by, unit }: { by: number; unit: "claims" | "cost" }) {
  if (unit === "cost") {
    const pct = Math.round(by * 100);
    if (pct === 0) return <span className="muted">same</span>;
    const cheaper = pct < 0;
    return (
      <span className={cheaper ? "change up" : "change down"}>
        {cheaper ? (
          <TrendingDown size={13} strokeWidth={1.75} aria-hidden="true" />
        ) : (
          <TrendingUp size={13} strokeWidth={1.75} aria-hidden="true" />
        )}
        {`${String(Math.abs(pct))}% ${cheaper ? "cheaper" : "dearer"}`}
      </span>
    );
  }
  if (by === 0) return <span className="muted">same</span>;
  return (
    <span className={by > 0 ? "change up" : "change down"}>
      {by > 0 ? (
        <TrendingUp size={13} strokeWidth={1.75} aria-hidden="true" />
      ) : (
        <TrendingDown size={13} strokeWidth={1.75} aria-hidden="true" />
      )}
      {`${by > 0 ? "+" : "−"}${String(Math.abs(by))} ${Math.abs(by) === 1 ? "claim" : "claims"}`}
    </span>
  );
}

/** The exam's measures for the old and new version side by side, with the change in claims. */
function BeforeAfter({ round, verdict }: { round: Round; verdict: Verdict }) {
  const { baseline, candidate } = verdict;
  if (!baseline || !candidate) return null;
  const claims = Math.min(baseline.claims, candidate.claims) || 1;
  return (
    <TableScroll label="Before and after table">
      <table className="table">
        <caption className="small muted">
          The exam: {candidate.claims} held-out claims neither version had seen the answers to
        </caption>
        <thead>
          <tr>
            <th scope="col">Measure</th>
            <th scope="col" className="num">
              v{round.baseline_version}
            </th>
            <th scope="col" className="num">
              v{round.candidate_version}
            </th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        <tbody>
          {MEASURES.map(([key, label]) => (
            <tr key={key}>
              <th scope="row">{label}</th>
              <td className="num">{percent(baseline[key])}</td>
              <td className="num">{percent(candidate[key])}</td>
              <td>
                <Change by={Math.round((candidate[key] - baseline[key]) * claims)} unit="claims" />
              </td>
            </tr>
          ))}
          <tr>
            <th scope="row">Cost per claim</th>
            <td className="num">{cost(baseline.cost_per_claim)}</td>
            <td className="num">{cost(candidate.cost_per_claim)}</td>
            <td>
              <Change
                by={
                  baseline.cost_per_claim > 0
                    ? candidate.cost_per_claim / baseline.cost_per_claim - 1
                    : 0
                }
                unit="cost"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </TableScroll>
  );
}

/** Each exam claim the two versions decided differently, lost ones first. */
function ClaimByClaim({ api, round }: { api: Api; round: Round }) {
  if (round.baseline_held_run === null || round.candidate_held_run === null) return null;
  return (
    <RunDiff
      api={api}
      before={round.baseline_held_run}
      after={round.candidate_held_run}
      beforeLabel={`v${String(round.baseline_version)}`}
      afterLabel={`v${String(round.candidate_version)}`}
      headingId={`pairs-${String(round.round_id)}`}
    />
  );
}

interface RoundPanelProps {
  api: Api;
  round: Round;
  versions: Configuration[];
  onChange: () => void;
}

/** The latest round: where it is, what it proposes, and how the exam went. */
function RoundPanel({ api, round, versions, onChange }: RoundPanelProps) {
  const open = OPEN.includes(round.status);
  const awaiting = round.status === "awaiting_review";
  const verdict = verdictOf(round);
  const ended = result(round);
  const change = changeOf(round, versions);
  const stop = open && (
    <button
      type="button"
      className={`button secondary${awaiting ? " end" : ""}`}
      onClick={() => {
        void api.stopRound(round.round_id).then(onChange, onChange);
      }}
    >
      <Square size={14} strokeWidth={1.75} aria-hidden="true" />
      Stop the round
    </button>
  );
  return (
    <article className="panel round" aria-labelledby={`round-${String(round.round_id)}`}>
      <div className="panel-head">
        <h2 id={`round-${String(round.round_id)}`}>
          Round {round.round_id}
          <span className="muted small">
            {" "}
            · started {when(round.started_at)} by {round.started_by}
          </span>
        </h2>
        <Pill tone={ended.tone}>{ended.label}</Pill>
      </div>
      <Stepper round={round} />
      {verdict.why && (
        <p role="status" className="round-verdict">
          {verdict.why}.
        </p>
      )}
      {round.candidate_version !== null && (
        <section className="proposal" aria-label="The proposal">
          <h3>
            <AiMark /> The improver proposes v{round.candidate_version}
          </h3>
          {change && <p className="proposal-change">{change}</p>}
          {round.proposal && <p className="muted">{String(round.proposal.reason)}</p>}
          {round.diff !== null && (
            <details className="proposal-diff">
              <summary>Show the full change</summary>
              <Diff text={round.diff} />
            </details>
          )}
        </section>
      )}
      {awaiting ? (
        <Review api={api} round={round} onDone={onChange} stop={stop} />
      ) : (
        stop && <div className="actions">{stop}</div>
      )}
      <BeforeAfter round={round} verdict={verdict} />
      {!open && <ClaimByClaim api={api} round={round} />}
      <div className="round-budget">
        <p className="small muted">
          Spent {cost(round.spent)} of the round&apos;s {cost(round.spend_limit)} limit
          {round.baseline_held_run !== null && (
            <>
              {" · runs "}
              {[round.baseline_eval_run, round.baseline_held_run, round.candidate_held_run]
                .filter((id): id is number => id !== null)
                .map((id, index) => (
                  <span key={id}>
                    {index > 0 && ", "}
                    <a href={runHref(id)}>{id}</a>
                  </span>
                ))}
            </>
          )}
        </p>
        <Meter value={round.spend_limit > 0 ? round.spent / round.spend_limit : 0} tone="spend" />
      </div>
    </article>
  );
}

/** The version in use, its exam score, and the way back to an earlier kept version. */
function CurrentVersion(props: {
  api: Api;
  versions: Configuration[];
  runs: Run[];
  locked: boolean;
  onChange: () => void;
}) {
  const { api, versions, runs, locked, onChange } = props;
  const current = versions.find((v) => v.current);
  const earlier = versions.filter((v) => v.status === "kept" && !v.current);
  const [target, setTarget] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!current) return null;
  const exam = runs.find(
    (run) => run.config_version === current.version && run.label_set === "held_out" && run.scores,
  );
  const examsRun = runs.filter((run) => run.label_set === "held_out").length;
  const chosen = target ?? earlier[0]?.version ?? null;

  async function restore() {
    if (chosen === null) return;
    if (!reason.trim()) {
      setError("Say why, for the record.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.restoreVersion(chosen, reason.trim());
      setReason("");
      // The version restored is now the one in use, so it's no longer a choice.
      setTarget(null);
      onChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel current-panel">
      <div className="panel-head">
        <h2>
          In use: v{current.version}
          <span className="tag mono">{current.model}</span>
        </h2>
        <span className="chip chip-good">
          <Check size={13} strokeWidth={1.75} aria-hidden="true" />
          {current.proposed_by === "Improver"
            ? "Passed its exam and the red team"
            : "First version"}
        </span>
      </div>
      <dl className="stage-rows">
        <div>
          <dt>Effort</dt>
          <dd>{current.effort}</dd>
        </div>
        <div>
          <dt>Latest exam: right decision</dt>
          <dd>
            {exam?.scores
              ? `${percent(exam.scores.accuracy)} of ${String(exam.scores.claims)}`
              : "Not examined yet"}
          </dd>
        </div>
        <div>
          <dt>Latest exam: cost per claim</dt>
          <dd>{exam?.scores ? cost(exam.scores.cost_per_claim) : "–"}</dd>
        </div>
        <div>
          <dt>Exam set used</dt>
          <dd>{`${String(examsRun)} ${examsRun === 1 ? "time" : "times"}`}</dd>
        </div>
      </dl>
      {examsRun >= 10 && (
        <p className="small muted">
          The more often the same exam is used, the more a version can pass it by chance. Add new
          labelled claims from Live to keep it honest.
        </p>
      )}
      {earlier.length > 0 && (
        <details className="rollback">
          <summary>
            <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />
            Roll back to an earlier version
          </summary>
          <div className="rollback-form">
            <label htmlFor="rollback-version">Version</label>
            <select
              id="rollback-version"
              value={chosen ?? ""}
              disabled={busy || locked}
              onChange={(event) => {
                setTarget(Number(event.target.value));
              }}
            >
              {earlier.map((v) => (
                <option key={v.version} value={v.version}>
                  v{v.version}: {modelName(v.model)}, {v.effort} effort
                </option>
              ))}
            </select>
            <label htmlFor="rollback-reason">Why</label>
            <textarea
              id="rollback-reason"
              value={reason}
              maxLength={200}
              disabled={busy || locked}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
            {locked && <p className="small muted">Finish or stop the open round first.</p>}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button
              type="button"
              className="button secondary"
              disabled={busy || locked}
              onClick={() => void restore()}
            >
              <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />
              {chosen === null ? "Roll back" : `Roll back to v${String(chosen)}`}
            </button>
          </div>
        </details>
      )}
    </div>
  );
}

/** Earlier rounds, one line each. */
function PastRounds({ rounds, versions }: { rounds: Round[]; versions: Configuration[] }) {
  if (rounds.length === 0) return null;
  return (
    <section className="panel" aria-labelledby="past-rounds-heading">
      <div className="panel-head">
        <h2 id="past-rounds-heading">Earlier rounds</h2>
      </div>
      <TableScroll label="Earlier rounds table">
        <table className="table min-mid">
          <thead>
            <tr>
              <th scope="col">Round</th>
              <th scope="col">Proposal</th>
              <th scope="col">Result</th>
              <th scope="col" className="num">
                Spent
              </th>
            </tr>
          </thead>
          <tbody>
            {rounds.map((round) => {
              const ended = result(round);
              return (
                <tr key={round.round_id}>
                  <th scope="row" className="nowrap">
                    Round {round.round_id}
                    <span className="sub">{when(round.started_at)}</span>
                  </th>
                  <td className="prose">
                    {changeOf(round, versions) ?? "No proposal"}
                    {verdictOf(round).why && <span className="sub">{verdictOf(round).why}</span>}
                  </td>
                  <td>
                    <Pill tone={ended.tone}>{ended.label}</Pill>
                  </td>
                  <td className="num">{cost(round.spent)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
    </section>
  );
}

const STATUS_WORDS: Record<string, string> = {
  kept: "Kept",
  rolled_back: "Rolled back",
  rejected: "Rejected",
  proposed: "Proposed",
  candidate: "Being tested",
};

export function ImprovementPage({ api }: { api: Api }) {
  const [rounds, setRounds] = useState<Round[] | null>(null);
  const [versions, setVersions] = useState<Configuration[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const heading = useFocusHeading();
  const refresh = useCallback(() => {
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    let live = true;
    // The runs only feed the exam score and counter: without them the page still works.
    const runsOrNone = api.listRuns().catch(() => [] as Run[]);
    Promise.all([api.listRounds(), api.listConfigurations(), runsOrNone]).then(
      ([foundRounds, foundVersions, foundRuns]) => {
        if (!live) return;
        setRounds(foundRounds);
        setVersions(foundVersions);
        setRuns(foundRuns);
        setError(null);
      },
      (caught: unknown) => {
        if (live) setError(caught instanceof Error ? caught.message : String(caught));
      },
    );
    return () => {
      live = false;
    };
  }, [api, generation]);

  const open = rounds?.some((round) => OPEN.includes(round.status)) ?? false;
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(refresh, POLL_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open, refresh, rounds]);

  async function start() {
    try {
      await api.startRound();
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  const waiting = rounds?.filter((round) => round.status === "awaiting_review") ?? [];
  const [latest, ...earlier] = rounds ?? [];
  return (
    <section className="view" aria-labelledby="improvement-heading">
      <header className="page-head">
        <div>
          <p className="eyebrow">Evals · Improvement</p>
          <h1 id="improvement-heading" ref={heading} tabIndex={-1}>
            Improvement
          </h1>
          <p className="lede">
            An AI proposes a better version of the claim agent; you decide whether to try it. It
            goes live only if it does better on a 25-claim exam it never saw the answers to, worse
            on nothing, and holds against the red team.
          </p>
        </div>
        {!open && (
          <div className="page-head-side">
            <button type="button" className="button" onClick={() => void start()}>
              <Sparkles size={15} strokeWidth={1.75} aria-hidden="true" />
              Start an improvement round
            </button>
          </div>
        )}
      </header>
      {waiting.map((round) => (
        <div key={round.round_id} className="banner">
          <GitPullRequestArrow size={18} strokeWidth={1.75} aria-hidden="true" />
          <p>
            <strong>Round {round.round_id} needs your review.</strong> Started{" "}
            {when(round.started_at)} by {round.started_by}.
          </p>
        </div>
      ))}
      {error && (
        <p className="error" role="alert">
          {error}
          <button type="button" className="button secondary" onClick={refresh}>
            Try again
          </button>
        </p>
      )}
      {!rounds && !error && (
        <p role="status" className="loading">
          <LoaderCircle className="spin" size={16} strokeWidth={1.75} aria-hidden="true" />
          Loading the rounds…
        </p>
      )}
      {rounds && (
        <div className="cols wide-side">
          <div className="stack">
            {latest ? (
              <RoundPanel api={api} round={latest} versions={versions} onChange={refresh} />
            ) : (
              <div className="panel empty">
                <span className="icon-tile">
                  <Sparkles size={19} strokeWidth={1.75} aria-hidden="true" />
                </span>
                <h2>No improvement rounds yet</h2>
                <p className="muted">
                  Start a round and the improver will propose a new version for you to review.
                </p>
              </div>
            )}
            <PastRounds rounds={earlier} versions={versions} />
          </div>
          <aside className="stack" aria-label="The claim agent's versions">
            <CurrentVersion
              api={api}
              versions={versions}
              runs={runs}
              locked={open}
              onChange={refresh}
            />
            {versions.length > 0 && (
              <section className="panel" aria-labelledby="versions-heading">
                <div className="panel-head">
                  <h2 id="versions-heading">Versions</h2>
                </div>
                <ul className="version-list">
                  {versions.map((version) => (
                    <li key={version.version}>
                      <span className="tag">v{version.version}</span>
                      <span>
                        {modelName(version.model)}, {version.effort}
                        <span className="sub">by {version.proposed_by}</span>
                      </span>
                      <span className="small">
                        {version.current
                          ? "In use"
                          : (STATUS_WORDS[version.status] ?? version.status)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
