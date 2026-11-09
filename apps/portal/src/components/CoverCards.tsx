import { Briefcase, Clock, HeartPulse, Plane, ShieldCheck, Stamp } from "lucide-react";
import { useEffect, useState } from "react";
import type { Api, Cover } from "../api";
import { date, dollars } from "../format";

/** What each trip is covered for, at a glance: the plan's limits and waiting times. */
export function CoverCards({ api }: { api: Api }) {
  const [cover, setCover] = useState<Cover[]>([]);

  useEffect(() => {
    let live = true;
    api.myCover().then(
      (found) => {
        if (live) setCover(found);
      },
      () => {
        // The cover cards are a help; the page works without them.
      },
    );
    return () => {
      live = false;
    };
  }, [api]);

  if (cover.length === 0) return null;
  return (
    <section aria-labelledby="cover-heading" className="cover">
      <h2 id="cover-heading" className="group-heading">
        What you&apos;re covered for
      </h2>
      <div className="cover-grid">
        {cover.map((trip) => (
          <article key={trip.policy_id} className="panel cover-card">
            <header className="cover-head">
              <ShieldCheck size={20} strokeWidth={2} aria-hidden="true" />
              <div>
                <h3>{trip.destination}</h3>
                <p className="small muted">
                  {trip.plan.name} · {date(trip.departs_on)} to {date(trip.returns_on)}
                </p>
              </div>
            </header>
            <ul className="cover-list">
              <li>
                <Plane size={16} strokeWidth={2} aria-hidden="true" />
                Trip cancelled: up to {dollars(trip.plan.trip_cancellation_max)}
              </li>
              <li>
                <Clock size={16} strokeWidth={2} aria-hidden="true" />
                Delays over {trip.plan.trip_delay_waiting_hours} hours: up to{" "}
                {dollars(trip.plan.trip_delay_max)}
              </li>
              <li>
                <Briefcase size={16} strokeWidth={2} aria-hidden="true" />
                Bags: up to {dollars(trip.plan.baggage_max)}, {dollars(trip.plan.per_item_limit)} an
                item
              </li>
              <li>
                <HeartPulse size={16} strokeWidth={2} aria-hidden="true" />
                Medical: up to {dollars(trip.plan.emergency_medical_max)}
              </li>
              <li>
                <Stamp size={16} strokeWidth={2} aria-hidden="true" />
                Passport: up to {dollars(trip.plan.passport_max)}
              </li>
            </ul>
            <p className="small muted">
              {trip.plan.deductible > 0
                ? `You pay the first ${dollars(trip.plan.deductible)} of a bag or medical claim.`
                : "No excess on this plan."}{" "}
              Your policy wording has the full terms.
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
