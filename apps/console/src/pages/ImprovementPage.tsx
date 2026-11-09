import { Check, Sparkles, Square, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Api, Configuration, Round } from "../api";
import { AiMark } from "../components/AiMark";
import { when } from "../format";
import { useFocusHeading } from "../useFocusHeading";
import { runHref } from "../useHashRoute";
import { cost } from "./ScoreboardPage";

const POLL_MS = 3000;
const OPEN = ["baselining", "improving", "awaiting_review", "evaluating"];
const STAGE_TEXT: Record<string, string> = {
  baselining: "Evaluating the current version on both sets…",
  improving: "The improver is reading the misses and drafting a proposal…",
  awaiting_review: "A proposal is waiting for an AI engineer's review.",
  evaluating: "Trying the approved version on the held-out set…",
  kept: "Kept: the new version is now the current one.",
  rolled_back: "Rolled back: the current version stays.",
  rejected: "Rejected by an AI engineer.",
  stopped: "Stopped.",
};

function RunLink({ label, runId }: { label: string; runId: number | null }) {
  if (runId === null) return null;
  return (
    <li>
      {label}: <a href={runHref(runId)}>run {runId}</a>
    </li>
  );
}

function Review({ api, round, onDone }: { api: Api; round: Round; onDone: () => void }) {
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
          <Check size={16} strokeWidth={2} aria-hidden="true" />
          Approve and try it on the held-out set
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => void review(false)}
        >
          <X size={16} strokeWidth={2} aria-hidden="true" />
          Reject
        </button>
      </div>
    </div>
  );
}

function RoundPanel(props: { api: Api; round: Round; senior: boolean; onChange: () => void }) {
  const { api, round, senior, onChange } = props;
  const open = OPEN.includes(round.status);
  const verdict = round.verdict as { why?: string } | null;
  return (
    <article className="panel round" aria-labelledby={`round-${String(round.round_id)}`}>
      <h2 id={`round-${String(round.round_id)}`}>
        Round {round.round_id}
        <span className="muted small">
          {" "}
          · started {when(round.started_at)} by {round.started_by}
        </span>
      </h2>
      <p role="status">{STAGE_TEXT[round.status] ?? round.status}</p>
      {verdict?.why && <p>{verdict.why}</p>}
      <p className="muted small">
        Spent {cost(round.spent)} of the round's {cost(round.spend_limit)} limit
      </p>
      <ul className="muted small">
        <RunLink label="Current version, evaluation set" runId={round.baseline_eval_run} />
        <RunLink label="Current version, held-out set" runId={round.baseline_held_run} />
        <RunLink label="Proposed version, held-out set" runId={round.candidate_held_run} />
      </ul>
      {round.diff !== null && (
        <section aria-label="The proposal">
          <h3>
            <AiMark /> The improver's proposal: v{round.candidate_version}
          </h3>
          {round.proposal && <p>{String(round.proposal.reason)}</p>}
          <pre className="diff">{round.diff || "(no change to the text)"}</pre>
        </section>
      )}
      {senior && round.status === "awaiting_review" && (
        <Review api={api} round={round} onDone={onChange} />
      )}
      {senior && open && (
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            void api.stopRound(round.round_id).then(onChange, onChange);
          }}
        >
          <Square size={16} strokeWidth={2} aria-hidden="true" />
          Stop the round
        </button>
      )}
    </article>
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
  return (
    <section aria-labelledby="improvement-heading">
      <p className="eyebrow">Quality · The claim agent</p>
      <h1 id="improvement-heading" ref={heading} tabIndex={-1}>
        Improvement
      </h1>
      <p className="muted">
        The improver reads where the agent disagreed with the handlers on the evaluation set and
        proposes a new configuration. An AI engineer approves or rejects it, and an approved version
        is kept only if it does better on the held-out set without doing worse on any measure. The
        improver never sees the held-out answers.
      </p>
      {current && (
        <p>
          Current: <strong>v{current.version}</strong>, {current.model} at {current.effort} effort
        </p>
      )}
      {!open && (
        <button type="button" className="button" onClick={() => void start()}>
          <Sparkles size={16} strokeWidth={2} aria-hidden="true" />
          Start an improvement round
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
          <button type="button" className="button secondary" onClick={refresh}>
            Try again
          </button>
        </p>
      )}
      {!rounds && !error && <p role="status">Loading the rounds…</p>}
      {rounds?.map((round) => (
        <RoundPanel key={round.round_id} api={api} round={round} senior onChange={refresh} />
      ))}
      {versions.length > 0 && (
        <section aria-labelledby="versions-heading">
          <h2 id="versions-heading">Versions</h2>
          {/* A scrollable region must take focus so keyboard users can scroll it (WCAG 2.1.1). */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
          <div className="table-wrap" role="region" aria-label="Versions table" tabIndex={0}>
            <table className="table">
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
                      v{version.version}
                      {version.current && " (current)"}
                    </td>
                    <td>
                      {version.model}, {version.effort}
                    </td>
                    <td>{version.reason}</td>
                    <td>{version.status.replace("_", " ")}</td>
                    <td>{version.proposed_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}
