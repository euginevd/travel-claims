import { useEffect, useState } from "react";
import type { Api, Trends } from "../api";
import { Sparkline } from "./Charts";
import { TableScroll } from "./TableScroll";

const pct = (share: number | null) =>
  share === null ? "—" : `${String(Math.round(share * 100))}%`;

/** Each agent day by day, and live quality week by week: drift shows here before it shows
 * anywhere else. A day several times an agent's usual is marked, and raises an alert. */
export function TrendsPanels({ api }: { api: Api }) {
  const [trends, setTrends] = useState<Trends | null>(null);

  useEffect(() => {
    let live = true;
    api.getTrends().then(
      (found) => {
        if (live) setTrends(found);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [api]);

  if (!trends) return null;
  return (
    <>
      <section className="panel" aria-labelledby="agent-trends-heading">
        <div className="panel-head">
          <h2 id="agent-trends-heading">Each agent, day by day</h2>
          <p className="panel-note">Model calls a day, last 14 days; today against its usual day</p>
        </div>
        <ul className="agent-trends">
          {trends.agents.map((agent) => (
            <li key={agent.key} className={agent.unusual ? "is-unusual" : undefined}>
              <span className="agent-trend-name">{agent.label}</span>
              <Sparkline
                values={agent.days.map((day) => day.calls)}
                label={`${agent.label}'s model calls a day`}
              />
              <span className="small">
                <b>{agent.today}</b> today
                <span className="muted"> · usually {agent.usual}</span>
              </span>
              <span className={agent.unusual ? "chip chip-warn" : "chip"}>
                {agent.unusual ? "Unusual" : "Normal"}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="panel" aria-labelledby="weekly-heading">
        <div className="panel-head">
          <h2 id="weekly-heading">Week by week</h2>
          <p className="panel-note">Live claims, Monday to Sunday</p>
        </div>
        {trends.weeks.every((week) => week.decided === 0) ? (
          <p className="muted small">
            No live claims decided in the last eight weeks. Each week the agent works fills a row.
          </p>
        ) : (
          <TableScroll label="Weekly table">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Week of</th>
                  <th scope="col" className="num">
                    Decided
                  </th>
                  <th scope="col" className="num">
                    Without a person
                  </th>
                  <th scope="col" className="num">
                    Handler disagreed
                  </th>
                  <th scope="col" className="num">
                    Cost a claim
                  </th>
                </tr>
              </thead>
              <tbody>
                {trends.weeks.map((week) => (
                  <tr key={week.week_of}>
                    <th scope="row">{week.week_of}</th>
                    <td className="num">{week.decided}</td>
                    <td className="num">{pct(week.straight_through_share)}</td>
                    <td className="num">{pct(week.disagreement_rate)}</td>
                    <td className="num">
                      {week.cost_per_claim === null ? "—" : `$${week.cost_per_claim.toFixed(4)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </section>
    </>
  );
}
