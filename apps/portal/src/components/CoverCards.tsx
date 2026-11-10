import { Briefcase, ChevronDown, Clock, HeartPulse, Plane, Stamp } from "lucide-react";
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
      <div className="side-head">
        <h2 id="cover-heading">What you&apos;re covered for</h2>
      </div>
      <div className="cover-grid">
        {cover.map((trip, index) => (
          // The latest trip is open; the others fold away until the customer opens them.
          <details key={trip.policy_id} className="cover-card" open={index === 0}>
            <summary>
              <span>
                <span className="cover-plan">
                  {trip.plan.name} · {date(trip.departs_on)} to {date(trip.returns_on)}
                </span>
                <h3>{trip.destination}</h3>
              </span>
              <ChevronDown className="cover-chev" size={18} strokeWidth={1.75} aria-hidden="true" />
            </summary>
            <dl className="limit-rows">
              <div className="limit-row">
                <dt>
                  <Plane size={15} strokeWidth={1.75} aria-hidden="true" />
                  Trip cancelled
                </dt>
                <dd>{dollars(trip.plan.trip_cancellation_max)}</dd>
              </div>
              <div className="limit-row">
                <dt>
                  <Clock size={15} strokeWidth={1.75} aria-hidden="true" />
                  Delays over {trip.plan.trip_delay_waiting_hours} hours
                </dt>
                <dd>{dollars(trip.plan.trip_delay_max)}</dd>
              </div>
              <div className="limit-row">
                <dt>
                  <Briefcase size={15} strokeWidth={1.75} aria-hidden="true" />
                  Bags
                </dt>
                <dd>
                  {dollars(trip.plan.baggage_max)} · {dollars(trip.plan.per_item_limit)} an item
                </dd>
              </div>
              <div className="limit-row">
                <dt>
                  <HeartPulse size={15} strokeWidth={1.75} aria-hidden="true" />
                  Medical
                </dt>
                <dd>{dollars(trip.plan.emergency_medical_max)}</dd>
              </div>
              <div className="limit-row">
                <dt>
                  <Stamp size={15} strokeWidth={1.75} aria-hidden="true" />
                  Passport
                </dt>
                <dd>{dollars(trip.plan.passport_max)}</dd>
              </div>
            </dl>
            <p className="cover-note">
              {trip.plan.deductible > 0
                ? `${dollars(trip.plan.deductible)} excess on bag and medical claims.`
                : "No excess on this plan."}{" "}
              Your policy wording has the full terms.
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
