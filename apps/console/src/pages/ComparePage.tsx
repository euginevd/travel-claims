import { useFocusHeading } from "@undercover/web-core/useFocusHeading";
import { Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Api, CompareResult, Comparison, ModelChoice } from "../api";
import { when } from "../format";
import { IMPROVEMENT_HREF, runHref, traceHref } from "../useHashRoute";

const MOST = 3;
const SIZES = [
  { size: "one", claims: 1, label: "1" },
  { size: "tiny", claims: 5, label: "5" },
  { size: "whole", claims: 25, label: "25" },
] as const;
type Size = (typeof SIZES)[number]["size"];

function claimsLabel(size: string): string {
  const claims = SIZES.find((one) => one.size === size)?.claims ?? 5;
  return claims === 1 ? "1 claim" : `${String(claims)} claims`;
}
const POLL_MS = 5000;
const SMALL_ONLY = new Set(["claude-opus-5-5", "claude-fable-5-2"]);
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
          {/* The label covers the whole box, so a click anywhere ticks it. */}
          <label className="pick-cover" htmlFor={`pick-${model.id}`}>
            <b>{model.label}</b>
          </label>
          {model.in_use && <span className="chip pick-chip">In use</span>}
        </span>
        <input
          id={`pick-${model.id}`}
          type="checkbox"
          aria-label={`Compare ${model.label}`}
          checked={on}
          disabled={disabled}
          onChange={onToggle}
        />
      </div>
      <span className="hint pick-good">
        {model.good_for}
        {model.may_decline && " · may decline"}
      </span>
      {/* The facts on a tall window; one line on a short one (design-system.md 40). */}
      <span className="hint pick-short">
        {model.offered
          ? `${perClaim(model.cost_per_claim)} a claim · ${model.speed}`
          : "Not offered in Australia"}
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
      {/* Picking an effort on an unticked model ticks it too. */}
      <fieldset className="effort-switch" disabled={disabled}>
        <legend className="visually-hidden">{model.label} effort</legend>
        {model.efforts.map((level) => (
          <label key={level} className={(effort ?? model.default_effort) === level ? "on" : ""}>
            <input
              type="radio"
              name={`effort-${model.id}`}
              checked={effort === level}
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

const LABEL_CHAR = 7.6;

/** Right decisions against cost a claim, one dot a model with a whisker for its likely range;
 * cost on a log scale, the target dashed, up and to the left is better. */
export function CostChart({
  results,
  target,
  claims,
}: {
  results: CompareResult[];
  target: number;
  claims: number;
}) {
  // Drawn at the size of its box, so it fills the space the page gives it, never stretched.
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 760, height: 184 });
  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width: w, height: h } = entry.contentRect;
      if (w > 0 && h > 0) setSize({ width: Math.round(w), height: Math.round(h) });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  const shown = results.filter((r) => r.accuracy !== null && r.cost_per_claim !== null);
  if (shown.length === 0) return null;
  const { width, height } = size;
  const left = 46;
  const right = width - 16;
  const bottom = height - 36;
  const top = 40;
  const costs = shown.map((r) => Math.log10(Math.max(r.cost_per_claim ?? 0.0001, 0.0001)));
  const lowX = Math.floor(Math.min(...costs)) - 0.2;
  const highX = Math.ceil(Math.max(...costs)) + 0.2;
  const floor = Math.min(0.4, ...shown.map((r) => r.low ?? 1));
  const x = (cost: number) =>
    left + ((Math.log10(Math.max(cost, 0.0001)) - lowX) / (highX - lowX)) * (right - left);
  const y = (share: number) => bottom - ((share - floor) / (1 - floor)) * (bottom - top);
  const ticks = Array.from(
    { length: Math.round(highX - lowX) + 1 },
    (_, i) => Math.ceil(lowX) + i,
  ).filter((power) => power <= highX);
  // Every label sits above its whisker; one that would run into another moves up a line.
  const placed: { x0: number; x1: number; y: number }[] = [];
  const labels = [...shown]
    .sort((a, b) => (a.cost_per_claim ?? 0) - (b.cost_per_claim ?? 0))
    .map((r) => {
      const text = `${r.label} · ${perClaim(r.cost_per_claim)}`;
      const wide = text.length * LABEL_CHAR;
      const x0 = Math.min(Math.max(x(r.cost_per_claim ?? 0) - wide / 2, left + 4), right - wide);
      let ly = y(r.high ?? r.accuracy ?? 0) - 10;
      while (placed.some((o) => o.x0 < x0 + wide && x0 < o.x1 && Math.abs(o.y - ly) < 13)) ly -= 14;
      placed.push({ x0, x1: x0 + wide, y: ly });
      return { r, text, x: x0, y: ly };
    });
  return (
    <div className="cost-chart-box" ref={box}>
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
          width={right - left}
          height={bottom - y(target)}
        />
        <line className="chart-axis" x1={left} x2={right} y1={bottom} y2={bottom} />
        <line className="chart-axis" x1={left} x2={left} y1={8} y2={bottom} />
        <line className="chart-target" x1={left} x2={right} y1={y(target)} y2={y(target)} />
        <text x={right - 4} y={y(target) + 14} textAnchor="end">
          target {pct(target)}
        </text>
        <text x={4} y={y(1) + 4}>
          100%
        </text>
        <text x={4} y={bottom}>
          {pct(floor)}
        </text>
        {ticks.map((power) => (
          <text key={power} x={x(10 ** power)} y={bottom + 17} textAnchor="middle">
            ${10 ** power >= 1 ? String(10 ** power) : (10 ** power).toFixed(-power)}
          </text>
        ))}
        <text x={right} y={height - 2} textAnchor="end">
          Cost a claim, log scale · whisker: the likely range on {claims}{" "}
          {claims === 1 ? "claim" : "claims"}
        </text>
        {shown.map((r) => {
          const cx = x(r.cost_per_claim ?? 0);
          const high = y(r.high ?? r.accuracy ?? 0);
          const low = y(r.low ?? r.accuracy ?? 0);
          return (
            <g key={`${r.model}:${r.effort}`} stroke={colour(r.model)} strokeWidth="1.5">
              <line x1={cx} x2={cx} y1={high} y2={low} opacity="0.6" />
              <line x1={cx - 5} x2={cx + 5} y1={high} y2={high} opacity="0.6" />
              <line x1={cx - 5} x2={cx + 5} y1={low} y2={low} opacity="0.6" />
              <circle cx={cx} cy={y(r.accuracy ?? 0)} r="7" fill={colour(r.model)} stroke="none" />
            </g>
          );
        })}
        {labels.map((label) => (
          <text
            key={`${label.r.model}:${label.r.effort}`}
            className="chart-name"
            x={label.x}
            y={label.y}
            style={{ fill: colour(label.r.model) }}
          >
            {label.text}
          </text>
        ))}
      </svg>
    </div>
  );
}

/** The line over the chart: when every model scored the same, how much less the cheapest costs. */
export function chartNote(results: CompareResult[]): string {
  const shown = results.filter((r) => r.accuracy !== null && r.cost_per_claim);
  if (shown.length < 2 || new Set(shown.map((r) => r.accuracy)).size > 1)
    return "Up and to the left is better";
  const byCost = [...shown].sort((a, b) => (a.cost_per_claim ?? 0) - (b.cost_per_claim ?? 0));
  const cheap = byCost[0];
  const dear = byCost[byCost.length - 1];
  if (!cheap || !dear) return "";
  const times = Math.round((dear.cost_per_claim ?? 0) / (cheap.cost_per_claim ?? 1));
  return `All scored ${pct(cheap.accuracy)}: ${cheap.label} costs ${String(times)}× less than ${dear.label}`;
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
      <div className="compare-big-row">
        <p className="compare-big">
          {pct(result.accuracy)}{" "}
          <span className="hint">
            right
            {result.low !== null && result.high !== null
              ? ` · likely ${String(Math.round(result.low * 100))}–${pct(result.high)}`
              : ""}
            {result.runs.map((runId) => (
              <span key={runId}>
                {" · "}
                <a href={runHref(runId)}>Run {runId}</a>
              </span>
            ))}
          </span>
        </p>
        {!result.in_use && done && result.passes === true && (
          <button
            type="button"
            className="button secondary small-button"
            disabled={proposing}
            title="An improvement round with this model in the improver's place: a person approves it, then the exam decides"
            onClick={onPropose}
          >
            Propose
          </button>
        )}
      </div>
      {result.by_run.length > 1 && (
        <span
          className="compare-runs"
          role="img"
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
            {new Set(result.by_run).size === 1 ? "the same each run" : "varies by run"}
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
    </article>
  );
}

/** Each pair of picks, judged blind in both orders: how often the row's explanation was the
 * better one, ties counted half. */
export function HeadToHeadGrid({ found }: { found: Comparison }) {
  const picks = found.results.map((r) => ({ key: `${r.model}:${r.effort}`, result: r }));
  const share = (a: string, b: string): { share: number | null; judged: number } | null => {
    const pair = found.head_to_head.find((one) => one.a === a && one.b === b);
    if (pair) return { share: pair.a_share, judged: pair.judged };
    const back = found.head_to_head.find((one) => one.a === b && one.b === a);
    if (back)
      return { share: back.a_share === null ? null : 1 - back.a_share, judged: back.judged };
    return null;
  };
  const judged = Math.max(0, ...found.head_to_head.map((pair) => pair.judged));
  const note =
    found.head_to_head_state === "done"
      ? `Row against column, blind, both orders · ${String(judged)} ${judged === 1 ? "claim" : "claims"}`
      : found.head_to_head_state === "judging"
        ? "The judge is reading the explanations…"
        : found.status === "running"
          ? "Once every run has finished"
          : "Not judged";
  return (
    <section className="panel" aria-labelledby="h2h-heading">
      <div className="panel-head">
        <h2 id="h2h-heading">Better reasons, head to head</h2>
        <p className="panel-note">{note}</p>
      </div>
      <table className="h2h">
        <thead>
          <tr>
            <td />
            {picks.map(({ key, result }) => (
              <th key={key} scope="col">
                <span
                  className="model-dot"
                  aria-hidden="true"
                  style={{ background: colour(result.model) }}
                />
                {result.label.replace(/ [\d.]+$/, "")}{" "}
                <span className="hint">{EFFORT_SHORT[result.effort] ?? result.effort}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {picks.map(({ key, result }) => (
            <tr key={key}>
              <th scope="row">
                <span
                  className="model-dot"
                  aria-hidden="true"
                  style={{ background: colour(result.model) }}
                />
                {result.label} <span className="hint">{result.effort}</span>
              </th>
              {picks.map((other) => {
                if (other.key === key)
                  return (
                    <td key={other.key} className="h2h-self">
                      —
                    </td>
                  );
                const found = share(key, other.key);
                const value = found?.share ?? null;
                return (
                  <td
                    key={other.key}
                    className={
                      value === null
                        ? ""
                        : value >= 0.6
                          ? "is-ahead"
                          : value <= 0.4
                            ? "is-behind"
                            : ""
                    }
                  >
                    {pct(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
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
  const [chosenSize, setSize] = useState<Size>("tiny");
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
  // Opus and Fable run on the 5 claims only: 25 would cost too much.
  const smallOnly = Object.keys(picks).some((id) => SMALL_ONLY.has(id));
  const size: Size = smallOnly && chosenSize === "whole" ? "tiny" : chosenSize;
  const claims = SIZES.find((one) => one.size === size)?.claims ?? 5;
  const cost = models ? estimate(models, picks, claims, repeats) : 0;
  const cheapest = found?.cheapest_pass ?? null;
  return (
    <section className="view compare-view" aria-labelledby="compare-heading">
      <header className="page-head">
        <div>
          <p className="eyebrow">Evaluate · Compare</p>
          <h1 id="compare-heading" ref={heading} tabIndex={-1}>
            Compare models
          </h1>
        </div>
        {models && (
          <div className="page-head-side compare-run">
            <fieldset className="seg">
              <legend>Claims</legend>
              <div className="seg-track">
                {SIZES.map((one) => (
                  <label key={one.size} className="seg-option">
                    <input
                      type="radio"
                      name="compare-size"
                      checked={size === one.size}
                      disabled={one.size === "whole" && smallOnly}
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
        )}
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!models && !error && <span className="skeleton skeleton-card" aria-hidden="true" />}
      {models && (
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
      )}

      {found && (
        <>
          <div
            className={`compare-answer${found.answer && cheapest ? " is-good" : ""}`}
            aria-live="polite"
          >
            {found.answer && cheapest ? (
              <Check size={18} strokeWidth={2} aria-hidden="true" />
            ) : null}
            <b>{answerOf(found)}</b>
            <span className="hint compare-when">
              {claimsLabel(found.size)} · {found.repeats} {found.repeats === 1 ? "run" : "runs"}{" "}
              each · {when(found.started_at)}
              {running && " · running"}
            </span>
          </div>
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
          {found.results.some((r) => r.accuracy !== null) && (
            <div className="pair compare-bottom">
              <section className="panel" aria-labelledby="cost-chart-heading">
                <div className="panel-head">
                  <h2 id="cost-chart-heading">Right decisions against cost a claim</h2>
                  <p className="panel-note">{chartNote(found.results)}</p>
                </div>
                <CostChart
                  results={found.results}
                  target={found.accuracy_target}
                  claims={found.compared_claims}
                />
              </section>
              <div className="compare-side">
                {found.results.length > 1 && <HeadToHeadGrid found={found} />}
                <section
                  className="panel compare-differences"
                  aria-labelledby="differences-heading"
                >
                  <div className="panel-head">
                    <h2 id="differences-heading">Decided differently</h2>
                    <p className="panel-note">
                      {found.differences.length} of {found.compared_claims} claims
                    </p>
                  </div>
                  {found.differences.length === 0 ? (
                    <p className="hint">Every model decided every claim the same way.</p>
                  ) : (
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
                                key={`${mark.model}:${mark.effort}`}
                                className={mark.right ? "is-right" : "is-wrong"}
                                title={`${mark.label} ${mark.effort}`}
                              >
                                <span
                                  className="model-dot"
                                  aria-hidden="true"
                                  style={{ background: colour(mark.model) }}
                                />
                                <span className="visually-hidden">
                                  {mark.label} {mark.effort}:{" "}
                                </span>
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
                  )}
                </section>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
