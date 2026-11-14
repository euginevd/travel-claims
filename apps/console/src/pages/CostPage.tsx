import { useEffect, useState } from "react";
import type { Api, Budget, Costs } from "../api";
import { Meter, MiniBar } from "../components/Charts";
import { Widget } from "../components/Widget";
import { when } from "../format";
import { modelName } from "../traceTimeline";
import { traceHref } from "../useHashRoute";
import { useFocusHeading } from "@undercover/web-core/useFocusHeading";

const PERIODS = [7, 14, 30] as const;

/** Dollars: four places for the fractions of a cent model calls cost, two otherwise. */
export function dollars(value: number): string {
  return value > 0 && value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

function budgetState(share: number): { label: string; chip: string } {
  if (share >= 1) return { label: "Budget reached", chip: "chip chip-bad" };
  if (share >= 0.8) return { label: "Nearly spent", chip: "chip chip-warn" };
  return { label: "Within budget", chip: "chip chip-good" };
}

const KINDS: Record<string, string> = { live: "Live", redteam: "Red team", evaluation: "Exam" };

/** Govern · Cost: what the agents' model calls cost, where it goes, and the daily budget that
 * switches the agent off when it's reached. Engineers set the budget, with a reason. */
const SOURCES = [
  { key: "live", label: "Live claims" },
  { key: "evaluation", label: "Evaluations" },
  { key: "redteam", label: "Red team" },
  { key: "assistants", label: "Assistants" },
] as const;
const SLOT = 10;
const TALL = 100;

/** Spend a day, each bar split by where it went; drawn to fill its box. */
export function SpendChart({ days }: { days: Costs["days"] }) {
  const high = Math.max(...days.map((day) => day.total), 0.0001);
  return (
    <div className="spend">
      <svg
        className="spend-chart"
        viewBox={`0 0 ${String(days.length * SLOT)} ${String(TALL)}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Spend a day, highest ${dollars(high)}`}
      >
        {days.map((day, index) => {
          let top = TALL;
          return (
            <g key={day.day}>
              <title>{`${day.day}: ${dollars(day.total)}`}</title>
              {SOURCES.map((source) => {
                const tall = (day[source.key] / high) * (TALL - 2);
                top -= tall;
                return tall > 0 ? (
                  <rect
                    key={source.key}
                    className={`spend-${source.key}`}
                    x={index * SLOT + 1.5}
                    y={top}
                    width={SLOT - 3}
                    height={tall}
                  />
                ) : null;
              })}
            </g>
          );
        })}
      </svg>
      <p className="spend-axis small muted">
        <span>{days[0]?.day}</span>
        <span>highest {dollars(high)} a day</span>
        <span>{days[days.length - 1]?.day}</span>
      </p>
    </div>
  );
}

export function CostPage({ api }: { api: Api }) {
  const heading = useFocusHeading();
  const [budget, setBudget] = useState<Budget | null>(null);
  const [costs, setCosts] = useState<Costs | null>(null);
  const [days, setDays] = useState<(typeof PERIODS)[number]>(14);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    api.getBudget().then(
      (found) => {
        if (!live) return;
        setBudget(found);
        setLimit(found.limit.toFixed(2));
      },
      (caught: unknown) => {
        if (live) setError(caught instanceof Error ? caught.message : String(caught));
      },
    );
    return () => {
      live = false;
    };
  }, [api]);

  // The breakdown is extra: if it can't load, today's spend and the budget still show.
  useEffect(() => {
    let live = true;
    api.getCosts(days).then(
      (found) => {
        if (live) setCosts(found);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api, days]);

  async function save() {
    const value = Number(limit);
    if (!Number.isFinite(value) || value < 0.5 || value > 1000) {
      setError("A budget between $0.50 and $1,000 a day.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await api.setBudget(value, reason.trim());
      setBudget(saved);
      setReason("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  const state = budget ? budgetState(budget.share) : null;
  const sourceTotal = costs ? costs.by_source.reduce((sum, one) => sum + one.cost, 0) : 0;
  return (
    <section className="view page-in fit" aria-labelledby="cost-heading">
      <header className="page-head">
        <div>
          <p className="eyebrow">Govern · Cost</p>
          <h1 id="cost-heading" ref={heading} tabIndex={-1}>
            Cost
          </h1>
          <p className="lede">
            What the agents&apos; model calls cost, and where it goes. At the daily budget the agent
            stops taking claims and the audit log says why; claims already started finish.
          </p>
        </div>
        <fieldset className="seg page-head-side">
          <legend>Period</legend>
          <div className="seg-track">
            {PERIODS.map((period) => (
              <label key={period} className="seg-option">
                <input
                  type="radio"
                  name="cost-days"
                  checked={period === days}
                  onChange={() => {
                    setDays(period);
                  }}
                />
                <span>{period} days</span>
              </label>
            ))}
          </div>
        </fieldset>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!budget && !error && <span className="skeleton skeleton-card" aria-hidden="true" />}
      {budget && state && (
        <>
          <ul className="widgets cost-widgets" aria-label="Spend at a glance">
            <li>
              <Widget
                label="Today"
                value={dollars(budget.spent_today)}
                sub={
                  <>
                    of {dollars(budget.limit)} a day ·{" "}
                    <span className={state.chip}>{state.label}</span>
                  </>
                }
                tone={budget.share >= 0.8 ? "warn" : undefined}
              >
                <Meter value={Math.min(1, budget.share)} tone="spend" />
              </Widget>
            </li>
            <li>
              <Widget
                label="This month"
                value={costs ? dollars(costs.month_to_date) : "—"}
                sub={
                  costs
                    ? `On course for ${dollars(costs.projected_month)} by the month's end`
                    : "The month so far"
                }
              />
            </li>
            <li>
              <Widget
                label="A live claim"
                value={costs?.cost_per_claim != null ? dollars(costs.cost_per_claim) : "—"}
                sub={`Model cost per live claim decided, ${String(days)} days`}
              />
            </li>
            <li>
              <Widget
                label={`Last ${String(days)} days`}
                value={costs ? dollars(costs.period_total) : "—"}
                sub="Every model call: live, red team, exams and assistants"
              />
            </li>
          </ul>

          <div className="cost-grid">
            <section className="panel" aria-labelledby="where-heading">
              <div className="panel-head">
                <h2 id="where-heading">Where it goes</h2>
                <p className="panel-note">Last {days} days</p>
              </div>
              {costs && sourceTotal > 0 ? (
                <ul className="cost-sources">
                  {costs.by_source
                    .filter((one) => one.calls > 0 || one.cost > 0)
                    .map((one) => (
                      <li key={one.key}>
                        <span>{one.label}</span>
                        <MiniBar value={one.cost / sourceTotal} />
                        <span className="num">{dollars(one.cost)}</span>
                        <span className="num muted small">{one.calls} calls</span>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="muted small">No model calls in this period.</p>
              )}
            </section>

            <section className="panel" aria-labelledby="today-heading">
              <div className="panel-head">
                <h2 id="today-heading">Today, by model</h2>
                <span className={state.chip}>{state.label}</span>
              </div>
              {budget.by_model.length > 0 ? (
                <table className="table budget-table">
                  <thead>
                    <tr>
                      <th scope="col">Model</th>
                      <th scope="col" className="num">
                        Calls
                      </th>
                      <th scope="col" className="num">
                        Cost
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {budget.by_model.map((one) => (
                      <tr key={one.model}>
                        <th scope="row">{modelName(one.model)}</th>
                        <td className="num">{one.calls}</td>
                        <td className="num">{dollars(one.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted small">No model calls yet today.</p>
              )}
              <p className="small muted">
                {String(Math.round(budget.share * 100))}% of the budget. Live and red-team claims
                count; exams keep their own spending limits.
              </p>
            </section>

            <section className="panel" aria-labelledby="dearest-heading">
              <div className="panel-head">
                <h2 id="dearest-heading">Dearest claims</h2>
                <p className="panel-note">Last {days} days</p>
              </div>
              {costs && costs.dearest.length > 0 ? (
                <ol className="cost-dearest">
                  {costs.dearest.map((one) => (
                    <li key={one.claim_id}>
                      <a href={traceHref(one.claim_id)}>{one.claim_id}</a>
                      <span className="chip">{KINDS[one.kind] ?? one.kind}</span>
                      <span className="num muted small">{one.calls} calls</span>
                      <span className="num">{dollars(one.cost)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted small">No claim has cost anything in this period.</p>
              )}
            </section>

            <section className="panel" aria-labelledby="limit-heading">
              <div className="panel-head">
                <h2 id="limit-heading">Daily budget</h2>
              </div>
              <div className="field">
                <label htmlFor="budget-limit">Dollars a day</label>
                <input
                  id="budget-limit"
                  inputMode="decimal"
                  value={limit}
                  disabled={saving}
                  onChange={(event) => {
                    setLimit(event.target.value);
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="budget-reason">Why? (optional)</label>
                <input
                  id="budget-reason"
                  value={reason}
                  maxLength={200}
                  disabled={saving}
                  onChange={(event) => {
                    setReason(event.target.value);
                  }}
                />
              </div>
              <button
                type="button"
                className="button"
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? "Saving…" : "Save the budget"}
              </button>
              <p className="small muted">
                {budget.changed_by && budget.changed_at
                  ? `Last set by ${budget.changed_by}, ${when(budget.changed_at)}.`
                  : "The starting budget; no one has changed it."}
              </p>
            </section>
          </div>
          {costs && costs.days.length > 0 && (
            <section className="panel fill" aria-labelledby="spend-heading">
              <div className="panel-head">
                <h2 id="spend-heading">Spend a day</h2>
                <ul className="spend-key small" aria-label="Key">
                  {SOURCES.map((source) => (
                    <li key={source.key}>
                      <i className={`spend-${source.key}`} aria-hidden="true" />
                      {source.label}
                    </li>
                  ))}
                </ul>
              </div>
              <SpendChart days={costs.days} />
            </section>
          )}
        </>
      )}
    </section>
  );
}
