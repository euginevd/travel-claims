import {
  CalendarClock,
  CalendarX,
  Clock,
  FileText,
  HeartPulse,
  IdCard,
  Luggage,
  PlaneTakeoff,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  baggage: Luggage,
  baggage_delay: Clock,
  trip_delay: PlaneTakeoff,
  trip_cancellation: CalendarX,
  trip_interruption: CalendarClock,
  emergency_medical: HeartPulse,
  passport: IdCard,
};

/** The claim type as an icon in a soft tile, so a list of claims scans at a glance. */
export function ClaimTypeIcon({ claimType }: { claimType: string }) {
  const Icon = ICONS[claimType] ?? FileText;
  return (
    <span className="claim-icon" aria-hidden="true">
      <Icon size={22} strokeWidth={2} />
    </span>
  );
}
