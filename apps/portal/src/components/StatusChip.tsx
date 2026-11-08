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

interface Chip {
  label: string;
  Icon: LucideIcon;
}

const CUSTOMER: Record<CustomerStatus, Chip> = {
  received: { label: "Received", Icon: Clock },
  assessing: { label: "Being assessed", Icon: LoaderCircle },
  reviewing: { label: "Being reviewed", Icon: Hourglass },
  approved: { label: "Approved", Icon: CircleCheck },
  paid: { label: "Paid", Icon: CircleCheck },
  declined: { label: "Declined", Icon: Ban },
  with_a_handler: { label: "With a claims handler", Icon: UserRound },
};

// Where a customer's claim stands, in their words.
export function CustomerStatusChip({ status }: { status: CustomerStatus }) {
  const { label, Icon } = CUSTOMER[status];
  return (
    <span className="chip">
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
      {label}
    </span>
  );
}
