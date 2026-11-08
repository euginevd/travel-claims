import {
  Ban,
  CircleCheck,
  Clock,
  Hourglass,
  LoaderCircle,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { CustomerStatus } from "../api";

export type Tone = "info" | "good" | "bad" | "refer" | "warn";

interface Chip {
  label: string;
  Icon: LucideIcon;
  tone: Tone;
}

const CUSTOMER: Record<CustomerStatus, Chip> = {
  received: { label: "Received", Icon: Clock, tone: "info" },
  assessing: { label: "Being assessed", Icon: LoaderCircle, tone: "info" },
  reviewing: { label: "Being reviewed", Icon: Hourglass, tone: "warn" },
  approved: { label: "Approved", Icon: CircleCheck, tone: "good" },
  paid: { label: "Paid", Icon: CircleCheck, tone: "good" },
  declined: { label: "Declined", Icon: Ban, tone: "bad" },
  with_a_handler: { label: "With a claims handler", Icon: UserRound, tone: "refer" },
};

// Where a customer's claim stands, in their words.
export function CustomerStatusChip({ status }: { status: CustomerStatus }) {
  const { label, Icon, tone } = CUSTOMER[status];
  return (
    <span className={`chip chip-${tone}`}>
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
      {label}
    </span>
  );
}

/** A warm one-liner for where the claim stands. */
export const STATUS_LINE: Record<CustomerStatus, string> = {
  received: "We've got your claim and will start on it shortly.",
  assessing: "We're on it now. This usually takes a minute or two.",
  reviewing: "A claims handler is giving it a final check.",
  approved: "Good news: it's approved. Payment is on its way.",
  paid: "All done. We've paid your claim.",
  declined: "We couldn't pay this one. Open it to see why, or ask a person to review it.",
  with_a_handler: "A claims handler is looking at it personally.",
};
