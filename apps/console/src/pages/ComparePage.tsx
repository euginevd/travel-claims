import { useFocusHeading } from "@undercover/web-core/useFocusHeading";
import { Check } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Api, CompareResult, Comparison, ModelChoice } from "../api";
import { when } from "../format";
import { IMPROVEMENT_HREF, runHref, traceHref } from "../useHashRoute";

const MOST = 3;
const SIZES = [
  { size: "tiny", claims: 5, label: "5 claims" },
  { size: "whole", claims: 25, label: "25" },
] as const;
const POLL_MS = 5000;
// One colour a model, the same on every chart and card.
const COLOURS: Record<string, string> = {
  "claude-haiku-5-5": "#3d6b3a",
  "claude-sonnet-5-5": "#2f5f8a",
  "claude-opus-5-5": "#7a4f9a",
  "claude-fable-5-2": "#b0632a",
};
const colour = (model: string) => COLOURS[model] ?? "#57534c";
const EFFORT_SHORT: Record<string, string> = { medium: "med" };

const pct = (share: number | null) =>
  share === null ? "—" : `${String(Math.round(share * 100))}%`;

/** Dollars a claim: tenths of a cent shown, as model calls cost that little. */
export function perClaim(value: number | null): string {
  if (value === null) return "—";
  return value < 0.01 ? `$${value.toFixed(3)}` : `$${value.toFixed(2)}`;
}

function price(value: number): string {
  return value < 1 ? `$${value.toFixed(2)}` : `$${String(value)}`;
}

/** What a comparison will cost: each model's estimate a claim, times the claims and runs. */
export function estimate(
  models: ModelChoice[],
  picks: Record<string, string>,
  claims: number,
  repeats: number,
): number {
  return models
    .filter((model) => model.id in picks)
    .reduce((sum, model) => sum + model.cost_per_claim * claims * repeats, 0);
}

function Pick({
  model,
  effort,
  full,
  onToggle,
  onEffort,
}: {
  model: ModelChoice;
  effort: string | undefined;
  full: boolean;
  onToggle: () => void;
  onEffort: (effort: string) => void;
}) {
  const on = effort !== undefined;
  const disabled = !model.offered || (!on && full);
  return (
    <div className={`model-pick${on ? " is-on" : ""}${model.offered ? "" : " is-off"}`}>
      <div className="model-pick-top">
        <span>
          <span className="model-dot" style={{ background: colour(model.id) }} />
          <b>{model.label}</b>
        </span>
        <input
          type="checkbox"
          aria-label={`Compare ${model.label}`}
          checked={on}
          disabled={disabled}
          onChange={onToggle}
        />
      </div>
      <span className="hint">
        {model.in_use ? (
          <span className="chip">In use · {model.in_use_effort}</span>
        ) : (
          model.good_for
        )}
        {model.may_decline && " · may decline"}
      </span>
      <dl className="model-facts">
        <dt>Price in / out</dt>
        <dd>
          {price(model.input_price)} / {price(model.output_price)}
        </dd>
        <dt>Speed</dt>
        <dd>{model.speed}</dd>
        <dt>A claim, about</dt>
        <dd>{perClaim(model.cost_per_claim)}</dd>
        <dt>In Australia</dt>
        <dd>{model.offered ? "Yes" : "Not offered"}</dd>
      </dl>
      <fieldset className="effort-switch" disabled={!on}>
        <legend className="visually-hidden">{model.label} effort</legend>
        {model.efforts.map((level) => (
          <label key={level} className={(effort ?? model.default_effort) === level ? "on" : ""}>
            <input
              type="radio"
              name={`effort-${model.id}`}
              checked={(effort ?? model.default_effort) === level}
              onChange={() => {
                onEffort(level);
              }}
            />
            {EFFORT_SHORT[level] ?? level}
          </label>
        ))}
      </fieldset>
    </div>
  );
}

/** Right decisions against cost a claim, one dot a model with its likely range; cost on a log
 * scale, the target dashed, up and to the left is better. */
export function CostChart({ results, target }: { results: CompareResult[]; target: number }) {
  const shown = results.filter((r) => r.accuracy !== null && r.cost_per_claim !== null);
  if (shown.length === 0) return null;
  const width = 560;
  const height = 240;
  const left = 46;
  const bottom = 210;
  const top = 18;
  const costs = shown.map((r) => Math.log10(Math.max(r.cost_per_claim ?? 0.0001, 0.0001)));
  const lowX = Math.floor(Math.min(...costs)) - 0.2;
  const highX = Math.ceil(Math.max(...costs)) + 0.2;
  const floor = Math.min(0.4, ...shown.map((r) => r.low ?? 1));
  const x = (cost: number) =>
    left + ((Math.log10(Math.max(cost, 0.0001)) - lowX) / (highX - lowX)) * (width - left - 20);
  const y = (share: number) => bottom - ((share - floor) / (1 - floor)) * (bottom - top);
  const ticks = Array.from(
    { length: Math.round(highX - lowX) + 1 },
    (_, i) => Math.ceil(lowX) + i,
  ).filter((power) => power <= highX);
  return (
    <svg
      className="cost-chart"
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      role="img"
      aria-label={shown
        .map(
          (r) =>
            `${r.label} ${r.effort}: ${pct(r.accuracy)} right at ${perClaim(r.cost_per_claim)} a claim`,
        )
        .join("; ")}
    >
      <rect
        className="chart-under"
        x={left}
        y={y(target)}
        width={width - left - 20}
        height={bottom - y(target)}
      />
      <line className="chart-axis" x1={left} x2={width - 20} y1={bottom} y2={bottom} />
      <line className="chart-axis" x1={left} x2={left} y1={top} y2={bottom} />
      <line className="chart-target" x1={left} x2={width - 20} y1={y(target)} y2={y(target)} />
      <text x={left + 4} y={y(target) - 5}>
        target {pct(target)}
      </text>
      <text x={4} y={top + 4}>
        100%
      </text>
      <text x={4} y={bottom}>
        {pct(floor)}
      </text>
      {ticks.map((power) => (
        <text key={power} x={x(10 ** power) - 14} y={bottom + 16}>
          ${10 ** power >= 1 ? String(10 ** power) : (10 ** power).toFixed(-power)}
        </text>
      ))}
      {shown.map((r) => (
        <g key={`${r.model}:${r.effort}`}>
          <line
            x1={x(r.cost_per_claim ?? 0)}
            x2={x(r.cost_per_claim ?? 0)}
            y1={y(r.high ?? r.accuracy ?? 0)}
            y2={y(r.low ?? r.accuracy ?? 0)}
            stroke={colour(r.model)}
            strokeWidth="4"
            strokeLinecap="round"
            opacity="0.25"
          />
          <circle
            cx={x(r.cost_per_claim ?? 0)}
            cy={y(r.accuracy ?? 0)}
            r="8"
            fill={colour(r.model)}
          />
          <text
            className="chart-name"
            x={x(r.cost_per_claim ?? 0) + 12}
            y={y(r.accuracy ?? 0) + 4}
            style={{ fill: colour(r.model) }}
          >
            {r.label} {pct(r.accuracy)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function ResultCard({
  result,
  cheapest,
  onPropose,
  proposing,
}: {
  result: CompareResult;
  cheapest: boolean;
  onPropose: () => void;
  proposing: boolean;
}) {
  const done = result.finished === result.planned;
  return (
    <article className={`compare-card${cheapest ? " is-best" : ""}`}>
      <div className="compare-card-top">
        <b>
          <span className="model-dot" style={{ background: colour(result.model) }} />
          {result.label} <span className="hint">{result.effort}</span>
        </b>
        {cheapest ? (
          <span className="chip chip-good">Cheapest pass</span>
        ) : result.passes === true ? (
          <span className="chip chip-good">Pass</span>
        ) : result.passes === false ? (
          <span className="chip chip-bad">Misses a target</span>
        ) : (
          <span className="chip">
            {done ? "No scores" : `Run ${String(result.finished + 1)} of ${String(result.planned)}`}
          </span>
        )}
      </div>
      <p className="compare-big">
        {pct(result.accuracy)}{" "}
        <span className="hint">
          right
          {result.low !== null && result.high !== null
            ? ` · likely ${pct(result.low)}–${pct(result.high)}`
            : ""}
        </span>
      </p>
      {result.by_run.length > 0 && (
        <span
          className="compare-runs"
          aria-label={`Each run: ${result.by_run.map(pct).join(", ")}`}
        >
          {result.by_run.map((share, index) => (
            <i
              key={index}
              title={`Run ${String(index + 1)}: ${pct(share)}`}
              style={{ height: `${String(Math.max(4, Math.round(share * 28)))}px` }}
            />
          ))}
          <span className="hint">
            {result.by_run.length === 1
              ? "one run"
              : new Set(result.by_run).size === 1
                ? "the same each run"
                : "varies by run"}
          </span>
        </span>
      )}
      <dl className="compare-stats">
        <div>
          <dt>Right amount</dt>
          <dd>{pct(result.payout_accuracy)}</dd>
        </div>
        <div>
          <dt>Decided alone</dt>
          <dd>{pct(result.straight_through)}</dd>
        </div>
        <div>
          <dt>Declined</dt>
          <dd>{result.declined}</dd>
        </div>
        <div>
          <dt>Cost a claim</dt>
          <dd>{perClaim(result.cost_per_claim)}</dd>
        </div>
        <div>
          <dt>Time a claim</dt>
          <dd>
            {result.seconds_per_claim === null
              ? "—"
              : `${String(Math.round(result.seconds_per_claim))} s`}
          </dd>
        </div>
        <div>
          <dt>Reasons</dt>
          <dd>{result.grade === null ? "—" : `${result.grade.toFixed(1)} of 3`}</dd>
        </div>
      </dl>
      <div className="compare-card-foot">
        <span className="small">
          {result.runs.map((runId, index) => (
            <span key={runId}>
              {index > 0 && ", "}
              <a href={runHref(runId)}>Run {runId}</a>
            </span>
          ))}
        </span>
        {result.in_use ? (
          <span className="chip">In use</span>
        ) : (
          done &&
          result.passes === true && (
            <button
              type="button"
              className="button secondary small-button"
              disabled={proposing}
              title="An improvement round with this model in the improver's place: a person approves it, then the exam decides"
              onClick={onPropose}
            >
              Propose
            </button>
          )
        )}
      </div>
    </article>
  );
}

function answerOf(found: Comparison): string {
  if (found.answer) return found.answer;
  if (found.status === "running")
    return "Running: the first model's results show here when its run finishes.";
  return "No scores: the runs stopped before finishing.";
}

/** Evaluate · Compare: the same practice claims on up to three models and efforts, to find the
 * right answer for the least money. Nothing here changes the live agent: Propose hands a model
 * to an improvement round, where a person approves it and the exam decides. */
export function ComparePage({ api }: { api: Api }) {
  const heading = useFocusHeading();
  const [models, setModels] = useState<ModelChoice[] | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [size, setSize] = useState<"tiny" | "whole">("tiny");
  const [repeats, setRepeats] = useState(1);
  const [found, setFound] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    api.listCompareModels().then(
      (list) => {
        if (!live) return;
        setModels(list);
        // Start from the model in use, so the first comparison has its baseline.
        const current = list.find((model) => model.in_use);
        if (current) setPicks({ [current.id]: current.in_use_effort ?? current.default_effort });
      },
      (caught: unknown) => {
        if (live) setError(caught instanceof Error ? caught.message : String(caught));
      },
    );
    return () => {
      live = false;
    };
  }, [api]);

  useEffect(() => {
    let live = true;
    api.latestComparison().then(
      (latest) => {
        if (live) setFound(latest);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api, tick]);

  const running = found?.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => {
      setTick((value) => value + 1);
    }, POLL_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [running, tick]);

  const toggle = useCallback((model: ModelChoice) => {
    setPicks((now) =>
      model.id in now
        ? Object.fromEntries(Object.entries(now).filter(([id]) => id !== model.id))
        : { ...now, [model.id]: model.default_effort },
    );
  }, []);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      setFound(
        await api.startComparison({
          picks: Object.entries(picks).map(([model, effort]) => ({ model, effort })),
          size,
          repeats,
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!found) return;
    try {
      setFound(await api.stopComparison(found.compare_id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function propose(result: CompareResult) {
    setBusy(true);
    setError(null);
    try {
      await api.proposeCompared(result.model, result.effort);
      window.location.assign(IMPROVEMENT_HREF);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  }

  const count = Object.keys(picks).length;
  const claims = SIZES.find((one) => one.size === size)?.claims ?? 5;
  const cost = models ? estimate(models, picks, claims, repeats) : 0;
  const cheapest = found?.cheapest_pass ?? null;
  return (
    <section className="view" aria-labelledby="compare-heading">
      <header className="page-head">
        <div>
          <p className="eyebrow">Evaluate · Compare</p>
          <h1 id="compare-heading" ref={heading} tabIndex={-1}>
            Compare models
          </h1>
          <p className="lede">The right answer for the least money: pick up to three.</p>
        </div>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!models && !error && <span className="skeleton skeleton-card" aria-hidden="true" />}
      {models && (
        <>
          <div className="model-picks">
            {models.map((model) => (
              <Pick
                key={model.id}
                model={model}
                effort={picks[model.id]}
                full={count >= MOST}
                onToggle={() => {
                  toggle(model);
                }}
                onEffort={(effort) => {
                  setPicks((now) => ({ ...now, [model.id]: effort }));
                }}
              />
            ))}
          </div>
          <div className="panel compare-run">
            <fieldset className="seg">
              <legend>Claims</legend>
              <div className="seg-track">
                {SIZES.map((one) => (
                  <label key={one.size} className="seg-option">
                    <input
                      type="radio"
                      name="compare-size"
                      checked={size === one.size}
                      onChange={() => {
                        setSize(one.size);
                      }}
                    />
                    <span>{one.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="seg">
              <legend>Runs each</legend>
              <div className="seg-track">
                {[1, 2, 3].map((value) => (
                  <label key={value} className="seg-option">
                    <input
                      type="radio"
                      name="compare-repeats"
                      checked={repeats === value}
                      onChange={() => {
                        setRepeats(value);
                      }}
                    />
                    <span>{value}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="compare-go">
              <span className="hint">About ${cost.toFixed(2)}</span>
              {running ? (
                <button type="button" className="button secondary" onClick={() => void stop()}>
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  className="button"
                  disabled={busy || count === 0}
                  onClick={() => void start()}
                >
                  Compare
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {found && (
        <>
          <p className="compare-label">
            {found.size === "whole" ? "25" : "5"} claims · {found.repeats}{" "}
            {found.repeats === 1 ? "run" : "runs"} each · {when(found.started_at)}
            {running && " · running"}
          </p>
          <div className={`compare-answer${found.answer && cheapest ? " is-good" : ""}`}>
            {found.answer && cheapest ? (
              <Check size={18} strokeWidth={2} aria-hidden="true" />
            ) : null}
            <b>{answerOf(found)}</b>
          </div>
          {found.results.some((r) => r.accuracy !== null) && (
            <div className="pair wide-first">
              <section className="panel" aria-labelledby="cost-chart-heading">
                <div className="panel-head">
                  <h2 id="cost-chart-heading">Right decisions against cost a claim</h2>
                  <p className="panel-note">Up and to the left is better</p>
                </div>
                <CostChart results={found.results} target={found.accuracy_target} />
              </section>
              <section className="panel" aria-labelledby="reasons-heading">
                <div className="panel-head">
                  <h2 id="reasons-heading">Reasons</h2>
                  <p className="panel-note">The judge&apos;s grade, of 3</p>
                </div>
                <ul className="reason-bars">
                  {found.results.map((r) => (
                    <li key={`${r.model}:${r.effort}`}>
                      <span>
                        {r.label} <span className="hint">{r.effort}</span>
                      </span>
                      <span className="reason-track">
                        <i
                          style={{
                            width: `${String(((r.grade ?? 0) / 3) * 100)}%`,
                            background: colour(r.model),
                          }}
                        />
                      </span>
                      <span className="num">{r.grade === null ? "—" : r.grade.toFixed(1)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}
          <div className="compare-cards">
            {found.results.map((result) => (
              <ResultCard
                key={`${result.model}:${result.effort}`}
                result={result}
                cheapest={cheapest === `${result.model}:${result.effort}`}
                proposing={busy}
                onPropose={() => void propose(result)}
              />
            ))}
          </div>
          {found.differences.length > 0 && (
            <>
              <p className="compare-label">
                Decided differently · {found.differences.length} of {found.compared_claims}
              </p>
              <div className="claim-boxes">
                {found.differences.map((difference) => (
                  <div key={difference.claim_id} className="claim-box">
                    <a href={traceHref(difference.claim_id)}>{difference.claim_id}</a>
                    <span className="hint">
                      {difference.claim_type.replaceAll("_", " ")} · the handler{" "}
                      {difference.handler_decision === "approve"
                        ? "approved"
                        : difference.handler_decision === "decline"
                          ? "declined"
                          : "referred"}
                    </span>
                    <span className="claim-box-big">
                      {difference.handler_decision === "approve"
                        ? `$${(difference.handler_payout ?? 0).toFixed(0)}`
                        : (difference.handler_decision ?? "—")}
                    </span>
                    <span className="claim-marks">
                      {difference.marks.map((mark) => (
                        <span
                          key={mark.model}
                          className={mark.right ? "is-right" : "is-wrong"}
                          title={mark.model}
                        >
                          <span
                            className="model-dot"
                            style={{
                              background: colour(
                                found.results.find((r) => r.label === mark.model)?.model ?? "",
                              ),
                            }}
                          />
                          {mark.right
                            ? "✓"
                            : mark.decision === "approve"
                              ? `$${(mark.payout ?? 0).toFixed(0)}`
                              : (mark.decision ?? "none")}
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
