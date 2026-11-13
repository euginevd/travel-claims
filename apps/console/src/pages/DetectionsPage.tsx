import { Hourglass, LoaderCircle, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  LIVE_PERIODS,
  type Api,
  type DetectionKind,
  type Detections,
  type Guardrail,
  type LivePeriod,
} from "../api";
import { TableScroll } from "../components/TableScroll";
import { when } from "../format";
import { useFocusHeading } from "@undercover/web-core/useFocusHeading";
import { REDTEAM_HREF, traceHref } from "../useHashRoute";

const CONTROL: Record<DetectionKind, string> = {
  hidden_instruction: "Hidden-instruction check",
  guardrail: "Bedrock guardrail",
  refusal: "Claim agent",
  held: "Payout limit",
  output: "Output guard",
  guardian: "Guardian",
};

const MODES: Record<Guardrail["mode"], string> = {
  Enforcing: "chip chip-good",
  "On AWS": "chip chip-info",
  "Built in": "chip",
  Missing: "chip chip-bad",
};

function isKind(key: string): key is DetectionKind {
  return key in CONTROL;
}

/** The page's answer in one line, worked out in code: what's on, what's missing, whether the
 * red team got through, and what fired on real claims. */
export function answerOf(found: Detections): string {
  const rails = found.guardrails;
  const on = rails.filter((rail) => rail.mode !== "Missing").length;
  const missing = rails.length - on;
  const tested = rails.filter((rail) => rail.reached !== null && rail.stopped !== null);
  const attacks = Math.max(0, ...tested.map((rail) => rail.reached ?? 0));
  const stopped = tested.reduce((sum, rail) => sum + (rail.stopped ?? 0), 0);
  const hits = rails.reduce((sum, rail) => sum + (rail.hits ?? 0), 0);
  return [
    `${String(on)} guardrails on`,
    missing > 0 ? `${String(missing)} missing` : null,
    found.red_teamed
      ? `the red team: ${String(stopped)} of ${String(attacks)} attacks stopped`
      : "not red-teamed yet",
    `${String(hits)} fired on real claims in ${String(found.days)} days`,
  ]
    .filter(Boolean)
    .join(" · ");
}

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
          <p className="eyebrow">Secure · Guardrails</p>
          <h1 id="detections-heading" ref={heading} tabIndex={-1}>
            Guardrails
          </h1>
          <p className="lede">
            Are the protections on, and do they work? Each guardrail with its proof from the red
            team, what it caught on real claims, and how often it was wrong.
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
          <p className="guard-answer">
            <ShieldCheck size={18} strokeWidth={1.75} aria-hidden="true" />
            <span>{answerOf(shown)}</span>
          </p>
          <section className="panel" aria-labelledby="guardrails-heading">
            <div className="panel-head">
              <h2 id="guardrails-heading">Each guardrail, in the order a claim meets it</h2>
              <a className="stage-link small" href={REDTEAM_HREF}>
                Red team
              </a>
            </div>
            <TableScroll label="Guardrails table">
              <table className="table min-wide guard-table">
                <thead>
                  <tr>
                    <th scope="col">Guardrail</th>
                    <th scope="col">Where</th>
                    <th scope="col">Mode</th>
                    <th scope="col" className="num">
                      Real claims
                    </th>
                    <th scope="col">Red team</th>
                    <th scope="col" className="num">
                      False alarms
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.guardrails.map((rail) => (
                    <tr
                      key={rail.key}
                      className={rail.mode === "Missing" ? "is-missing" : undefined}
                    >
                      <th scope="row">
                        {rail.name}
                        <span className="sub">{rail.does}</span>
                      </th>
                      <td>
                        <span className="tag">{rail.where}</span>
                      </td>
                      <td>
                        <span className={MODES[rail.mode]}>{rail.mode}</span>
                      </td>
                      <td className="num">
                        {rail.hits === null ? (
                          "—"
                        ) : rail.hits > 0 && isKind(rail.key) ? (
                          <button
                            type="button"
                            className="link-button"
                            aria-pressed={filter === rail.key}
                            onClick={() => {
                              setFilter(filter === rail.key ? "all" : (rail.key as DetectionKind));
                            }}
                          >
                            {rail.hits}
                          </button>
                        ) : (
                          rail.hits
                        )}
                      </td>
                      <td>
                        {rail.reached === null || rail.stopped === null ? (
                          <span className="muted">
                            {rail.mode === "Missing"
                              ? "—"
                              : rail.key === "guardrail"
                                ? "With the check"
                                : rail.key === "output"
                                  ? "Not run"
                                  : "Not run"}
                          </span>
                        ) : (
                          `Stopped ${String(rail.stopped)} of ${String(rail.reached)} that reached it`
                        )}
                      </td>
                      <td className="num">{rail.false_alarms ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <p className="small muted guard-note">
              Real claims: how many it fired on in {shown.days} days. False alarms: claims it
              stopped that a handler then approved. Red-team claims are never counted as real.
            </p>
          </section>
          <section className="panel" aria-labelledby="events-heading">
            <div className="panel-head">
              <h2 id="events-heading">What fired</h2>
              <p className="panel-note">
                {filter === "all" ? (
                  "Newest first"
                ) : (
                  <>
                    {CONTROL[filter]} only.{" "}
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        setFilter("all");
                      }}
                    >
                      Show every guardrail
                    </button>
                  </>
                )}
              </p>
            </div>
            {events.length === 0 ? (
              <p className="muted small">
                {shown.events.length === 0
                  ? `Nothing fired on a real claim in ${String(shown.days)} days. Make a claim with the sample receipt that hides an instruction to see one.`
                  : "None from this guardrail in the period."}
              </p>
            ) : (
              <TableScroll label="Detections table">
                <table className="table min-wide">
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Guardrail</th>
                      <th scope="col">What it caught</th>
                      <th scope="col">Claim</th>
                      <th scope="col">Then</th>
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
                          <span
                            className={event.kind === "held" ? "chip chip-info" : "chip chip-good"}
                          >
                            {event.kind === "held" ? (
                              <Hourglass size={13} strokeWidth={1.75} aria-hidden="true" />
                            ) : (
                              <ShieldCheck size={13} strokeWidth={1.75} aria-hidden="true" />
                            )}
                            {event.outcome}
                          </span>
                          {event.after && <span className="sub">{event.after}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </section>
        </>
      )}
    </section>
  );
}
