import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import type { Alert, Api } from "../api";
import {
  AUDIT_HREF,
  LIVE_HREF,
  BUDGETS_HREF,
  DETECTIONS_HREF,
  OVERVIEW_HREF,
  SCOREBOARD_HREF,
} from "../useHashRoute";

const LINKS: Record<string, string> = {
  overview: OVERVIEW_HREF,
  budgets: BUDGETS_HREF,
  guardrails: DETECTIONS_HREF,
  scoreboard: SCOREBOARD_HREF,
  audit: AUDIT_HREF,
  live: LIVE_HREF,
};

/** What needs an engineer now, on every page: a bell with a count, opening the list. Worked
 * out in code by the api; refreshed every half minute. */
export function AlertBell({ api }: { api: Api }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [open, setOpen] = useState(false);
  // Whether the last read failed: the bell then says it can't tell, never "no alerts", as it
  // carries the alert for a changed audit record.
  const [unread, setUnread] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () => {
      api.getAlerts().then(
        (found) => {
          if (!live) return;
          setAlerts(found);
          setUnread(false);
        },
        () => {
          if (live) setUnread(true);
        },
      );
    };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [api]);

  const high = alerts.some((alert) => alert.severity === "high");
  return (
    <div className="alert-bell">
      <button
        type="button"
        className="icon-button"
        aria-expanded={open}
        aria-label={
          unread
            ? "Alerts unavailable"
            : alerts.length
              ? `${String(alerts.length)} alerts`
              : "No alerts"
        }
        onClick={() => {
          setOpen((now) => !now);
        }}
      >
        <Bell size={17} strokeWidth={1.75} aria-hidden="true" />
        {alerts.length > 0 && (
          <span className={high ? "bell-count is-high" : "bell-count"}>{alerts.length}</span>
        )}
      </button>
      {open && (
        <div className="bell-list" role="region" aria-label="Alerts">
          {unread ? (
            <p className="muted small" role="alert">
              Couldn&apos;t read the alerts. Trying again shortly.
            </p>
          ) : alerts.length === 0 ? (
            <p className="muted small">Nothing needs you now.</p>
          ) : (
            <ul>
              {alerts.map((alert) => (
                <li key={alert.text}>
                  <span className={alert.severity === "high" ? "chip chip-bad" : "chip chip-warn"}>
                    {alert.severity === "high" ? "Now" : "Soon"}
                  </span>
                  <a
                    href={LINKS[alert.link] ?? OVERVIEW_HREF}
                    onClick={() => {
                      setOpen(false);
                    }}
                  >
                    {alert.text}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
