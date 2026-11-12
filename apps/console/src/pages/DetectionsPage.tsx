import { Hourglass, LoaderCircle, Radar, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  LIVE_PERIODS,
  type Api,
  type DetectionKind,
  type Detections,
  type LivePeriod,
} from "../api";
import { TableScroll } from "../components/TableScroll";
import { when } from "../format";
import { useFocusHeading } from "../useFocusHeading";
import { traceHref } from "../useHashRoute";

const KINDS: [kind: DetectionKind, label: string, sub: string][] = [
  ["hidden_instruction", "Hidden-instruction check", "Claims referred before the agent read them"],
  ["guardrail", "Bedrock guardrail", "Customer text blocked, on AWS"],
  ["refusal", "Model refused", "The agent's model declined to go on"],
  ["held", "Payout held", "Approvals waiting for a senior handler"],
];
type Filter = DetectionKind | "all";

/** Every time a control fired on a live claim: each claim once per control, newest first. A
 * summary is the check's own reason, untrusted model output that may quote the claim. */
export function DetectionsPage({ api }: { api: Api }) {
  const heading = useFocusHeading();
  const [days, setDays] = useState<LivePeriod>(14);
  const [filter, setFilter] = useState<Filter>("all");
  const [found, setFound] = useState<Detections | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const load = useCallback(() => {
    setError(null);
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    let current = true;
    api.getDetections(days).then(
      (value) => {
        if (current) setFound(value);
      },
      (caught: unknown) => {
        if (current) setError(caught instanceof Error ? caught.message : String(caught));
      },
    );
    return () => {
      current = false;
    };
  }, [api, days, generation]);

  // The period just chosen is loading until its own answer arrives.
  const shown = found?.days === days ? found : null;
  const events = shown?.events.filter((e) => filter === "all" || e.kind === filter) ?? [];
  return (
    <section className="view" aria-labelledby="detections-heading">
      <header className="page-head">
        <div>
          <p className="eyebrow">Security · Detections</p>
          <h1 id="detections-heading" ref={heading} tabIndex={-1}>
            Detections
          </h1>
          <p className="lede">
            Each time a control fired on a live claim. Evaluation copies and red-team claims are
            never counted.
          </p>
        </div>
        <fieldset className="seg page-head-side">
          <legend>Period</legend>
          <div className="seg-track">
            {LIVE_PERIODS.map((value) => (
              <label key={value} className="seg-option">
                <input
                  type="radio"
                  name="detection-days"
                  checked={days === value}
                  onChange={() => {
                    setError(null);
                    setDays(value);
                  }}
                />
                <span>{value} days</span>
              </label>
            ))}
          </div>
        </fieldset>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
          <button type="button" className="button secondary" onClick={load}>
            Try again
          </button>
        </p>
      )}
      {!shown && !error && (
        <p role="status" className="loading">
          <LoaderCircle className="spin" size={16} strokeWidth={1.75} aria-hidden="true" />
          Loading the detections…
        </p>
      )}
      {shown && (
        <>
          <ul className="kpis" aria-label="Detections by control">
            {KINDS.map(([kind, label, sub]) => (
              <li key={kind} className="kpi">
                <p className="kpi-label">{label}</p>
                <p className="kpi-value">{shown.counts[kind]}</p>
                <p className="kpi-sub">{sub}</p>
              </li>
            ))}
          </ul>
          {shown.events.length === 0 ? (
            <div className="panel empty">
              <span className="icon-tile" aria-hidden="true">
                <Radar size={18} strokeWidth={1.75} />
              </span>
              <h2>No detections in this period</h2>
              <p className="muted">
                Nothing fired on a live claim. Choose a longer period, or make a claim with the
                sample receipt that hides an instruction.
              </p>
            </div>
          ) : (
            <div className="panel">
              <div className="panel-head">
                <h2>Events</h2>
                <fieldset className="seg">
                  <legend className="visually-hidden">Control</legend>
                  <div className="seg-track">
                    {(["all", ...KINDS.map(([kind]) => kind)] as Filter[]).map((value) => (
                      <label key={value} className="seg-option">
                        <input
                          type="radio"
                          name="detection-kind"
                          checked={filter === value}
                          onChange={() => {
                            setFilter(value);
                          }}
                        />
                        <span>
                          {value === "all"
                            ? "All"
                            : (KINDS.find(([kind]) => kind === value)?.[1] ?? value)}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
              {events.length === 0 ? (
                <p className="muted small">None from this control in the period.</p>
              ) : (
                <TableScroll label="Detections table">
                  <table className="table min-wide">
                    <thead>
                      <tr>
                        <th scope="col">When</th>
                        <th scope="col">Control</th>
                        <th scope="col">What it caught</th>
                        <th scope="col">Claim</th>
                        <th scope="col">Outcome</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.map((event, index) => (
                        <tr key={`${event.claim_id}-${event.kind}-${String(index)}`}>
                          <td className="nowrap small">{when(event.at)}</td>
                          <td className="nowrap">{event.control}</td>
                          {/* Untrusted model output: text only, never markup. */}
                          <td className="prose" dir="auto">
                            {event.summary}
                          </td>
                          <td className="mono nowrap">
                            <a href={traceHref(event.claim_id)}>{event.claim_id}</a>
                          </td>
                          <td>
                            {event.kind === "held" ? (
                              <span className="chip chip-info">
                                <Hourglass size={13} strokeWidth={1.75} aria-hidden="true" />
                                {event.outcome}
                              </span>
                            ) : (
                              <span className="chip chip-good">
                                <ShieldCheck size={13} strokeWidth={1.75} aria-hidden="true" />
                                {event.outcome}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
