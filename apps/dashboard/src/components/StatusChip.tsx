import {
  Ban,
  CircleCheck,
  CircleDot,
  Clock,
  Hourglass,
  LoaderCircle,
  Undo2,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { CustomerStatus, DecisionKind, Status } from "../api";

interface Chip {
  label: string;
  Icon: LucideIcon;
  held?: boolean;
}

// The status a handler cares about: where the claim stands, and once decided, the outcome.
export function chipFor(status: Status, decision: DecisionKind | null = null): Chip {
  switch (status) {
    case "waiting":
      return { label: "Waiting", Icon: Clock };
    case "in_progress":
      return { label: "In progress", Icon: LoaderCircle };
    case "waiting_for_sign_off":
      return { label: "Waiting for sign-off", Icon: Hourglass, held: true };
    case "sent_back":
      return { label: "Sent back", Icon: Undo2 };
    case "left_for_handler":
      return { label: "Referred", Icon: UserRound };
    case "decided":
      if (decision === "approve") return { label: "Paid", Icon: CircleCheck };
      if (decision === "decline") return { label: "Declined", Icon: Ban };
      if (decision === "refer") return { label: "Referred", Icon: UserRound };
      return { label: "Decided", Icon: CircleDot };
  }
}

interface StatusChipProps {
  status: Status;
  decision?: DecisionKind | null;
}

export function StatusChip({ status, decision = null }: StatusChipProps) {
  const { label, Icon, held } = chipFor(status, decision);
  return (
    <span className={`chip${held ? " chip-held" : ""}`}>
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
      {label}
    </span>
  );
}

const OUTCOME: Record<DecisionKind, Chip> = {
  approve: { label: "Approved", Icon: CircleCheck },
  decline: { label: "Declined", Icon: Ban },
  refer: { label: "Referred", Icon: UserRound },
};

// The decision's outcome on its own, before or after it's paid.
export function OutcomeChip({ decision }: { decision: DecisionKind }) {
  const { label, Icon } = OUTCOME[decision];
  return (
    <span className="chip">
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
      {label}
    </span>
  );
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
