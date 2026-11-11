import {
  Check,
  CircleMinus,
  Clock,
  GitPullRequestArrow,
  LoaderCircle,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Api, Configuration, Round } from "../api";
import { AiMark } from "../components/AiMark";
import { Meter } from "../components/Charts";
import { TableScroll } from "../components/TableScroll";
import { when } from "../format";
import { useFocusHeading } from "../useFocusHeading";
import { runHref } from "../useHashRoute";
import { cost, words } from "./ScoreboardPage";

const POLL_MS = 3000;
const OPEN = ["baselining", "improving", "awaiting_review", "evaluating"];
const STAGE_TEXT: Record<string, string> = {
  baselining: "Evaluating the current version on both sets…",
  improving: "The improver is reading the misses and drafting a proposal…",
  awaiting_review: "A proposal is waiting for an AI engineer's review.",
  red_teaming: "Better on the held-out set. The red team is attacking it before it's kept.",
  evaluating: "Trying the approved version on the held-out set…",
  kept: "Kept: the new version is now the current one.",
  rolled_back: "Rolled back: the current version stays.",
  rejected: "Rejected by an AI engineer.",
  stopped: "Stopped.",
};

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

function roundTone(status: string): Tone {
  if (status === "kept") return "good";
  if (status === "awaiting_review") return "warn";
  if (OPEN.includes(status) || status === "red_teaming") return "info";
  return "plain";
}

function versionTone(version: Configuration): Tone {
  if (version.current || version.status === "kept") return "good";
  if (version.status === "proposed") return "warn";
  return "plain";
}

function RunLink({ label, runId }: { label: string; runId: number | null }) {
  if (runId === null) return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <a href={runHref(runId)}>run {runId}</a>
      </dd>
    </div>
  );
}

function RunLinks({ round }: { round: Round }) {
  return (
    <>
      <RunLink label="Current version, evaluation set" runId={round.baseline_eval_run} />
      <RunLink label="Current version, held-out set" runId={round.baseline_held_run} />
      <RunLink label="Proposed version, held-out set" runId={round.candidate_held_run} />
    </>
  );
}

function spentText(round: Round): string {
  return `Spent ${cost(round.spent)} of the round's ${cost(round.spend_limit)} limit`;
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
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="button" disabled={busy} onClick={() => void review(true)}>
          <Check size={15} strokeWidth={1.75} aria-hidden="true" />
          Approve and try it on the held-out set
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

interface RoundPanelProps {
  api: Api;
  round: Round;
  senior: boolean;
  /** Show the budget and runs here, for a round the side column isn't about. */
  facts: boolean;
  onChange: () => void;
}

function RoundPanel({ api, round, senior, facts, onChange }: RoundPanelProps) {
  const open = OPEN.includes(round.status);
  const awaiting = round.status === "awaiting_review";
  const verdict = round.verdict as { why?: string } | null;
  const stop = senior && open && (
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
        <Pill tone={roundTone(round.status)}>{words(round.status)}</Pill>
      </div>
      <p role="status" className="round-status">
        {STAGE_TEXT[round.status] ?? round.status}
      </p>
      {verdict?.why && <p>{verdict.why}</p>}
      {facts && (
        <>
          <p className="muted small">{spentText(round)}</p>
          <dl className="facts small">
            <RunLinks round={round} />
          </dl>
        </>
      )}
      {round.diff !== null && (
        <section className="proposal" aria-label="The proposal">
          <h3>
            <AiMark /> The improver's proposal: v{round.candidate_version}
          </h3>
          {round.proposal && <p>{String(round.proposal.reason)}</p>}
          <Diff text={round.diff} />
        </section>
      )}
      {senior && awaiting ? (
        <Review api={api} round={round} onDone={onChange} stop={stop} />
      ) : (
        stop && <div className="actions">{stop}</div>
      )}
    </article>
  );
}

/** One round's budget and the runs behind it. */
function RoundFacts({ round }: { round: Round }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Round {round.round_id}: budget and runs</h2>
      </div>
      <p className="muted small">{spentText(round)}</p>
      <Meter value={round.spend_limit > 0 ? round.spent / round.spend_limit : 0} tone="spend" />
      <dl className="facts">
        <RunLinks round={round} />
        <div>
          <dt>Keep rule</dt>
          <dd>Better on the held-out set, worse on no measure</dd>
        </div>
      </dl>
    </div>
  );
}

const NEXT = [
  { title: "An AI engineer approves or rejects", detail: "With a reason, for the record." },
  {
    title: "The approved version runs on the held-out set",
    detail: "The improver never sees these answers.",
  },
  {
    title: "Kept only if it does better",
    detail: "Without doing worse on any measure; otherwise the current version stays.",
  },
];

// Which of the three steps a round is at; rounds that ended early are at none.
const STEP_AT: Record<string, number> = {
  awaiting_review: 0,
  evaluating: 1,
  red_teaming: 2,
  kept: 3,
  rolled_back: 3,
};

function NextSteps({ round }: { round: Round | undefined }) {
  const at = round ? (STEP_AT[round.status] ?? -1) : -1;
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>What happens next</h2>
      </div>
      <ol className="next-steps">
        {NEXT.map((step, index) => {
          const state = at > index ? "done" : at === index ? "now" : undefined;
          return (
            <li
              key={step.title}
              className={state}
              aria-current={state === "now" ? "step" : undefined}
            >
              <span className="step-dot" aria-hidden="true">
                {state === "done" ? <Check size={12} strokeWidth={2.4} /> : index + 1}
              </span>
              <span>
                <strong>{step.title}</strong>
                {state === "done" && <span className="visually-hidden"> (done)</span>}
                <small>{step.detail}</small>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function ImprovementPage({ api }: { api: Api }) {
  const [rounds, setRounds] = useState<Round[] | null>(null);
  const [versions, setVersions] = useState<Configuration[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const heading = useFocusHeading();
  const refresh = useCallback(() => {
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    let live = true;
    Promise.all([api.listRounds(), api.listConfigurations()]).then(
      ([foundRounds, foundVersions]) => {
        if (!live) return;
        setRounds(foundRounds);
        setVersions(foundVersions);
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

  const current = versions.find((version) => version.current);
  const waiting = rounds?.filter((round) => round.status === "awaiting_review") ?? [];
  // The round the side column is about: the open one, or else the first listed.
  const focus = rounds?.find((round) => OPEN.includes(round.status)) ?? rounds?.[0];
  return (
    <section className="view" aria-labelledby="improvement-heading">
      <header className="page-head">
        <div>
          <p className="eyebrow">Quality · The claim agent</p>
          <h1 id="improvement-heading" ref={heading} tabIndex={-1}>
            Improvement
          </h1>
          <p className="lede">
            The improver reads where the agent disagreed with the handlers on the evaluation set and
            proposes a new configuration. An AI engineer approves or rejects it, and an approved
            version is kept only if it does better on the held-out set without doing worse on any
            measure. The improver never sees the held-out answers.
          </p>
        </div>
        <div className="page-head-side">
          {current && (
            <p className="current-version">
              <span className="label">Current version</span>
              <strong>v{current.version}</strong>, {current.model} at {current.effort} effort
            </p>
          )}
          {!open && (
            <button type="button" className="button" onClick={() => void start()}>
              <Sparkles size={15} strokeWidth={1.75} aria-hidden="true" />
              Start an improvement round
            </button>
          )}
        </div>
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
        <div className="cols">
          <div className="stack">
            {rounds.length === 0 && (
              <div className="panel empty">
                <span className="icon-tile">
                  <Sparkles size={19} strokeWidth={1.75} aria-hidden="true" />
                </span>
                <h2>No improvement rounds yet</h2>
                <p className="muted">
                  Start a round and the improver will propose a new configuration for you to review.
                </p>
              </div>
            )}
            {rounds.map((round) => (
              <RoundPanel
                key={round.round_id}
                api={api}
                round={round}
                senior
                facts={round !== focus}
                onChange={refresh}
              />
            ))}
            {versions.length > 0 && (
              <section className="panel" aria-labelledby="versions-heading">
                <div className="panel-head">
                  <h2 id="versions-heading">Versions</h2>
                </div>
                <TableScroll label="Versions table">
                  <table className="table min-mid">
                    <thead>
                      <tr>
                        <th scope="col">Version</th>
                        <th scope="col">Model and effort</th>
                        <th scope="col">Why</th>
                        <th scope="col">Status</th>
                        <th scope="col">Proposed by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {versions.map((version) => (
                        <tr key={version.version}>
                          <td className="nowrap">
                            <span className="tag">
                              v{version.version}
                              {version.current && " (current)"}
                            </span>
                          </td>
                          <td>
                            {version.model}, {version.effort}
                          </td>
                          <td className="prose">{version.reason}</td>
                          <td>
                            <Pill tone={versionTone(version)}>{words(version.status)}</Pill>
                          </td>
                          <td>{version.proposed_by}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              </section>
            )}
          </div>
          <aside className="stack" aria-label="About the round">
            {focus && <RoundFacts round={focus} />}
            <NextSteps round={focus} />
          </aside>
        </div>
      )}
    </section>
  );
}
