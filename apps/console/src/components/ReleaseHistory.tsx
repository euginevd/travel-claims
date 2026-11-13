import { useEffect, useState, type ReactNode } from "react";
import type { Api, VersionCard } from "../api";
import { when } from "../format";
import { wilson } from "../stats";
import { runHref, versionHref } from "../useHashRoute";
import { RangeBar } from "./Charts";

/** The industry's labels for a version (Langfuse's "production", MLflow's "champion"), in plain
 * words: the one in use, the one being tested against it, and the rest by what became of them. */
function labelOf(card: VersionCard): { text: string; chip: string } {
  if (card.in_use) return { text: "In use", chip: "chip chip-good" };
  if (card.status === "candidate" || card.status === "proposed") {
    return { text: "Being tested", chip: "chip chip-info" };
  }
  if (card.status === "rolled_back") return { text: "Rolled back", chip: "chip chip-warn" };
  if (card.status === "rejected") return { text: "Rejected", chip: "chip" };
  return { text: "Earlier", chip: "chip" };
}

/** Who made it: the Improver agent proposes, a person approves. */
export function madeBy(card: VersionCard): string {
  if (card.parent_version === null) return "The version the team started with";
  const by =
    card.proposed_by === "Improver"
      ? "Proposed by the Improver agent"
      : `Proposed by ${card.proposed_by}`;
  return card.reviewed_by ? `${by} · approved by ${card.reviewed_by}` : by;
}

const pct = (share: number) => `${String(Math.round(share * 100))}%`;

function Evidence({ card }: { card: VersionCard }) {
  const exam = card.exam;
  const range = exam && exam.claims > 0 ? wilson(exam.accuracy, exam.claims) : null;
  return (
    <p className="release-evidence">
      {exam ? (
        <span
          className="release-score"
          title={
            range
              ? `On more claims, likely between ${pct(range[0])} and ${pct(range[1])}`
              : undefined
          }
        >
          {pct(exam.accuracy)} right on {exam.claims} claims
          <RangeBar value={exam.accuracy} range={range} />
        </span>
      ) : (
        <span className="muted">Not examined yet</span>
      )}
      {exam && <span>${exam.cost_per_claim.toFixed(3)} a claim</span>}
      <span className={card.red_team ? undefined : "muted"}>
        {card.red_team ?? "No red-team run"}
      </span>
    </p>
  );
}

/** The agent's releases, newest first: what each changed, whether it was better, who approved
 * it and which one is in use. Rejected proposals fold away. */
export function ReleaseHistory({ api, children }: { api: Api; children?: ReactNode }) {
  const [cards, setCards] = useState<VersionCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shadowing, setShadowing] = useState<number | null>(null);
  const [shadowError, setShadowError] = useState<string | null>(null);

  // A shadow run: this version decides copies of the newest live claims (never paid), beside
  // what was decided on each; its run page shows where they'd differ.
  async function shadow(version: number) {
    setShadowing(version);
    setShadowError(null);
    try {
      const run = await api.startShadow(version);
      window.location.hash = runHref(run.run_id);
    } catch (caught) {
      setShadowError(caught instanceof Error ? caught.message : String(caught));
      setShadowing(null);
    }
  }

  useEffect(() => {
    let live = true;
    api.getVersions().then(
      (found) => {
        if (live) setCards(found);
      },
      (caught: unknown) => {
        if (live) setError(caught instanceof Error ? caught.message : String(caught));
      },
    );
    return () => {
      live = false;
    };
  }, [api]);

  if (error) {
    return (
      <section className="panel releases">
        <p className="muted">Couldn&apos;t load the versions: {error}</p>
        {children}
      </section>
    );
  }
  if (!cards) return <span className="skeleton skeleton-card" aria-hidden="true" />;
  const shown = cards.filter((card) => card.status !== "rejected" || card.in_use);
  const rejected = cards.filter((card) => card.status === "rejected" && !card.in_use);
  const row = (card: VersionCard) => {
    const label = labelOf(card);
    return (
      <li key={card.version} className={card.in_use ? "release is-live" : "release"}>
        <span className={label.chip}>{label.text}</span>
        <div className="release-body">
          <p className="release-title">
            <a href={versionHref(card.version)}>
              <span className="release-number">#{card.version}</span> {card.title}
            </a>
          </p>
          <Evidence card={card} />
          <p className="muted small">
            {madeBy(card)}, {when(card.created_at)}
          </p>
        </div>
        <span className="release-actions">
          <a className="stage-link small" href={versionHref(card.version)}>
            What changed
          </a>
          {!card.in_use && card.status !== "rejected" && (
            <button
              type="button"
              className="button secondary"
              disabled={shadowing !== null}
              title="This version decides copies of the 10 newest live claims, never paid, beside what was decided on each"
              onClick={() => void shadow(card.version)}
            >
              {shadowing === card.version ? "Starting…" : "Shadow-test"}
            </button>
          )}
        </span>
      </li>
    );
  };
  return (
    <section className="panel releases" aria-labelledby="releases-heading">
      <div className="panel-head">
        <h2 id="releases-heading">Release history</h2>
        <span className="muted small">
          {cards.length} {cards.length === 1 ? "version" : "versions"}
        </span>
      </div>
      {shadowError && (
        <p className="error" role="alert">
          {shadowError}
        </p>
      )}
      <ol className="release-list">{shown.map(row)}</ol>
      {rejected.length > 0 && (
        <details className="release-rejected">
          <summary>Rejected proposals ({rejected.length})</summary>
          <ol className="release-list">{rejected.map(row)}</ol>
        </details>
      )}
      {children}
    </section>
  );
}
