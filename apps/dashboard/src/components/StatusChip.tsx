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
import type { DecisionKind, Status } from "../api";

export type Tone = "info" | "good" | "bad" | "refer" | "warn" | "neutral";

interface Chip {
  label: string;
  Icon: LucideIcon;
  tone: Tone;
}

// The status a handler cares about: where the claim stands, and once decided, the outcome.
export function chipFor(status: Status, decision: DecisionKind | null = null): Chip {
  switch (status) {
    case "waiting":
      return { label: "Waiting", Icon: Clock, tone: "info" };
    case "in_progress":
      return { label: "In progress", Icon: LoaderCircle, tone: "info" };
    case "waiting_for_sign_off":
      return { label: "Waiting for sign-off", Icon: Hourglass, tone: "warn" };
    case "sent_back":
      return { label: "Sent back", Icon: Undo2, tone: "warn" };
    case "left_for_handler":
      return { label: "Referred", Icon: UserRound, tone: "refer" };
    case "decided":
      if (decision === "approve") return { label: "Paid", Icon: CircleCheck, tone: "good" };
      if (decision === "decline") return { label: "Declined", Icon: Ban, tone: "bad" };
      if (decision === "refer") return { label: "Referred", Icon: UserRound, tone: "refer" };
      return { label: "Decided", Icon: CircleDot, tone: "neutral" };
  }
}

interface StatusChipProps {
  status: Status;
  decision?: DecisionKind | null;
}

export function StatusChip({ status, decision = null }: StatusChipProps) {
  const { label, Icon, tone } = chipFor(status, decision);
  return (
    <span className={`chip chip-${tone}`}>
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
      {label}
    </span>
  );
}

const OUTCOME: Record<DecisionKind, Chip> = {
  approve: { label: "Approved", Icon: CircleCheck, tone: "good" },
  decline: { label: "Declined", Icon: Ban, tone: "bad" },
  refer: { label: "Referred", Icon: UserRound, tone: "refer" },
};

// The decision's outcome on its own, before or after it's paid.
export function OutcomeChip({ decision }: { decision: DecisionKind }) {
  const { label, Icon, tone } = OUTCOME[decision];
  return (
    <span className={`chip chip-${tone}`}>
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
      {label}
    </span>
  );
}
