import {
  ArrowRight,
  CircleCheck,
  CircleDashed,
  CircleX,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Api, GateStatus, Overview } from "../api";
import { RangeBar } from "../components/Charts";
import { AgentsWidget, AlertsList, KpiRow, ReleasesWidget } from "../components/OverviewWidgets";
import { WattleMark } from "../components/Wattle";
import { when } from "../format";
import { wilson } from "../stats";
import { useFocusHeading } from "@undercover/web-core/useFocusHeading";
import {
  DETECTIONS_HREF,
  IMPROVEMENT_HREF,
  LIVE_HREF,
  POSTURE_HREF,
  REDTEAM_HREF,
  SCOREBOARD_HREF,
} from "../useHashRoute";

const LINKS: Record<string, { href: string; label: string }> = {
  scoreboard: { href: SCOREBOARD_HREF, label: "Scoreboard" },
  redteam: { href: REDTEAM_HREF, label: "Red team" },
  detections: { href: DETECTIONS_HREF, label: "Guardrails" },
  live: { href: LIVE_HREF, label: "Live" },
  posture: { href: POSTURE_HREF, label: "Posture" },
  improvement: { href: IMPROVEMENT_HREF, label: "Versions" },
};

const MARKS: Record<GateStatus, { Icon: LucideIcon; label: string }> = {
  pass: { Icon: CircleCheck, label: "Passes" },
  watch: { Icon: TriangleAlert, label: "Watch" },
  fail: { Icon: CircleX, label: "Fails" },
  none: { Icon: CircleDashed, label: "No evidence yet" },
};

const KINDS = {
  stalled: { chip: "chip chip-warn", label: "Stalled" },
  review: { chip: "chip chip-info", label: "Review" },
  untested: { chip: "chip chip-bad", label: "Untested" },
  gap: { chip: "chip", label: "Gap" },
  version: { chip: "chip chip-info", label: "Version" },
} as const;

/** "claude-haiku-5-5" as people say it: "Haiku 5.5". */
function modelName(model: string): string {
  const [, name = model, major, minor] = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(model) ?? [];
  const title = name.charAt(0).toUpperCase() + name.slice(1);
  return major ? `${title} ${major}.${minor ?? "0"}` : title;
}

/** "Good morning" and so on, by the engineer's own clock. */
function greeting(now: Date): string {
  const hour = now.getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/** The console's home: is the agent fit to run, and how do we know? */
export function OverviewPage({ api, name = "" }: { api: Api; name?: string }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [generation, setGeneration] = useState(0);
  const heading = useFocusHeading();
  const reload = useCallback(() => {
    setGeneration((n) => n + 1);
  }, []);

  useEffect(() => {
    let live = true;
    api.getOverview().then(
      (found) => {
        if (live) setOverview(found);
      },
      (caught: unknown) => {
        if (live) setError(caught instanceof Error ? caught.message : String(caught));
      },
    );
    return () => {
      live = false;
    };
  }, [api, generation]);

  const today = new Date();
  const version = overview?.version;
  const missing = overview?.gates.filter(
    (gate) => gate.status === "none" && (gate.key === "held_out" || gate.key === "red_team"),
  );
  return (
    <section className="page-in overview" aria-labelledby="overview-heading">
      <p className="eyebrow">
        {today.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}
      </p>
      <h1 id="overview-heading" ref={heading} tabIndex={-1}>
        {greeting(today)}
        {name ? `, ${name.split(/\s+/)[0] ?? name}` : ""}
      </h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!overview && !error && <span className="skeleton skeleton-card" aria-hidden="true" />}
      {overview && version && (
        <>
          <div className={`fit-brief-box is-${overview.verdict}`}>
            <WattleMark size={34} />
            <div>
              <p className="fit-headline">{overview.headline}</p>
              <p className="muted small">
                {version.model
                  ? `Agent version ${String(version.version)}: ${modelName(version.model)}, ${version.effort ?? ""} effort, the instructions and model it runs on now`
                  : "No agent version in use"}
                {version.since ? `, since ${when(version.since)}` : ""}.{" "}
                {overview.brief.replace(/^.*?Next:/, "Next:")}
              </p>
            </div>
            {missing && missing.length > 0 && (
              <p className="fit-actions">
                {missing.some((gate) => gate.key === "held_out") && (
                  <a className="button" href={IMPROVEMENT_HREF}>
                    Run the exam
                    <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
                  </a>
                )}
                {missing.some((gate) => gate.key === "red_team") && (
                  <a
                    className={
                      missing.some((gate) => gate.key === "held_out")
                        ? "button secondary"
                        : "button"
                    }
                    href={REDTEAM_HREF}
                  >
                    Run the red team
                  </a>
                )}
              </p>
            )}
          </div>

          <KpiRow api={api} />

          <div className="overview-main">
            <AgentsWidget api={api} />
            <div className="overview-side">
              <section className="panel" aria-labelledby="attention-heading">
                <div className="panel-head">
                  <h2 id="attention-heading">Needs attention</h2>
                  <span className="muted small">
                    {overview.attention.length}{" "}
                    {overview.attention.length === 1 ? "thing" : "things"}
                  </span>
                </div>
                <AlertsList api={api} />
                {overview.attention.length === 0 ? (
                  <p className="muted small">Nothing needs attention.</p>
                ) : (
                  <ul className="attention">
                    {overview.attention.map((item) => (
                      <li key={item.text}>
                        <span className={KINDS[item.kind].chip}>{KINDS[item.kind].label}</span>
                        <span>{item.text}</span>
                        {item.kind === "stalled" ? (
                          <button
                            type="button"
                            className="button secondary"
                            disabled={stopping}
                            onClick={() => {
                              setStopping(true);
                              Promise.all(item.run_ids.map((id) => api.stopRun(id))).then(
                                () => {
                                  setStopping(false);
                                  reload();
                                },
                                (caught: unknown) => {
                                  setStopping(false);
                                  setError(
                                    caught instanceof Error ? caught.message : String(caught),
                                  );
                                },
                              );
                            }}
                          >
                            {stopping ? "Stopping…" : "Stop them"}
                          </button>
                        ) : (
                          LINKS[item.link] && (
                            <a className="stage-link small" href={LINKS[item.link]?.href}>
                              {LINKS[item.link]?.label}
                            </a>
                          )
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <ReleasesWidget api={api} />
            </div>
          </div>

          <ul className="gate-boxes" aria-label="Release gates">
            {overview.gates.map((gate) => {
              const { Icon, label } = MARKS[gate.status];
              const link = LINKS[gate.link];
              const range =
                gate.share !== null && gate.claims > 0 ? wilson(gate.share, gate.claims) : null;
              return (
                <li key={gate.key} className={`gate-box is-${gate.status}`}>
                  <span className="gate-box-head">
                    <Icon size={16} strokeWidth={1.75} aria-label={label} />
                    {gate.label}
                  </span>
                  <b>{gate.value}</b>
                  {gate.share !== null && gate.key !== "sign_off" ? (
                    <RangeBar value={gate.share} range={range} target={gate.target ?? undefined} />
                  ) : (
                    <span className="gate-empty" aria-hidden="true" />
                  )}
                  <small className="muted">
                    {range && gate.key !== "red_team"
                      ? `likely ${String(Math.round(range[0] * 100))}–${String(Math.round(range[1] * 100))}% · `
                      : ""}
                    {gate.note || gate.detail}
                  </small>
                  {link && (
                    <a className="stage-link small" href={link.href}>
                      {link.label}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Folded, so the overview fits the window; the agent and payouts are in the top bar. */}
          <details className="panel measure">
            <summary>How we measure</summary>
            <ul>
              <li>
                <b>An exam it never sees the answers to:</b> claims senior handlers decided, growing
                to 100; nothing the agent or the improver can call returns a label.
              </li>
              <li>
                <b>Ranges, not just scores:</b> 25 claims can&apos;t pin a score down, so each shows
                where it likely sits (Wilson, 95%).
              </li>
              <li>
                <b>A judge for the reasons:</b> a separate model grades each explanation against the
                handler&apos;s, 0 to 3; shown, never used to decide.
              </li>
              <li>
                <b>Attacks through the front door:</b> the red team makes claims in the
                customers&apos; portal, so every layer is tested as a customer reaches it.
              </li>
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
