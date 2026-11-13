import { useEffect, useState } from "react";
import type { Api, Controls } from "../api";
import { AGENTS_HREF } from "../useHashRoute";

/** The agent and payouts switches, on every page: green when on, red when off. Read-only here;
 * senior handlers switch them in the dashboard. Opens the agents map, where they're gates. */
export function ControlPills({ api }: { api: Api }) {
  const [controls, setControls] = useState<Controls | null>(null);

  useEffect(() => {
    let live = true;
    const load = () => {
      api.getControls().then(
        (found) => {
          if (live) setControls(found);
        },
        () => {
          // Nothing to show until the switches can be read; the page itself says what failed.
        },
      );
    };
    load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [api]);

  if (!controls) return null;
  const { agent, payouts } = controls;
  return (
    <a
      className="control-pills"
      href={AGENTS_HREF}
      title="Switched by senior handlers in the dashboard"
    >
      <span className={`control-pill ${agent.on ? "is-on" : "is-off"}`}>
        <span className="status-dot" aria-hidden="true" />
        <span className="control-label">
          {agent.on ? `Agent on · ${String(agent.working)} working` : "Agent off"}
        </span>
      </span>
      <span className={`control-pill ${payouts.paused ? "is-off" : "is-on"}`}>
        <span className="status-dot" aria-hidden="true" />
        <span className="control-label">{payouts.paused ? "Payouts paused" : "Payouts live"}</span>
      </span>
    </a>
  );
}
