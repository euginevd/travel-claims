// The Overview's widgets, as Langfuse's home is built from them: live work, quality, spend and
// guardrails as figures with their trend, the agents map live, the alerts and the releases.
// Each loads on its own and stays quiet if it can't: the page's own error is the alert.
import { useEffect, useState } from "react";
import type { AgentsMap, Alert, Api, Budget, Detections, Live, VersionCard } from "../api";
import { AgentsMapSvg } from "../pages/AgentsPage";
import {
  AGENTS_HREF,
  AUDIT_HREF,
  BUDGETS_HREF,
  DETECTIONS_HREF,
  IMPROVEMENT_HREF,
  LIVE_HREF,
  OVERVIEW_HREF,
  SCOREBOARD_HREF,
  versionHref,
} from "../useHashRoute";
import { Meter, Sparkline } from "./Charts";
import { Widget } from "./Widget";

/** Load once (or every `every` ms), quietly: null until it answers, null if it fails. */
function useQuiet<T>(load: () => Promise<T>, every?: number): T | null {
  const [found, setFound] = useState<T | null>(null);
  useEffect(() => {
    let live = true;
    const get = () => {
      load().then(
        (value) => {
          if (live) setFound(value);
        },
        () => undefined,
      );
    };
    get();
    const timer = every ? window.setInterval(get, every) : undefined;
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [load, every]);
  return found;
}

const pct = (share: number | null | undefined) =>
  share === null || share === undefined ? "—" : `${String(Math.round(share * 100))}%`;

/** Four figures across: work, quality, spend and guardrails, each with its trend or meter. */
export function KpiRow({ api }: { api: Api }) {
  const [loadLive] = useState(() => () => api.getLive(14));
  const [loadBudget] = useState(() => () => api.getBudget());
  const [loadDetections] = useState(() => () => api.getDetections(14));
  const live: Live | null = useQuiet(loadLive);
  const budget: Budget | null = useQuiet(loadBudget, 30_000);
  const detections: Detections | null = useQuiet(loadDetections);
  const series = live?.series ?? [];
  const hits = detections
    ? Object.values(detections.counts).reduce((sum, count) => sum + count, 0)
    : null;
  return (
    <ul className="widgets" aria-label="Key figures">
      <li>
        <Widget
          label="Claims worked"
          value={live ? String(live.totals.decided) : "—"}
          sub="Live claims decided, last 14 days"
          href={LIVE_HREF}
        >
          <Sparkline values={series.map((day) => day.decided)} label="Claims decided a day" />
        </Widget>
      </li>
      <li>
        <Widget
          label="Decided without a person"
          value={pct(live?.totals.straight_through_share)}
          sub="Target 70%, last 14 days"
          href={LIVE_HREF}
        >
          <Sparkline
            values={series.map((day) => (day.decided ? day.straight_through / day.decided : 0))}
            label="Share decided without a person, a day"
          />
        </Widget>
      </li>
      <li>
        <Widget
          label="Spend today"
          value={budget ? `$${budget.spent_today.toFixed(2)}` : "—"}
          sub={budget ? `of the $${budget.limit.toFixed(2)} daily budget` : "Daily budget"}
          href={BUDGETS_HREF}
        >
          {budget && <Meter value={Math.min(1, budget.share)} tone="spend" />}
        </Widget>
      </li>
      <li>
        <Widget
          label="Guardrail hits"
          value={hits === null ? "—" : String(hits)}
          sub={
            detections?.red_teamed
              ? "On real claims, 14 days · red-teamed"
              : "On real claims, 14 days · not red-teamed yet"
          }
          href={DETECTIONS_HREF}
        />
      </li>
    </ul>
  );
}

/** The agents map, live and small: the whole system at a glance; it opens the full map. */
export function AgentsWidget({ api }: { api: Api }) {
  const [load] = useState(() => () => api.getAgents(14));
  const map: AgentsMap | null = useQuiet(load, 5_000);
  return (
    <section className="panel agents-widget" aria-labelledby="agents-widget-heading">
      <div className="panel-head">
        <h2 id="agents-widget-heading">The agents, live</h2>
        <a className="stage-link small" href={AGENTS_HREF}>
          Open the map
        </a>
      </div>
      {map ? (
        <AgentsMapSvg
          map={map}
          zones={false}
          selected=""
          onSelect={() => {
            window.location.hash = AGENTS_HREF;
          }}
        />
      ) : (
        <span className="skeleton skeleton-card" aria-hidden="true" />
      )}
    </section>
  );
}

const ALERT_LINKS: Record<string, string> = {
  overview: OVERVIEW_HREF,
  budgets: BUDGETS_HREF,
  guardrails: DETECTIONS_HREF,
  scoreboard: SCOREBOARD_HREF,
  audit: AUDIT_HREF,
  live: LIVE_HREF,
};

/** The alerts the bell holds, listed: what needs an engineer now. */
export function AlertsList({ api }: { api: Api }) {
  const [load] = useState(() => () => api.getAlerts());
  const alerts: Alert[] | null = useQuiet(load, 30_000);
  if (!alerts || alerts.length === 0) return null;
  return (
    <ul className="attention">
      {alerts.map((alert) => (
        <li key={alert.text}>
          <span className={alert.severity === "high" ? "chip chip-bad" : "chip chip-warn"}>
            {alert.severity === "high" ? "Now" : "Soon"}
          </span>
          <span>{alert.text}</span>
          <a className="stage-link small" href={ALERT_LINKS[alert.link] ?? OVERVIEW_HREF}>
            Open
          </a>
        </li>
      ))}
    </ul>
  );
}

/** The release in use and any being tested, by what each changed. */
export function ReleasesWidget({ api }: { api: Api }) {
  const [load] = useState(() => () => api.getVersions());
  const cards: VersionCard[] | null = useQuiet(load);
  const shown = (cards ?? []).filter(
    (card) => card.in_use || card.status === "candidate" || card.status === "proposed",
  );
  return (
    <section className="panel" aria-labelledby="releases-widget-heading">
      <div className="panel-head">
        <h2 id="releases-widget-heading">Releases</h2>
        <a className="stage-link small" href={IMPROVEMENT_HREF}>
          Every version
        </a>
      </div>
      {shown.length === 0 ? (
        <p className="muted small">{cards ? "No version in use yet." : "Loading…"}</p>
      ) : (
        <ul className="controls">
          {shown.map((card) => (
            <li key={card.version}>
              <span>
                <a href={versionHref(card.version)}>
                  <b>
                    #{card.version} {card.title}
                  </b>
                </a>
                <small className="muted">
                  {card.exam
                    ? `${pct(card.exam.accuracy)} right on ${String(card.exam.claims)} claims`
                    : "Not examined yet"}
                  {" · "}
                  {card.red_team ?? "no red-team run"}
                </small>
              </span>
              <span className={card.in_use ? "chip chip-good" : "chip chip-info"}>
                {card.in_use ? "In use" : "Being tested"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
