import { useEffect, useState } from "react";
import type { Api, Budget } from "../api";
import { Meter } from "../components/Charts";
import { when } from "../format";
import { modelName } from "../traceTimeline";
import { useFocusHeading } from "@undercover/web-core/useFocusHeading";

const dollars = (value: number, places = 2) => `$${value.toFixed(places)}`;

/** Govern · Budgets: what the agents' model calls cost today against the daily budget. At the
 * budget the agent switches itself off; engineers set the budget, with a reason. */
export function BudgetsPage({ api }: { api: Api }) {
  const heading = useFocusHeading();
  const [budget, setBudget] = useState<Budget | null>(null);
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

  const share = budget ? Math.min(1, budget.share) : 0;
  return (
    <section className="page-in" aria-labelledby="budgets-heading">
      <p className="eyebrow">Govern · Budgets</p>
      <h1 id="budgets-heading" ref={heading} tabIndex={-1}>
        Budgets
      </h1>
      <p className="lede">
        What the agents&apos; model calls cost today, against a daily budget. At the budget the
        agent stops taking claims and the audit log says why; claims already started finish.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!budget && !error && <span className="skeleton skeleton-card" aria-hidden="true" />}
      {budget && (
        <div className="budget-grid">
          <section className="panel" aria-labelledby="today-heading">
            <div className="panel-head">
              <h2 id="today-heading">Today</h2>
              <span
                className={
                  budget.share >= 1
                    ? "chip chip-bad"
                    : budget.share >= 0.8
                      ? "chip chip-warn"
                      : "chip chip-good"
                }
              >
                {budget.share >= 1
                  ? "Budget reached"
                  : budget.share >= 0.8
                    ? "Nearly spent"
                    : "Within budget"}
              </span>
            </div>
            <p className="budget-figure">
              <b>
                {dollars(
                  budget.spent_today,
                  budget.spent_today > 0 && budget.spent_today < 0.01 ? 4 : 2,
                )}
              </b>
              <span className="muted"> of {dollars(budget.limit)}</span>
            </p>
            <Meter value={share} tone="spend" />
            <p className="small muted">
              {String(Math.round(budget.share * 100))}% spent. Live and red-team claims count;
              evaluation runs keep their own spending limits.
            </p>
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
                      <td className="num">{dollars(one.cost, 4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted small">No model calls yet today.</p>
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
            <button type="button" className="button" disabled={saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save the budget"}
            </button>
            <p className="small muted">
              {budget.changed_by && budget.changed_at
                ? `Last set by ${budget.changed_by}, ${when(budget.changed_at)}.`
                : "The starting budget; no one has changed it."}
            </p>
          </section>
        </div>
      )}
    </section>
  );
}
