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

const SEEN_KEY = "console-seen-alerts";

function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/** What needs an engineer now, on every page: a bell with a count, opening the list. Worked
 * out in code by the api; refreshed every half minute. The count is the alerts not yet seen:
 * opening the list marks them seen, and the list keeps showing each until it's fixed. */
export function AlertBell({ api }: { api: Api }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(readSeen);
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

  const fresh = alerts.filter((alert) => !seen.has(alert.text));
  const high = fresh.some((alert) => alert.severity === "high");
  return (
    <div className="alert-bell">
      <button
        type="button"
        className="icon-button"
        aria-expanded={open}
        aria-label={
          unread
            ? "Alerts unavailable"
            : fresh.length
              ? `${String(fresh.length)} new alerts`
              : alerts.length
                ? `${String(alerts.length)} alerts, all seen`
                : "No alerts"
        }
        onClick={() => {
          setOpen((now) => !now);
          // Only today's alerts are kept, so a fixed one that comes back counts as new.
          const now = new Set(alerts.map((alert) => alert.text));
          setSeen(now);
          try {
            localStorage.setItem(SEEN_KEY, JSON.stringify([...now]));
          } catch {
            // Private windows refuse storage: the count clears for this visit only.
          }
        }}
      >
        <Bell size={17} strokeWidth={1.75} aria-hidden="true" />
        {fresh.length > 0 && (
          <span className={high ? "bell-count is-high" : "bell-count"}>{fresh.length}</span>
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
