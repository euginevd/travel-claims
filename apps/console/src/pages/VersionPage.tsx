import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import type { Api, VersionCard } from "../api";
import { when } from "../format";
import { wilson } from "../stats";
import { madeBy } from "../components/ReleaseHistory";
import { useFocusHeading } from "../useFocusHeading";
import { IMPROVEMENT_HREF, runHref } from "../useHashRoute";

function share(value: number, claims: number): string {
  const range = wilson(value, claims);
  const pct = `${String(Math.round(value * 100))}%`;
  return range
    ? `${pct} right · on more claims, likely ${String(Math.round(range[0] * 100))}–${String(Math.round(range[1] * 100))}%`
    : pct;
}

/** Govern · Versions · a version: what it is and the evidence for it. */
export function VersionPage({ api, version }: { api: Api; version: number }) {
  const [card, setCard] = useState<VersionCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const heading = useFocusHeading();

  useEffect(() => {
    let live = true;
    api.getVersion(version).then(
      (found) => {
        if (live) setCard(found);
      },
      (caught: unknown) => {
        if (live) setError(caught instanceof Error ? caught.message : String(caught));
      },
    );
    return () => {
      live = false;
    };
  }, [api, version]);

  const name = card
    ? `${card.model.replace("claude-", "").replace(/-\d.*$/, "")}, ${card.effort} effort`
    : "";
  return (
    <section className="page-in" aria-labelledby="version-heading">
      <a className="crumb" href={IMPROVEMENT_HREF}>
        <ArrowLeft size={15} strokeWidth={1.75} aria-hidden="true" />
        Versions
      </a>
      <p className="eyebrow">Govern · Versions</p>
      <h1 id="version-heading" ref={heading} tabIndex={-1}>
        #{version}
        {card ? ` ${card.title}` : ""}
      </h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {card && (
        <>
          <p className="lede">
            {card.in_use ? "In use. " : `${card.status.replace("_", " ")}. `}
            {madeBy(card)}, {when(card.created_at)}. {name}.
          </p>
          <div className="version-grid">
            <div className="overview-stack">
              <section className="panel" aria-labelledby="change-heading">
                <div className="panel-head">
                  <h2 id="change-heading">
                    {card.parent_version !== null
                      ? `What changed from #${String(card.parent_version)}`
                      : "The first version"}
                  </h2>
                </div>
                <p>{card.reason}</p>
                {card.diff && <pre className="diff">{card.diff}</pre>}
              </section>
              <section className="panel" aria-labelledby="tools-heading">
                <div className="panel-head">
                  <h2 id="tools-heading">Its tools, and what it can&apos;t do</h2>
                </div>
                <p className="tool-chips">
                  {card.tools.map((tool) => (
                    <span key={tool} className="chip mono">
                      {tool}
                    </span>
                  ))}
                </p>
                <p className="muted small">
                  Every tool takes the claim and customer from the session, never from the model. It
                  can&apos;t pay: the api works the payout out in code, and over the approval limit
                  waits for a senior handler.
                </p>
              </section>
            </div>
            <section className="panel" aria-labelledby="evidence-heading">
              <div className="panel-head">
                <h2 id="evidence-heading">Evidence</h2>
              </div>
              {card.exam ? (
                <dl className="agent-facts">
                  <dt>Right decision</dt>
                  <dd>{share(card.exam.accuracy, card.exam.claims)}</dd>
                  <dt>Right amount</dt>
                  <dd>{share(card.exam.payout_accuracy, card.exam.claims)}</dd>
                  <dt>Without a person</dt>
                  <dd>{share(card.exam.straight_through, card.exam.claims)}</dd>
                  <dt>Judge</dt>
                  <dd>
                    {card.exam.grade !== null ? `${card.exam.grade.toFixed(1)} of 3` : "Not graded"}
                  </dd>
                  <dt>Cost per claim</dt>
                  <dd>{`$${card.exam.cost_per_claim.toFixed(3)}`}</dd>
                  <dt>Time per claim</dt>
                  <dd>{Math.round(card.exam.seconds_per_claim)} s</dd>
                  <dt>Red team</dt>
                  <dd>{card.red_team ?? "Not run against this version"}</dd>
                  <dt>From</dt>
                  <dd>
                    <a href={runHref(card.exam.run_id)}>
                      Run {card.exam.run_id}, {card.exam.claims} claims
                    </a>
                  </dd>
                </dl>
              ) : (
                <p className="muted small">No finished run of this version yet.</p>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}
