// A plan's cover in plain words, the same in the chat and in Settings.
import type { CaseChip, Cover } from "../api";
import { dollars } from "../format";

const whole = (amount: number) => dollars(amount).replace(/\.00$/, "");

export function payFirst(cover: Cover): string {
  return cover.plan.deductible > 0 ? `${whole(cover.plan.deductible)} a claim` : "Nothing";
}

/** What a plan covers, biggest worries first, each in a few words with its limit. */
export function coverRows(cover: Cover): [string, string][] {
  const p = cover.plan;
  return [
    ["Medical", whole(p.emergency_medical_max)],
    ["Bags", whole(p.baggage_max)],
    [`Delays over ${String(p.trip_delay_waiting_hours)} hours`, whole(p.trip_delay_max)],
    ["Cancelling the trip", whole(p.trip_cancellation_max)],
    ["Lost passport", whole(p.passport_max)],
    ["You pay first", payFirst(cover)],
  ];
}

/** The plan's name as customers say it: "UnderCover First" is "First". */
export function planName(cover: Cover): string {
  return cover.plan.name.replace(/^UnderCover\s+/i, "");
}

/** One line on what the plan covers for this kind of trouble, from the plan's own limits. */
export function coverLine(cover: Cover, chip: CaseChip): string {
  const p = cover.plan;
  const first = p.deductible > 0 ? `${whole(p.deductible)} to pay first` : "nothing to pay first";
  const limit: Partial<Record<CaseChip, [string, number]>> = {
    lost_bag: ["lost bags", p.baggage_max],
    stolen: ["stolen things", p.baggage_max],
    delayed_bag: ["essentials while your bag's late", p.baggage_delay_max],
    flight_delay: [`delays over ${String(p.trip_delay_waiting_hours)} hours`, p.trip_delay_max],
    trip_cancelled: ["a cancelled trip", p.trip_cancellation_max],
    medical: ["medical care", p.emergency_medical_max],
    passport: ["a lost passport", p.passport_max],
  };
  const found = limit[chip];
  if (!found) return `You're on ${planName(cover)}, with ${first}.`;
  return `Your ${planName(cover)} plan covers ${found[0]} up to ${whole(found[1])}, with ${first}.`;
}
